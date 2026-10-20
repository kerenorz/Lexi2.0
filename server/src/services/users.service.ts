/* eslint-disable @typescript-eslint/no-unused-vars */
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AgentsModel } from '../models/AgentsModel';
import { ExperimentsModel } from '../models/ExperimentsModel';
import { FormsModel } from '../models/FormsModel';
import { UsersModel } from '../models/UsersModel';
import { AgentsMode, IAgent, IUser } from '../types';
import { IUserResources } from '../types/users.type';
import { experimentsService } from './experiments.service';
import { AppError } from '../utils/errors';
import {
    BCRYPT_COST,
    MAX_PASSWORD_BYTES,
    MIN_PASSWORD_LENGTH,
    PASSWORD_LOCKED_MESSAGE,
} from '../constants/passwords';

dotenv.config();

// Strips `password` for everyone, and the embedded agent snapshot (prompts, model, phases)
// for participants, so the persona and manipulation never reach the participant's browser.
const sanitizeUser = (user: IUser): IUser => {
    const { password, ...safe } = user as any;
    if (safe.role !== 'participant') return safe;
    const { agent, agents, ...withoutSnapshot } = safe;
    return withoutSnapshot;
};

// Rules live in constants/passwords.
function assertNewPassword(newPassword: unknown): asserts newPassword is string {
    if (typeof newPassword !== 'string') {
        throw new AppError('The new password must be text.', 400, 'INVALID_PASSWORD_FORMAT');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new AppError(
            `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            400,
            'PASSWORD_TOO_SHORT',
        );
    }
    if (Buffer.byteLength(newPassword, 'utf8') > MAX_PASSWORD_BYTES) {
        throw new AppError(
            `The new password is too long (${MAX_PASSWORD_BYTES} bytes at most).`,
            400,
            'PASSWORD_TOO_LONG',
        );
    }
}

class UsersService {
    createAdminUser = async (username: string, password: string): Promise<IUser> => {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);
        const user = await UsersModel.create({
            username,
            password: hashedPassword,
            role: 'admin',
        });

        return user;
    };

    createResearcherUser = async (username: string, password: string): Promise<IUser> => {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);
        const user = await UsersModel.create({
            username,
            password: hashedPassword,
            role: 'user',
        });

        return user;
    };

    getResearcherUsers = async (): Promise<IUser[]> => {
        const users: IUser[] = await UsersModel.find(
            { role: 'user' },
            { password: 0 },
        ).lean();
        return users;
    };

    deleteResearcherUser = async (userId: string): Promise<void> => {
        await UsersModel.deleteOne({ _id: new mongoose.Types.ObjectId(userId), role: 'user' });
    };

    // Batch username lookup by user id, for showing creators in admin lists.
    getUsernamesByIds = async (ids: string[]): Promise<Map<string, string>> => {
        if (!ids.length) return new Map();
        const owners = await UsersModel.find({ _id: { $in: ids } }, { username: 1 }).lean();
        return new Map(owners.map((o) => [o._id.toString(), o.username]));
    };

    // Owners' allowed models, so an admin's model picker offers what the owner may save.
    getAllowedModelsByIds = async (ids: string[]): Promise<Map<string, string[]>> => {
        if (!ids.length) return new Map();
        const owners = await UsersModel.find({ _id: { $in: ids } }, { limits: 1 }).lean();
        return new Map(
            owners
                .filter((o: any) => Array.isArray(o.limits?.allowedModels) && o.limits.allowedModels.length)
                .map((o: any) => [o._id.toString(), o.limits.allowedModels as string[]]),
        );
    };

    // Scoped to researchers. An empty list means unrestricted and unsets the field, so there
    // is one spelling of that state. Returns null when there is no such researcher.
    setResearcherAllowedModels = async (userId: string, allowedModels: string[]): Promise<IUser | null> => {
        if (!mongoose.Types.ObjectId.isValid(userId)) return null;
        const update = allowedModels.length
            ? { $set: { 'limits.allowedModels': allowedModels } }
            : { $unset: { 'limits.allowedModels': '' } };
        const user = await UsersModel.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(userId), role: 'user' },
            update,
            { new: true, projection: { password: 0 } },
        ).lean();
        return (user as IUser) ?? null;
    };

    // Admins and researchers only. The lock is checked before the current password so a
    // locked shared account can't be used to guess it. Existing sessions stay valid (the JWT
    // has no expiry or version).
    changeOwnPassword = async (userId: string, currentPassword: unknown, newPassword: unknown): Promise<void> => {
        if (typeof currentPassword !== 'string' || !currentPassword.length) {
            throw new AppError('Your current password is required.', 400, 'INVALID_PASSWORD_FORMAT');
        }
        assertNewPassword(newPassword);

        const user = await UsersModel.findOne(
            { _id: new mongoose.Types.ObjectId(userId), role: { $in: ['admin', 'user'] } },
            { password: 1, passwordLocked: 1 },
        ).lean();
        if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

        if (user.passwordLocked) {
            throw new AppError(PASSWORD_LOCKED_MESSAGE, 403, 'PASSWORD_LOCKED');
        }

        // A non-string hash would make bcrypt throw; treat it as a wrong password.
        const matches = typeof user.password === 'string' && (await bcrypt.compare(currentPassword, user.password));
        if (!matches) {
            throw new AppError('Your current password is incorrect.', 403, 'WRONG_CURRENT_PASSWORD');
        }

        await UsersModel.updateOne(
            { _id: user._id },
            { $set: { password: await bcrypt.hash(newPassword, BCRYPT_COST) } },
        );
    };

    // Admin sets a researcher's password and/or lock flag, no current password needed.
    // Scoped to researchers; returns null when there is no such researcher. Unlock unsets the flag.
    setResearcherPassword = async (
        userId: string,
        changes: { newPassword?: unknown; passwordLocked?: unknown },
    ): Promise<IUser | null> => {
        const { newPassword, passwordLocked } = changes;
        if (newPassword === undefined && passwordLocked === undefined) {
            throw new AppError('Send a new password, a lock setting, or both.', 400, 'INVALID_PASSWORD_FORMAT');
        }
        if (passwordLocked !== undefined && typeof passwordLocked !== 'boolean') {
            throw new AppError('passwordLocked must be true or false.', 400, 'INVALID_PASSWORD_FORMAT');
        }
        if (newPassword !== undefined) assertNewPassword(newPassword);

        if (!mongoose.Types.ObjectId.isValid(userId)) return null;

        const $set: Record<string, unknown> = {};
        const $unset: Record<string, ''> = {};
        if (newPassword !== undefined) $set.password = await bcrypt.hash(newPassword as string, BCRYPT_COST);
        if (passwordLocked === true) $set.passwordLocked = true;
        if (passwordLocked === false) $unset.passwordLocked = '';

        const user = await UsersModel.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(userId), role: 'user' },
            { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
            { new: true, projection: { password: 0 } },
        ).lean();
        return (user as IUser) ?? null;
    };

    // Creates a participant with a snapshot of the assigned agent(s). The single creation path,
    // so condition assignment can't diverge between routes.
    private provisionParticipant = async (experimentId: string, extra: Partial<IUser>): Promise<IUser> => {
        const [agent, experiment] = await Promise.all([
            experimentsService.getActiveAgent(experimentId),
            experimentsService.getExperiment(experimentId),
        ]);

        if (experiment.maxParticipants && experiment.numberOfParticipants + 1 > experiment.maxParticipants) {
            throw new AppError('Experiment Participants Limit Exceeded', 403, 'PARTICIPANTS_LIMIT_REACHED');
        }

        // Refuse with a reason when the experiment's agents were deleted (empty or short roster),
        // instead of a bare 500 from the write or a silently smaller group.
        const rosterIssue = await experimentsService.getRosterIssue(experiment);
        if (rosterIssue) {
            throw new AppError(rosterIssue.message, 409, 'EXPERIMENT_MISCONFIGURED');
        }

        let res;
        if (experiment.agentsMode === AgentsMode.GROUP) {
            // `agent` is a placeholder to satisfy the required field.
            const groupAgents = await experimentsService.getGroupAgents(experimentId);
            res = await UsersModel.create({
                ...extra,
                experimentId,
                agent: groupAgents[0],
                agents: groupAgents,
                mode: AgentsMode.GROUP,
                role: 'participant',
            });
        } else {
            res = await UsersModel.create({
                ...extra,
                experimentId,
                agent,
                role: 'participant',
            });
        }

        const savedUser = res.toObject() as IUser;
        await experimentsService.addParticipant(experimentId);
        return savedUser;
    };

    createUser = async (user: IUser, experimentId: string): Promise<{ user: IUser; token: string }> => {
        const {
            username,
            age,
            gender,
            biologicalSex,
            maritalStatus,
            childrenNumber,
            nativeEnglishSpeaker,
            // The host survey's participant id, only when embedded. The join key between exports.
            externalPid,
        } = user;
        const savedUser = await this.provisionParticipant(experimentId, {
            username,
            age,
            gender,
            biologicalSex,
            maritalStatus,
            childrenNumber,
            nativeEnglishSpeaker,
            ...(externalPid ? { externalPid } : {}),
        });

        const token = jwt.sign({ id: savedUser._id }, process.env.JWT_SECRET_KEY);
        return { user: sanitizeUser(savedUser), token };
    };

    // Survey-embedded participants register through createUser like everyone else (a pid as
    // username would reach the agents). The unique {externalPid, experimentId} index stops
    // a double submit from creating two.

    // For the segment entry route, which authenticates by pid rather than password.
    issueToken = (userId: string): string => jwt.sign({ id: userId }, process.env.JWT_SECRET_KEY);

    login = async (
        username: string,
        experimentId?: string,
        userPassword?: string,
    ): Promise<{ user: IUser; token?: string }> => {
        const user: IUser = await this.getUserByName(username, experimentId);

        if (!user) {
            throw new AppError('Invalid User Name', 401, 'INVALID_CREDENTIALS');
        }

        const isPrivilegedUser = user.role === 'admin' || user.role === 'user';

        // Admin/User login: first call without password returns user (prompts for password)
        if (isPrivilegedUser && !userPassword) {
            return { user: sanitizeUser(user) };
        }

        // Admin/User login: validate password
        if (isPrivilegedUser && userPassword) {
            const passwordIsValid = await bcrypt.compare(userPassword, user.password);
            if (!passwordIsValid) {
                throw new AppError('Invalid Password', 401, 'INVALID_CREDENTIALS');
            }
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET_KEY);

        return { token, user: sanitizeUser(user) };
    };

    getActiveUser = async (token: string): Promise<{ user: IUser; newToken: string }> => {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        const user: IUser = await UsersModel.findOne({ _id: decoded.id }).lean();

        if (!user) throw new AppError('User not found', 401, 'USER_NOT_FOUND');

        const newToken = jwt.sign({ id: decoded.id }, process.env.JWT_SECRET_KEY);

        return { user: sanitizeUser(user), newToken };
    };

    addConversation = async (userId: string): Promise<IUser> => {
        const updatedUser: IUser = await UsersModel.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(userId) },
            { $inc: { numberOfConversations: 1 } },
            { new: true },
        );

        return updatedUser;
    };

    getUserByName = async (userName: string, experimentId: string): Promise<IUser> => {
        // Blocks operator injection (an object like `{ $ne: null }` would match anything).
        // Not mongoose's global sanitizeFilter, which would break our own `$in` filters.
        // experimentId may be absent for privileged logins.
        if (typeof userName !== 'string' || (experimentId !== undefined && typeof experimentId !== 'string')) {
            throw new AppError('Username and experiment id must be strings.', 400, 'INVALID_CREDENTIALS_FORMAT');
        }
        const user: IUser = await UsersModel.findOne({
            $or: [
                { username: userName, role: { $in: ['admin', 'user'] } },
                { username: userName, experimentId },
            ],
        }).lean();
        return user;
    };

    getUserByExternalPid = async (experimentId: string, externalPid: string): Promise<IUser> => {
        const user: IUser = await UsersModel.findOne({ externalPid, experimentId }).lean();
        return user;
    };

    getUserById = async (userId: string): Promise<IUser> => {
        const user: IUser = await UsersModel.findOne({ _id: new mongoose.Types.ObjectId(userId) }).lean();
        return user;
    };

    getExperimentUsers = async (experimentId: string): Promise<any[]> => {
        const users = await UsersModel.aggregate([
            { $match: { experimentId } },
            { $group: { _id: '$agent._id', agent: { $first: '$agent' }, data: { $push: '$$ROOT' } } },
            { $project: { _id: 0, agent: 1, data: 1 } },
        ]);

        return users;
    };

    // Pushes an edited agent onto participants' frozen snapshots (an explicit opt-in after save).
    // ownerId undefined means admin. A researcher must own both the agent and the experiments
    // the participants belong to; either check alone leaves a hole.
    updateUsersAgent = async (agent: IAgent, ownerId?: string): Promise<void> => {
        if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
            throw new AppError('An agent object is required.', 400, 'INVALID_MESSAGE_FORMAT');
        }
        // A 24-char hex string, not ObjectId.isValid, which accepts numbers and any 12-char
        // string and then throws in the constructor. Also blocks `{$ne: null}` injection.
        const rawId = agent._id as unknown;
        const agentIdHex = typeof rawId === 'string' ? rawId : rawId instanceof mongoose.Types.ObjectId ? rawId.toHexString() : '';
        if (!/^[0-9a-fA-F]{24}$/.test(agentIdHex)) {
            throw new AppError('Invalid agent id.', 400, 'INVALID_MESSAGE_FORMAT');
        }
        const agentId = new mongoose.Types.ObjectId(agentIdHex);

        const filter: Record<string, unknown> = { 'agent._id': agentId };

        if (ownerId) {
            const owned = await AgentsModel.exists({ _id: agentId, ownerId });
            if (!owned) {
                throw new AppError('This agent belongs to another account.', 403, 'INSUFFICIENT_PERMISSIONS');
            }
            const experiments = await ExperimentsModel.find({ ownerId }, { _id: 1 }).lean();
            filter.experimentId = { $in: experiments.map((e) => String(e._id)) };
        }

        await UsersModel.updateMany(filter, { $set: { agent } });
    };

    deleteExperimentUsers = async (experimentId: string): Promise<void> => {
        await UsersModel.deleteMany({ experimentId });
    };

    getResearcherResources = async (researcherId: string): Promise<IUserResources> => {
        const [agents, experiments, forms] = await Promise.all([
            AgentsModel.find({ ownerId: researcherId }, { _id: 1, title: 1, model: 1, createdAt: 1 }).lean(),
            ExperimentsModel.find(
                { ownerId: researcherId },
                { _id: 1, title: 1, isActive: 1, numberOfParticipants: 1, agentsMode: 1, createdAt: 1 },
            ).lean(),
            FormsModel.find({ ownerId: researcherId }, { _id: 1, name: 1, title: 1 }).lean(),
        ]);
        return { agents, experiments, forms } as unknown as IUserResources;
    };
}

export const usersService = new UsersService();

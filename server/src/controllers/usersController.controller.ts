import { Request, Response } from 'express';
import { usersService } from '../services/users.service';
import { requestHandler, sendErrorResponse } from '../utils/requestHandler';
import { authCookieOptions, authCookieClearOptions } from '../utils/cookieOptions';
import { isKnownModel } from '../constants/modelCatalogue';
import { AppError, httpStatusOf, isAppError } from '../utils/errors';

// Public routes: reject non-string credentials. Express parses `?username[$regex]=x` into an
// object, which would reach Mongo as a query operator.
const isAbsentOrString = (value: unknown): boolean => value === undefined || typeof value === 'string';

function assertCredentialsAreStrings(fields: { username: unknown; experimentId: unknown; userPassword?: unknown }): void {
    const { username, experimentId, userPassword } = fields;
    const wellFormed =
        typeof username === 'string' &&
        username.length > 0 &&
        isAbsentOrString(experimentId) &&
        isAbsentOrString(userPassword);
    if (!wellFormed) {
        throw new AppError('Username, experiment id and password must be strings.', 400, 'INVALID_CREDENTIALS_FORMAT');
    }
}

class UsersController {
    createUser = requestHandler(
        async (req: Request, res: Response) => {
            const { userInfo, experimentId } = req.body;
            const { user, token } = await usersService.createUser(userInfo, experimentId);

            res.cookie('token', token, authCookieOptions);
            res.status(200).send(user);
        },
        (req, res, error) => {
            if (error.code === 11000) {
                res.status(409).json({ message: 'User Already Exists' });
                return;
            }
            // Mongo driver codes aren't HTTP statuses; sendErrorResponse maps them.
            sendErrorResponse(res, error);
        },
    );

    login = requestHandler(async (req: Request, res: Response) => {
        const { username, userPassword, experimentId } = req.body;
        assertCredentialsAreStrings({ username, experimentId, userPassword });
        const { token, user } = await usersService.login(username, experimentId, userPassword);

        if (token) {
            res.cookie('token', token, authCookieOptions);
        }
        res.status(200).send({ token, user });
    });

    getActiveUser = requestHandler(async (req: Request, res: Response) => {
        if (!req.cookies || !req.cookies.token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const { token } = req.cookies;
        const { user, newToken } = await usersService.getActiveUser(token);

        res.cookie('token', newToken, authCookieOptions);
        res.status(200).send(user);
    });

    logout = requestHandler(async (req: Request, res: Response) => {
        res.clearCookie('token', authCookieClearOptions);
        res.status(200).send({ message: 'Logged out successfully' });
    });

    validateUserName = requestHandler(
        async (req, res) => {
            const { username, experimentId } = req.query;
            // Empty or absent name returns "free" without a query: the client doesn't URL-encode,
            // so names starting with `&` or `#` arrive empty. Objects still get the 400 below.
            if ((username === undefined || username === '') && isAbsentOrString(experimentId)) {
                res.status(200).send(true);
                return;
            }
            assertCredentialsAreStrings({ username, experimentId });
            const user = await usersService.getUserByName(username as string, experimentId as string);
            if (user) {
                const error = new Error('User Already Exists');
                error['code'] = 409;
                throw error;
            }

            res.status(200).send(true);
        },
        (req, res, error) => {
            if (error.code === 409) {
                res.status(409).json({ message: 'User Already Exists' });
                return;
            }
            // httpStatusOf, not error.code: only a 400-599 code is safe for res.status().
            if (isAppError(error)) {
                res.status(httpStatusOf(error)).json({ message: error.message, reason: error.reason });
                return;
            }
            res.status(500).json({ message: error?.message || 'Unexpected server error', reason: 'UNEXPECTED' });
        },
    );

    // ownerId: undefined for admin (unrestricted), else the caller. The service scopes by it.
    updateUsersAgent = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        const ownerId = req.user?.role === 'admin' ? undefined : req.user?._id;
        await usersService.updateUsersAgent(agent, ownerId);
        res.status(200).send();
    });

    createResearcherUser = requestHandler(
        async (req: Request, res: Response) => {
            const { username, password } = req.body;
            if (!username || !password) {
                res.status(400).json({ message: 'Username and password are required' });
                return;
            }
            const user = await usersService.createResearcherUser(username, password);
            const { password: _, ...userWithoutPassword } = (user as any).toObject();
            res.status(200).send(userWithoutPassword);
        },
        (req, res, error) => {
            if (error.code === 11000) {
                res.status(409).json({ message: 'User Already Exists' });
                return;
            }
            // Mongo driver codes aren't HTTP statuses; sendErrorResponse maps them.
            sendErrorResponse(res, error);
        },
    );

    getResearcherUsers = requestHandler(async (req: Request, res: Response) => {
        const users = await usersService.getResearcherUsers();
        res.status(200).send(users);
    });

    deleteResearcherUser = requestHandler(async (req: Request, res: Response) => {
        const userId = req.params.id;
        await usersService.deleteResearcherUser(userId);
        res.status(200).send();
    });

    getResearcherResources = requestHandler(async (req: Request, res: Response) => {
        const researcherId = req.params.id;
        const resources = await usersService.getResearcherResources(researcherId);
        res.status(200).send(resources);
    });

    /**
     * Models a researcher may use (empty = unrestricted). Applies to agents they own, admins included.
     * Ids are checked against the catalogue so a typo can't become an allowance nothing satisfies.
     */
    updateResearcherLimits = requestHandler(async (req: Request, res: Response) => {
        const { allowedModels } = req.body;
        if (!Array.isArray(allowedModels)) {
            res.status(400).json({
                message: 'allowedModels must be an array',
                reason: 'INVALID_MESSAGE_FORMAT',
            });
            return;
        }

        const models = [...new Set(allowedModels.map(String))];
        const unknown = models.filter((model) => !isKnownModel(model));
        if (unknown.length) {
            res.status(400).json({
                message: `Not in the model catalogue: ${unknown.join(', ')}.`,
                reason: 'UNKNOWN_MODEL',
            });
            return;
        }

        const updated = await usersService.setResearcherAllowedModels(req.params.id, models);
        if (!updated) {
            res.status(404).json({ message: 'Researcher not found', reason: 'USER_NOT_FOUND' });
            return;
        }
        res.status(200).json(updated);
    });

    /** Reads only these two fields, so `passwordLocked` can't be set here. Checks live in the service. */
    changeOwnPassword = requestHandler(async (req: Request, res: Response) => {
        const { currentPassword, newPassword } = req.body ?? {};
        await usersService.changeOwnPassword(req.user!._id, currentPassword, newPassword);
        res.status(200).json({ message: 'Password changed' });
    });

    /** Admin sets a password and/or the lock flag. Returns the account without hash or password. */
    setResearcherPassword = requestHandler(async (req: Request, res: Response) => {
        const { newPassword, passwordLocked } = req.body ?? {};
        const updated = await usersService.setResearcherPassword(req.params.id, { newPassword, passwordLocked });
        if (!updated) {
            res.status(404).json({ message: 'Researcher not found', reason: 'USER_NOT_FOUND' });
            return;
        }
        res.status(200).json(updated);
    });
}

export const usersController = new UsersController();

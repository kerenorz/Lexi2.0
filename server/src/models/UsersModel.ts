import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IUser } from '../types';
import { agentsSchema } from './AgentsModel';

export const userSchema = new Schema<IUser>(
    {
        experimentId: {
            type: String,
            required() {
                return this.role === 'participant';
            },
        },
        username: { type: String, required: true },
        age: { type: Number },
        gender: { type: String },
        biologicalSex: { type: String },
        maritalStatus: { type: String },
        childrenNumber: { type: Number },
        nativeEnglishSpeaker: { type: Boolean },
        createdAt: { type: Date, default: Date.now },
        timestamp: { type: Number, default: () => Date.now() },
        role: { type: String, enum: ['admin', 'user', 'participant'], default: 'participant', index: true },
        password: { type: String },
        numberOfConversations: { type: Number, default: () => 0 },
        agent: {
            type: agentsSchema,
            required() {
                return this.role === 'participant';
            },
        },
        // Group participants' agent snapshots, taken at registration.
        agents: { type: [agentsSchema], required: false, default: undefined },
        mode: { type: String, required: false },
        // Absent/empty = unrestricted. Enforced in agentsController.
        limits: {
            allowedModels: { type: [String], required: false, default: undefined },
        },
        // Shared account (e.g. students): only an admin may change the password. Unlocked is
        // stored by removing the field. Declared, or strict mode drops it from updates.
        passwordLocked: { type: Boolean, required: false },
        // Survey participant id, for participants created via the segment entry route.
        externalPid: { type: String, required: false },
    },
    { versionKey: false },
);

// Per experiment, so one person can join several. Researchers (no experimentId) stay unique among themselves.
userSchema.index({ username: 1, experimentId: 1 }, { unique: true });

// One user per survey pid per experiment, so concurrent entries can't create two.
// Partial, not sparse: a sparse compound index would cover every participant.
userSchema.index(
    { externalPid: 1, experimentId: 1 },
    { unique: true, partialFilterExpression: { externalPid: { $exists: true } } },
);

export const UsersModel = mongoDbProvider.getModel('users', userSchema);

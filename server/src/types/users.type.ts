import mongoose from 'mongoose';
import { IAgent } from '../types/agents.type';

export type UserRole = 'admin' | 'user' | 'participant';

export interface IUserResources {
    agents: Array<{
        _id: string;
        title: string;
        model: string;
        createdAt: Date;
    }>;
    experiments: Array<{
        _id: string;
        title: string;
        isActive: boolean;
        numberOfParticipants: number;
        agentsMode: string;
        createdAt: Date;
    }>;
    forms: Array<{
        _id: string;
        name: string;
        title: string;
    }>;
}

export interface IUser {
    _id?: mongoose.Types.ObjectId;
    experimentId: string;
    username: string;
    age: number;
    gender: 'male' | 'female' | 'other';
    biologicalSex: string;
    maritalStatus: string;
    childrenNumber: number;
    nativeEnglishSpeaker: boolean;
    createdAt: Date;
    timestamp: number;
    role: UserRole;
    password?: string;
    numberOfConversations: number;
    agent: IAgent;
    // Group chat: roster snapshot + mode flag.
    agents?: IAgent[];
    mode?: string;
    // Optional per-account restrictions. Absent/empty allowedModels => unrestricted.
    limits?: { allowedModels?: string[] };
    // Only an admin may change this account's password (a shared login). Absent => false.
    passwordLocked?: boolean;
    // Host survey's participant id (e.g. Qualtrics ResponseID) for segmented-flow users.
    // Both credential and join key: bound on first use, later blocks must match. Safe only
    // because it is long and random. Absent for users registered through Lexi's own form.
    externalPid?: string;
}

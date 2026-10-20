import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IApiKey } from '../types';

const apiKeysSchema = new Schema<IApiKey>(
    {
        userId: { type: String, required: true, index: true },
        provider: { type: String, enum: ['openai', 'anthropic', 'google', 'xai', 'openrouter'], required: true },
        name: { type: String, required: true },
        note: { type: String },
        encryptedKey: { type: String, required: true },
        iv: { type: String, required: true },
        maskedKey: { type: String, required: true },
        isValid: { type: Boolean, default: true },
        // At most one true per (userId, provider), kept by setDefaultKey. Not a unique index:
        // the flag moves in two writes, and the in-between state would be a write error.
        isDefault: { type: Boolean, default: false },
        lastUsedAt: { type: Date },
    },
    { timestamps: true, versionKey: false },
);

apiKeysSchema.index({ userId: 1, provider: 1 });

export const ApiKeysModel = mongoDbProvider.getModel('api_keys', apiKeysSchema);

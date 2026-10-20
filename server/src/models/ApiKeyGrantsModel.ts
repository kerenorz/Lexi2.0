import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IApiKeyGrant } from '../types';

/**
 * One account letting another use one of its keys until a set time. Live iff
 * `revokedAt == null && expiresAt > now`, checked on every send (no sweeper).
 * Revoking sets `revokedAt` and keeps the row for audit; re-granting adds a new row.
 */
const apiKeyGrantsSchema = new Schema<IApiKeyGrant>(
    {
        keyId: { type: String, required: true, index: true },
        granteeUserId: { type: String, required: true, index: true },
        // Audit only. Always the key's owner; grantees can't grant onward.
        grantedBy: { type: String, required: true },
        // No default, so an unbounded grant can't be written by omission.
        expiresAt: { type: Date, required: true },
        // null rather than absent when live, for consistent `{ revokedAt: null }` queries.
        revokedAt: { type: Date, default: null },
    },
    { timestamps: true, versionKey: false },
);

// Hot paths: keys a user may spend (every send) and who may spend a key.
apiKeyGrantsSchema.index({ granteeUserId: 1, revokedAt: 1, expiresAt: 1 });
apiKeyGrantsSchema.index({ keyId: 1, revokedAt: 1 });

export const ApiKeyGrantsModel = mongoDbProvider.getModel('api_key_grants', apiKeyGrantsSchema);

import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { ApiKeysModel } from '../models/ApiKeysModel';
import { ApiKeyGrantsModel } from '../models/ApiKeyGrantsModel';
import { UsersModel } from '../models/UsersModel';
import { IApiKeyGrant, IApiKeyPublic, ICreateApiKeyRequest, LLMProvider } from '../types';
import { encrypt, decrypt, maskApiKey } from '../utils/encryption';
import { AppError } from '../utils/errors';
import { makeOpenAIClient, OPENROUTER_BASE_URL } from './llmProviders.service';

class ApiKeysService {
    createKey = async (userId: string, request: ICreateApiKeyRequest): Promise<IApiKeyPublic> => {
        const validProviders: LLMProvider[] = ['openai', 'anthropic', 'google', 'xai', 'openrouter'];
        if (!validProviders.includes(request.provider)) {
            throw new AppError('Invalid provider', 400, 'INVALID_PROVIDER');
        }

        await this.validateKeyWithProvider(request.apiKey, request.provider);

        const { encryptedData, iv } = encrypt(request.apiKey);
        const masked = maskApiKey(request.apiKey);

        // The first key for a provider becomes the explicit default, so adding a second key
        // never silently changes which one is billed.
        const isFirstForProvider =
            (await ApiKeysModel.countDocuments({ userId, provider: request.provider })) === 0;

        const doc = await ApiKeysModel.create({
            userId,
            provider: request.provider,
            name: request.name,
            note: request.note,
            encryptedKey: encryptedData,
            iv,
            maskedKey: masked,
            isValid: true,
            isDefault: isFirstForProvider,
        });

        return this.toPublic(doc);
    };

    /** Grants live right now, oldest first. Liveness is checked at read time, never stored. */
    private liveGrantsTo = async (userId: string): Promise<IApiKeyGrant[]> => {
        if (!userId) return [];
        return ApiKeyGrantsModel.find({
            granteeUserId: String(userId),
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        })
            .sort({ createdAt: 1, _id: 1 })
            .lean() as unknown as IApiKeyGrant[];
    };

    private grantedKeyIds = async (userId: string): Promise<string[]> => {
        const grants = await this.liveGrantsTo(userId);
        return grants.map((grant) => String(grant.keyId));
    };

    /**
     * Revoked or lapsed grants, newest first. Display only, so a grantee sees why a key stopped
     * working; never used for resolution. No time window: the caller keeps one row per key.
     */
    private endedGrantsTo = async (userId: string): Promise<IApiKeyGrant[]> => {
        if (!userId) return [];
        return ApiKeyGrantsModel.find({
            granteeUserId: String(userId),
            $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lte: new Date() } }],
        })
            .sort({ createdAt: -1, _id: -1 })
            .lean() as unknown as IApiKeyGrant[];
    };

    /** Keys this account may spend. Granted keys are ordered by grant date, not key age. */
    private usableKeys = async (
        userId: string,
        provider: LLMProvider,
    ): Promise<{ owned: any[]; granted: any[] }> => {
        const owned = await ApiKeysModel.find({ userId, provider, isValid: true }).sort({
            createdAt: 1,
            _id: 1,
        });

        const grantedIds = await this.grantedKeyIds(userId);
        if (!grantedIds.length) return { owned, granted: [] };

        const ownedIds = new Set(owned.map((key) => String(key._id)));
        const rows = await ApiKeysModel.find({
            _id: { $in: grantedIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) },
            provider,
            isValid: true,
        });
        const byId = new Map(rows.map((key) => [String(key._id), key]));

        // De-duplicated, and never a key the account owns (it may have been transferred).
        const granted = grantedIds
            .filter((id, index) => grantedIds.indexOf(id) === index && !ownedIds.has(id))
            .map((id) => byId.get(id))
            .filter(Boolean);

        return { owned, granted };
    };

    getUserKeys = async (userId: string): Promise<IApiKeyPublic[]> => {
        const keys = await ApiKeysModel.find(
            { userId },
            { encryptedKey: 0, iv: 0 },
        )
            // Resolver order, so the first key per provider is the one billed.
            .sort({ provider: 1, isDefault: -1, createdAt: 1, _id: 1 })
            .lean();

        const owned = keys.map(this.toPublic);
        const granted = await this.grantedKeysFor(userId, new Set(owned.map((key) => key._id)));
        return [...owned, ...granted];
    };

    /**
     * Granted keys shaped like owned ones, flagged, with isDefault forced off (only the owner
     * picks the default). Never includes encryptedKey or iv.
     */
    private grantedKeysFor = async (userId: string, excludeIds: Set<string>): Promise<IApiKeyPublic[]> => {
        const [live, ended] = await Promise.all([this.liveGrantsTo(userId), this.endedGrantsTo(userId)]);
        // Live first: the dedupe keeps the first entry per key, so a re-lent key shows as active.
        const grants = [
            ...live.map((grant) => ({ grant, live: true })),
            ...ended.map((grant) => ({ grant, live: false })),
        ];
        if (!grants.length) return [];

        // Filter ids first: one unparseable id would CastError the whole key list.
        const ids = grants.map(({ grant }) => String(grant.keyId)).filter(this.isKeyId);
        const granterIds = grants.map(({ grant }) => String(grant.grantedBy)).filter(this.isKeyId);
        const [rows, granters] = await Promise.all([
            ApiKeysModel.find({ _id: { $in: ids } }, { encryptedKey: 0, iv: 0 }).lean(),
            UsersModel.find({ _id: { $in: granterIds } }, { username: 1 }).lean(),
        ]);
        const byId = new Map(rows.map((key: any) => [String(key._id), key]));
        const usernameOf = new Map(granters.map((user: any) => [String(user._id), user.username]));

        const seen = new Set<string>();
        return grants
            .filter(({ grant }) => {
                const id = String(grant.keyId);
                if (excludeIds.has(id) || seen.has(id) || !byId.has(id)) return false;
                seen.add(id);
                return true;
            })
            .map(({ grant, live }) => ({
                ...this.toPublic(byId.get(String(grant.keyId))),
                isDefault: false,
                granted: true,
                grantedByUsername: usernameOf.get(String(grant.grantedBy)),
                grantExpiresAt: grant.expiresAt,
                ...(live
                    ? {}
                    : {
                          grantExpired: true,
                          grantEndedReason: (grant.revokedAt ? 'revoked' : 'expired') as 'revoked' | 'expired',
                      }),
            }));
    };

    // A malformed id reads as "no such key" instead of a CastError 500.
    private isKeyId = (keyId: string): boolean => !!keyId && mongoose.Types.ObjectId.isValid(keyId);

    /** Make this key the default for its (userId, provider). */
    setDefaultKey = async (keyId: string, userId: string): Promise<IApiKeyPublic> => {
        const key = this.isKeyId(keyId) ? await ApiKeysModel.findOne({ _id: keyId, userId }) : null;
        if (!key) {
            throw new AppError('Key not found', 404, 'API_KEY_NOT_FOUND');
        }
        if (!key.isValid) {
            // An invalid default would only fail later, mid-study.
            throw new AppError('Cannot default to a key that failed validation', 400, 'INVALID_API_KEY');
        }

        await ApiKeysModel.updateMany(
            { userId, provider: key.provider, _id: { $ne: key._id } },
            { $set: { isDefault: false } },
        );
        await ApiKeysModel.updateOne({ _id: key._id }, { $set: { isDefault: true } });

        return this.toPublic({ ...key.toObject(), isDefault: true });
    };

    deleteKey = async (keyId: string, userId: string): Promise<void> => {
        // Read first: this mongoose version's findOneAndDelete returns a ModifyResult, not the doc.
        const deleted = this.isKeyId(keyId) ? await ApiKeysModel.findOne({ _id: keyId, userId }) : null;
        if (!deleted) {
            throw new AppError('Key not found', 404, 'API_KEY_NOT_FOUND');
        }
        await ApiKeysModel.deleteOne({ _id: deleted._id });

        // Close grants on the deleted key so revokedAt records when access ended.
        await ApiKeyGrantsModel.updateMany(
            { keyId: String(deleted._id), revokedAt: null },
            { $set: { revokedAt: new Date() } },
        );

        // Promote the oldest survivor, which resolution would pick anyway, so billing doesn't change.
        if (deleted.isDefault) {
            const survivor = await ApiKeysModel.findOne({
                userId,
                provider: deleted.provider,
                isValid: true,
            }).sort({ createdAt: 1, _id: 1 });
            if (survivor) {
                await ApiKeysModel.updateOne({ _id: survivor._id }, { $set: { isDefault: true } });
            }
        }
    };

    /**
     * Guards an experiment's key overrides: the key must be owned or granted, and match the
     * provider.
     */
    mayUseKeyForProvider = async (keyId: string, userId: string, provider: LLMProvider): Promise<boolean> => {
        if (!this.isKeyId(keyId)) return false;
        if (await ApiKeysModel.countDocuments({ _id: keyId, userId, provider })) return true;

        const grantedIds = await this.grantedKeyIds(userId);
        if (!grantedIds.includes(String(keyId))) return false;
        return (await ApiKeysModel.countDocuments({ _id: keyId, provider })) > 0;
    };

    /** Ownership only: gates rename, delete, set default and grant, which grantees may not do. */
    ownsKey = async (keyId: string, userId: string): Promise<boolean> => {
        if (!this.isKeyId(keyId)) return false;
        return (await ApiKeysModel.countDocuments({ _id: keyId, userId })) > 0;
    };

    /**
     * Which key gets billed: 1. the experiment's override if still usable, 2. the owner's
     * default, 3. the oldest owned key, 4. a granted key. Grants come last so lending a key
     * never moves an account's own billing. A stale override logs and falls back rather than
     * stopping a live study.
     */
    resolveDecryptedKey = async (
        userId: string,
        provider: LLMProvider,
        preferredKeyId?: string,
    ): Promise<string> => {
        const { owned, granted } = await this.usableKeys(userId, provider);
        if (!owned.length && !granted.length) {
            throw new AppError(
                `No valid ${provider} API key found. Please add one in Settings.`,
                403,
                'NO_API_KEY',
            );
        }

        const usable = [...owned, ...granted];
        let key = preferredKeyId ? usable.find((k) => String(k._id) === String(preferredKeyId)) : undefined;
        if (preferredKeyId && !key) {
            console.warn(
                `[apiKeys] experiment override ${preferredKeyId} (${provider}) is not a usable key for owner ${userId}; falling back to the default`,
            );
        }
        if (!key) key = owned.find((k) => k.isDefault);
        if (!key) key = owned[0];
        if (!key) key = granted[0];

        ApiKeysModel.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

        return decrypt(key.encryptedKey, key.iv);
    };

    resolveKeyOwnerId = (callerRole: string, callerUserId: string, experimentOwnerId?: string): string => {
        if (callerRole === 'participant') {
            if (!experimentOwnerId) {
                throw new AppError('Cannot resolve key owner for participant', 500, 'EXPERIMENT_MISCONFIGURED');
            }
            return experimentOwnerId;
        }
        return callerUserId;
    };

    // Counts granted keys too: an account running on a lent key is set up.
    hasAnyKey = async (userId: string): Promise<boolean> => {
        if (await ApiKeysModel.countDocuments({ userId, isValid: true })) return true;

        const grantedIds = await this.grantedKeyIds(userId);
        if (!grantedIds.length) return false;
        return (
            (await ApiKeysModel.countDocuments({
                _id: { $in: grantedIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) },
                isValid: true,
            })) > 0
        );
    };

    private validateKeyWithProvider = async (apiKey: string, provider: LLMProvider): Promise<void> => {
        try {
            switch (provider) {
                case 'openai': {
                    const client = new OpenAI({ apiKey, organization: null });
                    await client.models.list();
                    break;
                }
                case 'xai': {
                    // Nothing wraps this in withRetry, so keep the SDK's own retries.
                    const client = makeOpenAIClient(apiKey, 'xai', { sdkRetries: true });
                    await client.models.list();
                    break;
                }
                // Model list rather than a test completion: free, and names no model that could retire.
                case 'anthropic': {
                    const client = new Anthropic({ apiKey });
                    await client.models.list();
                    break;
                }
                case 'google': {
                    const client = new GoogleGenAI({ apiKey });
                    await client.models.list();
                    break;
                }
                case 'openrouter': {
                    // OpenRouter's model list accepts any key, so check GET /key instead. Free,
                    // and works on a key with no credit left.
                    const res = await fetch(`${OPENROUTER_BASE_URL}/key`, {
                        headers: { Authorization: `Bearer ${apiKey}` },
                        signal: AbortSignal.timeout(15_000),
                    });
                    if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
                    break;
                }
            }
        } catch (error) {
            throw new AppError(
                `API key validation failed for ${provider}: ${error.message}`,
                400,
                'INVALID_API_KEY',
            );
        }
    };

    private toPublic = (doc: any): IApiKeyPublic => ({
        _id: doc._id?.toString(),
        provider: doc.provider,
        name: doc.name,
        note: doc.note,
        maskedKey: doc.maskedKey,
        isValid: doc.isValid,
        isDefault: !!doc.isDefault,
        lastUsedAt: doc.lastUsedAt,
        createdAt: doc.createdAt,
    });
}

export const apiKeysService = new ApiKeysService();

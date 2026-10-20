import mongoose from 'mongoose';
import { ApiKeyGrantsModel } from '../models/ApiKeyGrantsModel';
import { ApiKeysModel } from '../models/ApiKeysModel';
import { UsersModel } from '../models/UsersModel';
import { IApiKeyGrant, IApiKeyGrantPublic, ICreateApiKeyGrantRequest } from '../types';
import { AppError } from '../utils/errors';

/**
 * Grant lifecycle (create, list, revoke) for lending key use until an expiry. Key resolution
 * stays in apiKeys.service to avoid a service cycle. A grantee may spend a key but never read
 * or pass it on: nothing here returns key material, and writes are checked against the owner.
 */
class ApiKeyGrantsService {
    private isId = (id: string): boolean => !!id && mongoose.Types.ObjectId.isValid(id);

    private isLive = (grant: IApiKeyGrant): boolean =>
        !grant.revokedAt && new Date(grant.expiresAt).getTime() > Date.now();

    /** Someone else's key is reported as 404, not 403, so ids can't be probed. */
    private ownedKeyOrThrow = async (keyId: string, ownerUserId: string) => {
        const key = this.isId(keyId) ? await ApiKeysModel.findOne({ _id: keyId, userId: ownerUserId }) : null;
        if (!key) {
            throw new AppError('Key not found', 404, 'API_KEY_NOT_FOUND');
        }
        return key;
    };

    /** One live grant per key and grantee (409): revoke first to change the expiry. */
    createGrant = async (
        keyId: string,
        ownerUserId: string,
        request: ICreateApiKeyGrantRequest,
    ): Promise<IApiKeyGrantPublic> => {
        const key = await this.ownedKeyOrThrow(keyId, ownerUserId);

        const granteeUserId = String(request?.granteeUserId ?? '');
        if (!this.isId(granteeUserId)) {
            throw new AppError('A grantee is required', 400, 'INVALID_MESSAGE_FORMAT');
        }
        if (granteeUserId === String(ownerUserId)) {
            throw new AppError('You already own this key', 400, 'INVALID_GRANTEE');
        }

        const grantee = await UsersModel.findById(granteeUserId, { _id: 1, role: 1, username: 1 }).lean();
        // Participants never run studies, so they can't be grantees.
        if (!grantee || (grantee.role !== 'user' && grantee.role !== 'admin')) {
            throw new AppError('Grantee not found', 404, 'USER_NOT_FOUND');
        }

        const expiresAt = new Date(request?.expiresAt as any);
        if (!request?.expiresAt || Number.isNaN(expiresAt.getTime())) {
            throw new AppError('An expiry date is required', 400, 'INVALID_MESSAGE_FORMAT');
        }
        if (expiresAt.getTime() <= Date.now()) {
            throw new AppError('The expiry date must be in the future', 400, 'INVALID_EXPIRY');
        }

        const existing = await ApiKeyGrantsModel.findOne({
            keyId: String(key._id),
            granteeUserId,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        }).lean();
        if (existing) {
            throw new AppError(
                'This account already has access to this key. Revoke it first to change the expiry.',
                409,
                'GRANT_EXISTS',
            );
        }

        const doc = await ApiKeyGrantsModel.create({
            keyId: String(key._id),
            granteeUserId,
            grantedBy: String(ownerUserId),
            expiresAt,
            revokedAt: null,
        });

        return this.toPublic(doc.toObject(), {
            key,
            granteeUsername: grantee.username,
        });
    };

    /** All grants on one of my keys, newest first, including lapsed and revoked ones. */
    grantsForKey = async (keyId: string, ownerUserId: string): Promise<IApiKeyGrantPublic[]> => {
        const key = await this.ownedKeyOrThrow(keyId, ownerUserId);
        const grants = (await ApiKeyGrantsModel.find({ keyId: String(key._id) })
            .sort({ createdAt: -1, _id: -1 })
            .lean()) as unknown as IApiKeyGrant[];
        return this.decorate(grants, { key });
    };

    /** Grants I issued across my keys, optionally for one grantee. */
    grantsIssuedBy = async (ownerUserId: string, granteeUserId?: string): Promise<IApiKeyGrantPublic[]> => {
        const filter: any = { grantedBy: String(ownerUserId) };
        if (granteeUserId) {
            if (!this.isId(granteeUserId)) return [];
            filter.granteeUserId = String(granteeUserId);
        }
        const grants = (await ApiKeyGrantsModel.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .lean()) as unknown as IApiKeyGrant[];
        return this.decorate(grants);
    };

    /** Live grants to me, for the grantee's read-only key list. */
    grantsToUser = async (granteeUserId: string): Promise<IApiKeyGrantPublic[]> => {
        const grants = (await ApiKeyGrantsModel.find({
            granteeUserId: String(granteeUserId),
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        })
            .sort({ createdAt: 1, _id: 1 })
            .lean()) as unknown as IApiKeyGrant[];
        return this.decorate(grants);
    };

    /**
     * Checked against the key's owner, not the issuer. Revoking a closed grant is a no-op so
     * revokedAt keeps the moment access actually ended.
     */
    revokeGrant = async (grantId: string, ownerUserId: string): Promise<IApiKeyGrantPublic> => {
        const grant = this.isId(grantId)
            ? ((await ApiKeyGrantsModel.findById(grantId).lean()) as unknown as IApiKeyGrant)
            : null;
        if (!grant) {
            throw new AppError('Grant not found', 404, 'GRANT_NOT_FOUND');
        }

        const key = await this.ownedKeyOrThrow(String(grant.keyId), ownerUserId);

        if (!grant.revokedAt) {
            await ApiKeyGrantsModel.updateOne({ _id: grant._id }, { $set: { revokedAt: new Date() } });
            grant.revokedAt = new Date();
        }
        return this.toPublic(grant, { key });
    };

    /** Usernames currently allowed to spend each of this owner's keys: keyId -> [username]. */
    granteesByKey = async (ownerUserId: string): Promise<Record<string, string[]>> => {
        const grants = (await ApiKeyGrantsModel.find({
            grantedBy: String(ownerUserId),
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        }).lean()) as unknown as IApiKeyGrant[];
        if (!grants.length) return {};

        const usernameOf = await this.usernames(grants.flatMap((g) => [String(g.granteeUserId)]));
        const byKey: Record<string, string[]> = {};
        grants.forEach((grant) => {
            const name = usernameOf.get(String(grant.granteeUserId));
            if (!name) return;
            (byKey[String(grant.keyId)] = byKey[String(grant.keyId)] || []).push(name);
        });
        return byKey;
    };

    private usernames = async (ids: string[]): Promise<Map<string, string>> => {
        const unique = [...new Set(ids.filter((id) => this.isId(id)))];
        if (!unique.length) return new Map();
        const users = await UsersModel.find({ _id: { $in: unique } }, { username: 1 }).lean();
        return new Map(users.map((user: any) => [String(user._id), user.username as string]));
    };

    /** Join the names a grant list needs: the key it points at, and both accounts. */
    private decorate = async (
        grants: IApiKeyGrant[],
        preloaded: { key?: any } = {},
    ): Promise<IApiKeyGrantPublic[]> => {
        if (!grants.length) return [];

        const keyIds = [...new Set(grants.map((grant) => String(grant.keyId)))].filter((id) => this.isId(id));
        const keys = preloaded.key
            ? [preloaded.key]
            : await ApiKeysModel.find({ _id: { $in: keyIds } }, { encryptedKey: 0, iv: 0 }).lean();
        const keyById = new Map(keys.map((key: any) => [String(key._id), key]));

        const usernameOf = await this.usernames(
            grants.flatMap((grant) => [String(grant.granteeUserId), String(grant.grantedBy)]),
        );

        return grants.map((grant) =>
            this.toPublic(grant, {
                key: keyById.get(String(grant.keyId)),
                granteeUsername: usernameOf.get(String(grant.granteeUserId)),
                grantedByUsername: usernameOf.get(String(grant.grantedBy)),
            }),
        );
    };

    private toPublic = (
        grant: any,
        extras: { key?: any; granteeUsername?: string; grantedByUsername?: string } = {},
    ): IApiKeyGrantPublic => ({
        _id: grant._id?.toString(),
        keyId: String(grant.keyId),
        keyName: extras.key?.name,
        keyProvider: extras.key?.provider,
        // The mask, never the key.
        maskedKey: extras.key?.maskedKey,
        granteeUserId: String(grant.granteeUserId),
        granteeUsername: extras.granteeUsername,
        grantedBy: String(grant.grantedBy),
        grantedByUsername: extras.grantedByUsername,
        expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt ?? null,
        isLive: this.isLive(grant),
        createdAt: grant.createdAt,
    });
}

export const apiKeyGrantsService = new ApiKeyGrantsService();

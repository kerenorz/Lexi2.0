import mongoose from 'mongoose';

// 'openrouter' is one key for many companies' models; the others are direct keys.
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'openrouter';

export interface IApiKey {
    _id?: mongoose.Types.ObjectId | string;
    userId: string;
    provider: LLMProvider;
    name: string;
    note?: string;
    encryptedKey: string;
    iv: string;
    maskedKey: string;
    isValid: boolean;
    // The billed key for (userId, provider) unless an experiment overrides it. At most one;
    // only setDefaultKey writes it. May be absent on every key, so resolution has a fallback.
    isDefault?: boolean;
    lastUsedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IApiKeyPublic {
    _id: string;
    provider: LLMProvider;
    name: string;
    note?: string;
    maskedKey: string;
    isValid: boolean;
    isDefault?: boolean;
    // Titles of the owner's studies that name this key. Joined by the list route, not stored.
    usedByStudies?: string[];
    lastUsedAt?: Date;
    createdAt?: Date;

    // Set when the key comes from a grant: the grantee may spend it and nothing else.
    granted?: boolean;
    grantedByUsername?: string;
    grantExpiresAt?: Date;
    // An ended grant, still listed so a stopped study shows why. Not spendable.
    grantExpired?: boolean;
    grantEndedReason?: 'expired' | 'revoked';
    // On an owned key: the accounts allowed to spend it. Joined by the list route.
    grantedTo?: string[];
}

// One account letting another spend one of its keys until a set time. A grantee can never
// read the key material; nothing here carries it.
export interface IApiKeyGrant {
    _id?: mongoose.Types.ObjectId | string;
    keyId: string;
    granteeUserId: string;
    // Always the owner: grants can't be passed on.
    grantedBy: string;
    expiresAt: Date;
    // null while live. Revoking sets a date instead of deleting the row.
    revokedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IApiKeyGrantPublic {
    _id: string;
    keyId: string;
    // Enough to recognise the key, not to use it.
    keyName?: string;
    keyProvider?: LLMProvider;
    maskedKey?: string;
    granteeUserId: string;
    granteeUsername?: string;
    grantedBy: string;
    grantedByUsername?: string;
    expiresAt: Date;
    revokedAt?: Date | null;
    // Computed at read time from expiresAt/revokedAt.
    isLive: boolean;
    createdAt?: Date;
}

export interface ICreateApiKeyGrantRequest {
    granteeUserId: string;
    expiresAt: string | Date;
}

export interface ICreateApiKeyRequest {
    provider: LLMProvider;
    name: string;
    note?: string;
    apiKey: string;
}

// A study's per-provider billing override (provider -> key _id). Read live, not snapshotted,
// so billing can be fixed mid-study. A map because a study can mix providers (and voice needs
// OpenAI). A missing provider falls back to the owner's default.
export type ApiKeyOverrides = Partial<Record<LLMProvider, string>>;

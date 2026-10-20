import { ApiPaths } from '../constants';
import axiosInstance from './AxiosInstance';

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'openrouter';

export interface ApiKeyPublic {
    _id: string;
    provider: LLMProvider;
    name: string;
    note?: string;
    maskedKey: string;
    isValid: boolean;
    // Account default for this provider. May be absent on older keys, so the list infers one.
    isDefault?: boolean;
    // Studies that override to this key.
    usedByStudies?: string[];
    lastUsedAt?: string;
    createdAt?: string;

    // Reached through a grant: spend only, no rename/default/delete.
    granted?: boolean;
    grantedByUsername?: string;
    grantExpiresAt?: string;
    // Ended grant, still listed so access doesn't silently vanish. Not spendable.
    grantExpired?: boolean;
    grantEndedReason?: 'expired' | 'revoked';
    // On an owned key: accounts allowed to spend it.
    grantedTo?: string[];
}

// No key material, only enough to recognise the key.
export interface ApiKeyGrant {
    _id: string;
    keyId: string;
    keyName?: string;
    keyProvider?: LLMProvider;
    maskedKey?: string;
    granteeUserId: string;
    granteeUsername?: string;
    grantedBy: string;
    grantedByUsername?: string;
    expiresAt: string;
    revokedAt?: string | null;
    // Computed server-side at read time.
    isLive: boolean;
    createdAt?: string;
}

export const getApiKeys = async (): Promise<ApiKeyPublic[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.API_KEYS_PATH}`);
    return response.data;
};

export const createApiKey = async (data: {
    provider: LLMProvider;
    name: string;
    note?: string;
    apiKey: string;
}): Promise<ApiKeyPublic> => {
    const response = await axiosInstance.post(`/${ApiPaths.API_KEYS_PATH}`, data);
    return response.data;
};

export const setDefaultApiKey = async (keyId: string): Promise<ApiKeyPublic> => {
    const response = await axiosInstance.patch(`/${ApiPaths.API_KEYS_PATH}/${keyId}/default`);
    return response.data;
};

// Studies billing to this key, so the delete confirmation can name them.
export const getExperimentsByApiKey = async (keyId: string): Promise<{ _id: string; title: string }[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.API_KEYS_PATH}/${keyId}/experiments`);
    return response.data;
};

// Without `force` the server returns 409 if studies use the key. With it, those studies
// fall back to the account default.
export const deleteApiKey = async (keyId: string, force = false): Promise<void> => {
    await axiosInstance.delete(`/${ApiPaths.API_KEYS_PATH}/${keyId}${force ? '?force=true' : ''}`);
};

export const checkHasApiKeys = async (): Promise<boolean> => {
    const response = await axiosInstance.get(`/${ApiPaths.API_KEYS_PATH}/check`);
    return response.data.hasKeys;
};

// Grants: lending a key to another account until a date. Only the key's owner can issue them.

// All grants on this key, including lapsed and revoked.
export const getKeyGrants = async (keyId: string): Promise<ApiKeyGrant[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.API_KEYS_PATH}/${keyId}/grants`);
    return response.data;
};

export const grantKeyAccess = async (
    keyId: string,
    granteeUserId: string,
    expiresAt: string,
): Promise<ApiKeyGrant> => {
    const response = await axiosInstance.post(`/${ApiPaths.API_KEYS_PATH}/${keyId}/grants`, {
        granteeUserId,
        expiresAt,
    });
    return response.data;
};

export const revokeKeyGrant = async (grantId: string): Promise<ApiKeyGrant> => {
    const response = await axiosInstance.patch(`/${ApiPaths.API_KEYS_PATH}/grants/${grantId}/revoke`);
    return response.data;
};

// Grants I issued, optionally for one account.
export const getIssuedGrants = async (granteeUserId?: string): Promise<ApiKeyGrant[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.API_KEYS_PATH}/grants/issued`, {
        params: granteeUserId ? { granteeUserId } : undefined,
    });
    return response.data;
};

export const getMyGrants = async (): Promise<ApiKeyGrant[]> => {
    const response = await axiosInstance.get(`/${ApiPaths.API_KEYS_PATH}/grants/mine`);
    return response.data;
};

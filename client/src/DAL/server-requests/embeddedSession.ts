// Bearer token for the survey iframe, where the auth cookie is third-party and Safari and
// Firefox block it. Kept in memory, not localStorage, so it can't outlive the tab; a reload
// re-runs the idempotent entry route for a fresh one.

let token: string | null = null;

export const setEmbeddedToken = (next: string | null | undefined): void => {
    token = next || null;
};

export const getEmbeddedToken = (): string | null => token;

export const clearEmbeddedToken = (): void => {
    token = null;
};

// For the raw-fetch streaming calls, which bypass the axios interceptor. A missing header
// only fails in browsers that block third-party cookies.
export const withAuthHeaders = (headers: Record<string, string> = {}): Record<string, string> => {
    const auth = getEmbeddedToken();
    return auth ? { ...headers, Authorization: `Bearer ${auth}` } : headers;
};

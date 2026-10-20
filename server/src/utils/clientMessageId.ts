// Browser-generated message id, so a failed group round can be re-synced and a re-send refused
// as a duplicate. Untrusted: an invalid id is dropped (losing only de-duplication), not refused.
// Must match the client's pattern in input-box/clientMessageId.ts.
export const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export const clientMessageIdOf = (value: unknown): string | undefined =>
    typeof value === 'string' && CLIENT_MESSAGE_ID_PATTERN.test(value) ? value : undefined;

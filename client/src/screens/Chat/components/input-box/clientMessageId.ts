// Client id for a participant message, made on submit. The server rejects duplicates, and group
// re-sync finds a message by id rather than by text. A Resend is a new submit with a new id.

// Must match the server's pattern, which drops a non-matching id.
export const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export interface IdSource {
    crypto?: {
        randomUUID?: () => string;
        getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
    };
    // Last resort, for a browser with no crypto.
    random?: () => number;
    now?: () => number;
}

const browserSource = (): IdSource => ({
    crypto: typeof globalThis !== 'undefined' ? (globalThis.crypto as IdSource['crypto']) : undefined,
    random: Math.random,
    now: Date.now,
});

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// Distinguishes two last-resort ids made in the same millisecond.
let fallbackCounter = 0;

export const newClientMessageId = (source: IdSource = browserSource()): string => {
    // randomUUID needs a secure context; plain-HTTP setups fall through.
    if (typeof source.crypto?.randomUUID === 'function') return source.crypto.randomUUID();
    // getRandomValues works everywhere: build a v4 UUID.
    if (typeof source.crypto?.getRandomValues === 'function') {
        const bytes = source.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const h = hex(bytes);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    // Not a security token, only unique within a conversation, so this is enough.
    fallbackCounter += 1;
    const now = (source.now ?? Date.now)();
    const draw = Math.floor((source.random ?? Math.random)() * 0x100000000);
    return `m-${now.toString(36)}-${fallbackCounter.toString(36)}-${draw.toString(36)}`;
};

// Removes a refused user message: by id, else the newest user bubble with its text. By id first
// because a later group message can have the same text. Returns the same list if nothing matches.
export const removeUserMessage = <M extends { role?: string; content?: unknown; clientMessageId?: string }>(
    messages: M[],
    target: { content: unknown; clientMessageId?: string },
): M[] => {
    let index = -1;
    if (target.clientMessageId) {
        index = messages.findIndex((m) => m?.role === 'user' && m.clientMessageId === target.clientMessageId);
    } else {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]?.role === 'user' && messages[i]?.content === target.content) {
                index = i;
                break;
            }
        }
    }
    return index < 0 ? messages : [...messages.slice(0, index), ...messages.slice(index + 1)];
};

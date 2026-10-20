// One round at a time per conversation. Rounds number messages from the transcript length,
// so overlapping rounds (double send, two tabs) wrote duplicate numbers and overshot the cap.
// Only round routes lock; segment routes defer block closes via isRoundInFlight instead.
//
// In-process only: correct while a single instance serves the API. Scaling out needs a
// database lease or a unique {conversationId, messageNumber} index.
//
// A holder past CONVERSATION_LOCK_MAX_HOLD_MS is logged and the next caller let through, so a
// hung provider call can't freeze the conversation. Provider timeouts should fire first.

export const CONVERSATION_LOCK_MAX_HOLD_MS = 5 * 60 * 1000;

interface ConversationQueue {
    // Callers wait on the previous tail, so they run in arrival order.
    tail: Promise<void>;
    // Holding or waiting; the entry is deleted at 0 so the map only holds busy conversations.
    depth: number;
}

const queues = new Map<string, ConversationQueue>();

export const withConversationLock = async <T>(
    conversationId: string,
    fn: () => Promise<T>,
    maxHoldMs: number = CONVERSATION_LOCK_MAX_HOLD_MS,
): Promise<T> => {
    // String() because an admin's conversationId is not validated upstream.
    const key = String(conversationId);
    const queue = queues.get(key) ?? { tail: Promise.resolve(), depth: 0 };
    const previous = queue.tail;

    let signalReleased!: () => void;
    queue.tail = new Promise<void>((resolve) => (signalReleased = resolve));
    queue.depth += 1;
    queues.set(key, queue);

    // Runs once, on round settle or backstop, so an overrun round can't release a later holder's lock.
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        queue.depth -= 1;
        if (queue.depth === 0 && queues.get(key) === queue) queues.delete(key);
        signalReleased();
    };

    // Never rejects.
    await previous;

    const acquiredAt = Date.now();
    const backstop = setTimeout(() => {
        console.error(
            `[lock] conversation ${key}: a round has held it for over ${Math.round(maxHoldMs / 1000)}s ` +
                `without settling — letting the next round through. If the stuck round ever finishes, ` +
                `its messages can share numbers with the next round's.`,
        );
        release();
    }, maxHoldMs);
    // Don't keep the process alive at shutdown.
    (backstop as { unref?: () => void }).unref?.();

    try {
        return await fn();
    } finally {
        clearTimeout(backstop);
        if (released) {
            console.warn(`[lock] conversation ${key}: the round that overran the max hold settled after ${Date.now() - acquiredAt}ms`);
        }
        release();
    }
};

// Callers holding or queued; 0 when idle.
export const conversationLockDepth = (conversationId: string): number => queues.get(String(conversationId))?.depth ?? 0;

// Conversations currently locked or queued.
export const activeConversationLocks = (): number => queues.size;

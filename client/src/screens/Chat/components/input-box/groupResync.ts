// After a group stream fails, find out what the server did with the message (the round keeps
// running server-side). Matches by clientMessageId, since matching by text hits older "ok"s.
//   - Found with replies: those replies are the round.
//   - Not found, or no replies yet: re-send with the same id. The server waits on the conversation
//     lock, then runs it or answers 409 DUPLICATE_MESSAGE (already persisted: re-read the transcript).
//   - Re-send fails: the round failed (Resend), never an empty round.
// Without an id it falls back to text and never re-sends a found message (it would persist twice).

export interface ResyncTarget {
    content: string;
    clientMessageId?: string;
}

type TranscriptTurn = { role?: string; content?: unknown; clientMessageId?: string };

export type TranscriptMatch<M> = { found: false } | { found: true; turns: M[] };

// Locate the target turn (by id, else newest matching text) and the agent turns after it.
export const findCommittedTurns = <M extends TranscriptTurn>(transcript: readonly M[], target: ResyncTarget): TranscriptMatch<M> => {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const turn = transcript[i];
        if (turn?.role !== 'user') continue;
        const isTarget = target.clientMessageId
            ? turn.clientMessageId === target.clientMessageId
            : turn.content === target.content;
        if (isTarget) return { found: true, turns: transcript.slice(i + 1).filter((t) => t?.role === 'assistant') };
    }
    return { found: false };
};

// Check the reason, not just 409: MESSAGE_NUMBER_CONFLICT is also 409 and means not persisted.
export const isDuplicateRefusal = (error: unknown): boolean => {
    const response = (error as { response?: { status?: unknown; data?: { reason?: unknown } } } | null)?.response;
    return response?.status === 409 && response?.data?.reason === 'DUPLICATE_MESSAGE';
};

export type ResyncOutcome<M> =
    // Persisted; turns may be empty (a silent round).
    | { kind: 'committed'; turns: M[] }
    | { kind: 'failed'; error: unknown };

export interface ResyncIO<M> {
    // GET /conversation. May throw.
    readTranscript: () => Promise<readonly M[]>;
    // POST /message with the same id. Resolves with the agent turns, else throws the axios error.
    repost: () => Promise<M[]>;
}

export const resyncGroupRound = async <M extends TranscriptTurn>(target: ResyncTarget, io: ResyncIO<M>): Promise<ResyncOutcome<M>> => {
    // Unreadable transcript counts as not found; the server de-duplicates the re-send.
    const read = async (): Promise<readonly M[]> => {
        try {
            return await io.readTranscript();
        } catch {
            return [];
        }
    };

    const match = findCommittedTurns(await read(), target);
    if (match.found && (!target.clientMessageId || match.turns.length > 0)) {
        return { kind: 'committed', turns: match.turns };
    }

    try {
        return { kind: 'committed', turns: await io.repost() };
    } catch (error) {
        if (!target.clientMessageId || !isDuplicateRefusal(error)) return { kind: 'failed', error };
        // Already persisted. Never fail here: Resend would duplicate the turn. Unread turns show on next load.
        const again = findCommittedTurns(await read(), target);
        return { kind: 'committed', turns: again.found ? again.turns : [] };
    }
};

import { TERMINAL_ERROR_REASONS } from '../../../../DAL/errorReasons';

// Group composer send queue. A message sent mid-round waits and runs as its own round, since
// concurrent rounds interleave and the server order stops matching the screen.
// Invariant: every on-screen message reaches the server once, in screen order. A bubble is only
// withdrawn on a terminal refusal or a closed block. Pure; InputBox applies each step.

// ok: the round ran, including a silent one (no agent turns).
// failed: not persisted, Resend can fix it.
// refused: terminal reason; every later message would be refused too.
export type RoundOutcome = 'ok' | 'failed' | 'refused';

export interface GroupSendState<T> {
    // Stays true until the caller settles the round, after the last bubble is revealed.
    readonly roundInFlight: boolean;
    // On-screen, unsent messages, oldest first. Always the newest user bubbles.
    readonly queue: readonly T[];
}

// At most one of `send` and `withdraw` is non-empty.
export interface GroupSendStep<T> {
    readonly state: GroupSendState<T>;
    // Its bubble is already on screen; don't re-append it.
    readonly send: T | null;
    // Remove these bubbles: they will never be sent.
    readonly withdraw: readonly T[];
    // Idle after a successful round: the only time an agent-only round may start. The caller decides.
    readonly mayGoAutonomous: boolean;
}

export const GROUP_SEND_IDLE: GroupSendState<never> = Object.freeze({
    roundInFlight: false,
    queue: Object.freeze([] as never[]),
});

const NOTHING: readonly never[] = Object.freeze([] as never[]);

const runHead = <T>(queue: readonly T[]): GroupSendStep<T> =>
    queue.length > 0
        ? {
              state: { roundInFlight: true, queue: queue.slice(1) },
              send: queue[0],
              withdraw: NOTHING,
              mayGoAutonomous: false,
          }
        : { state: GROUP_SEND_IDLE, send: null, withdraw: NOTHING, mayGoAutonomous: false };

// Always joins the back. When idle the oldest waiting message starts: a non-empty idle queue only
// follows a failure, and the resent bubble lands below the backlog.
export const submitGroupMessage = <T>(state: GroupSendState<T>, message: T): GroupSendStep<T> => {
    const queue = [...state.queue, message];
    if (state.roundInFlight) {
        return { state: { roundInFlight: true, queue }, send: null, withdraw: NOTHING, mayGoAutonomous: false };
    }
    return runHead(queue);
};

// `blockClosed`: the survey block is closed, so nothing waiting can be sent into it.
export const settleGroupRound = <T>(
    state: GroupSendState<T>,
    { outcome, blockClosed }: { outcome: RoundOutcome; blockClosed: boolean },
): GroupSendStep<T> => {
    if (blockClosed || outcome === 'refused') {
        return { state: GROUP_SEND_IDLE, send: null, withdraw: state.queue, mayGoAutonomous: false };
    }
    if (outcome === 'failed') {
        // Keep the backlog for Resend. No autonomous round: it would bury the unanswered message.
        return {
            state: { roundInFlight: false, queue: state.queue },
            send: null,
            withdraw: NOTHING,
            mayGoAutonomous: false,
        };
    }
    const next = runHead(state.queue);
    return next.send === null ? { ...next, mayGoAutonomous: true } : next;
};

// A failed agent-only round fails silently; anything queued during it still gets its round.
export const abortAutonomousRound = <T>(state: GroupSendState<T>): GroupSendStep<T> => runHead(state.queue);

// Null unless fully idle: an agent-only round must never jump ahead of a participant message.
export const startAutonomousRound = <T>(state: GroupSendState<T>): GroupSendState<T> | null =>
    state.roundInFlight || state.queue.length > 0 ? null : { roundInFlight: true, queue: NOTHING };

// All error shapes (NDJSON frame, axios error, refusal) carry the reason at response.data.reason.
export const roundFailureOutcome = (error: unknown): Exclude<RoundOutcome, 'ok'> =>
    TERMINAL_ERROR_REASONS.has((error as any)?.response?.data?.reason) ? 'refused' : 'failed';

// Remove queued bubbles by text, one per entry. Safe because queued messages are always the newest
// user bubbles, so removing the last match never hits an earlier identical message.
export const withdrawUserBubbles = <M extends { role?: string; content?: unknown }>(
    messages: M[],
    contents: readonly unknown[],
): M[] => {
    if (contents.length === 0) return messages;
    const out = [...messages];
    contents.forEach((content) => {
        for (let i = out.length - 1; i >= 0; i--) {
            if (out[i]?.role === 'user' && out[i]?.content === content) {
                out.splice(i, 1);
                return;
            }
        }
    });
    return out;
};

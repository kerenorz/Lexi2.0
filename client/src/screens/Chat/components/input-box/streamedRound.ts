// Queue for one token-streamed group round: which turn is typing, which wait, which final frame
// belongs to which turn, and when the round has fully revealed (`drained`). Pure; InputBox
// supplies the typewriter and bubbles.
// The server writes turns strictly in sequence, so a new turn's first delta proves every earlier
// turn is done. A turn with no visible text never gets a bubble or another turn's final frame
// (the server saves no blank reply, so it sends no final frame for one).

import { isStreamRefusal } from '../../../../DAL/streamRefusal';

export interface TurnReveal {
    push: (chunk: string) => void;
    // No more text is coming; finish typing what arrived.
    endInput: () => void;
    // Stop where it is, without completing.
    cancel: () => void;
}

export interface StreamedTurn<M, R extends TurnReveal = TurnReveal> {
    readonly turnId: string;
    readonly speakerId: string;
    readonly speakerName: string;
    // 2nd+ bubble of a split turn only: a shorter pause that replaces the inter-turn gap.
    readonly interSegmentPauseMs?: number;
    // All text received; used only to check for visible text.
    text: string;
    // Text that arrived before this turn's typewriter started.
    buffered: string;
    // No more text is coming.
    ended: boolean;
    reveal: R | null;
    // The saved document from the final frame; null if never saved.
    saved: M | null;
}

export interface StreamedDelta {
    turnId: string;
    speakerId: string;
    speakerName: string;
    text: string;
    interSegmentPauseMs?: number;
}

export interface StreamedRoundEffects<M, R extends TurnReveal> {
    // Call `finished` once, when the last character is on screen. Only for turns with visible text.
    startReveal: (turn: StreamedTurn<M, R>, finished: () => void) => R;
    wait: (ms: number, cb: () => void) => void;
    now: () => number;
    // Gap between speakers. Never after the last turn.
    interTurnGapMs: number;
}

export interface StreamedRound<M, R extends TurnReveal> {
    delta: (delta: StreamedDelta) => void;
    // Returns the matching turn, or null if nothing was token-streamed (a paced round).
    final: (saved: M) => StreamedTurn<M, R> | null;
    // finish: end every turn and type out what arrived. abandon: stop everything and drain now,
    // for a round that saved nothing (the caller removes its bubbles).
    close: (how: 'finish' | 'abandon') => void;
    // Resolves once the round has finished revealing, never before close().
    readonly drained: Promise<void>;
    // In arrival order.
    turns: () => readonly StreamedTurn<M, R>[];
}

// Matches the server's isBlankReply (`!reply.trim()`): \s is exactly what trim() removes.
export const hasVisibleText = (text: string): boolean => /\S/.test(text);

// How a user round settles once its stream closes:
//   completed     - no error (an empty round counts too).
//   refused       - non-2xx before the round ran; nothing saved, never re-synced. Checked first,
//                   since a refusal also carries `response.data` like an error frame.
//   not-persisted - server error frame before any turn was saved; the user turn was taken back.
//   unconfirmed   - connection error before any save; the server may still finish, so ask it.
//   cut-short     - error after a saved turn; the round counts.
export type StreamCloseKind = 'completed' | 'refused' | 'cut-short' | 'not-persisted' | 'unconfirmed';

// The server's in-band error frame, as opposed to a fetch or reader exception.
const isServerErrorFrame = (error: unknown): boolean => {
    const response = (error as { response?: unknown } | null | undefined)?.response;
    return typeof response === 'object' && response !== null && (response as { data?: unknown }).data != null;
};

export const classifyStreamClose = ({ streamError, savedTurns }: { streamError: unknown; savedTurns: number }): StreamCloseKind => {
    if (!streamError) return 'completed';
    if (isStreamRefusal(streamError)) return 'refused';
    if (savedTurns > 0) return 'cut-short';
    return isServerErrorFrame(streamError) ? 'not-persisted' : 'unconfirmed';
};

export const createStreamedRound = <M, R extends TurnReveal>(fx: StreamedRoundEffects<M, R>): StreamedRound<M, R> => {
    // Waiting turns; the head may be typing.
    const queue: StreamedTurn<M, R>[] = [];
    // All turns, never shifted; final frames match by arrival order. Split segments have their own turnIds.
    const arrived: StreamedTurn<M, R>[] = [];
    const byId = new Map<string, StreamedTurn<M, R>>();
    // How many of `arrived` can no longer receive a final frame.
    let finalized = 0;
    // The head is typing, or held for the gap before it.
    let active = false;
    let closed = false;
    let abandoned = false;
    let lastTurnEndedAt: number | null = null;

    let resolveDrain!: () => void;
    const drained = new Promise<void>((resolve) => {
        resolveDrain = resolve;
    });
    const settleIfDone = () => {
        if (closed && !active && queue.length === 0) resolveDrain();
    };

    // A turn without a typewriter yet gets endInput when pump starts it.
    const end = (turn: StreamedTurn<M, R>) => {
        if (turn.ended) return;
        turn.ended = true;
        turn.reveal?.endInput();
    };

    const pump = (): void => {
        if (active || abandoned) return;
        const turn = queue[0];
        if (!turn) {
            settleIfDone();
            return;
        }
        // No visible text: wait if still open, drop it (no bubble, no gap) if ended.
        if (!hasVisibleText(turn.text)) {
            if (!turn.ended) return;
            queue.shift();
            pump();
            return;
        }
        // Gap after the previous speaker; `active` blocks a mid-gap delta from starting early.
        // After the empty-queue check, so it never delays the round's end. A split turn's later
        // bubbles use the shorter inter-segment pause instead.
        if (lastTurnEndedAt !== null) {
            const gap = turn.interSegmentPauseMs ?? fx.interTurnGapMs;
            const wait = gap - (fx.now() - lastTurnEndedAt);
            if (wait > 0) {
                active = true;
                fx.wait(wait, () => {
                    active = false;
                    lastTurnEndedAt = null;
                    pump();
                });
                return;
            }
            lastTurnEndedAt = null;
        }
        active = true;
        let done = false;
        const reveal = fx.startReveal(turn, () => {
            if (done || abandoned) return;
            done = true;
            queue.shift();
            active = false;
            lastTurnEndedAt = fx.now();
            pump();
        });
        turn.reveal = reveal;
        if (turn.buffered) {
            reveal.push(turn.buffered);
            turn.buffered = '';
        }
        if (turn.ended) reveal.endInput();
    };

    return {
        delta: (delta) => {
            if (abandoned) return;
            let turn = byId.get(delta.turnId);
            if (!turn) {
                // A new turn means earlier ones are done; end blank ones now so they don't block the queue.
                arrived.forEach((earlier) => {
                    if (!hasVisibleText(earlier.text)) end(earlier);
                });
                turn = {
                    turnId: delta.turnId,
                    speakerId: delta.speakerId,
                    speakerName: delta.speakerName,
                    interSegmentPauseMs: delta.interSegmentPauseMs,
                    text: '',
                    buffered: '',
                    ended: false,
                    reveal: null,
                    saved: null,
                };
                byId.set(delta.turnId, turn);
                queue.push(turn);
                arrived.push(turn);
            }
            turn.text += delta.text;
            if (turn.reveal) turn.reveal.push(delta.text);
            else turn.buffered += delta.text;
            pump();
        },
        final: (saved) => {
            if (abandoned) return null;
            // Skip finished blank turns, but never past the newest (it may still be written).
            while (finalized < arrived.length - 1 && !hasVisibleText(arrived[finalized].text)) {
                end(arrived[finalized]);
                finalized += 1;
            }
            const turn = arrived[finalized];
            if (!turn) return null;
            finalized += 1;
            turn.saved = saved;
            end(turn);
            pump();
            return turn;
        },
        close: (how) => {
            if (closed) return;
            closed = true;
            if (how === 'abandon') {
                abandoned = true;
                arrived.forEach((turn) => {
                    turn.ended = true;
                    turn.reveal?.cancel();
                });
                resolveDrain();
                return;
            }
            arrived.forEach(end);
            pump();
        },
        drained,
        turns: () => arrived,
    };
};

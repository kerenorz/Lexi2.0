import { msPerRevealedChar } from '../../../../DAL/constants';

// Reveals a streamed reply at the configured words-per-minute, buffering text as it arrives.
// Uses an absolute clock so a throttled rAF (background tab) catches up instead of drifting.
// push() per chunk, endInput() when the network closes, onComplete after the last character.
export type StreamReveal = {
    push: (chunk: string) => void;
    endInput: () => void;
    finish: () => void;
    cancel: () => void;
    revealedLength: () => number;
    isDone: () => boolean;
};

// Updates the typing bubble by key, not "the last message": the participant can send a
// message mid-reveal, and the bubble is then no longer last. The caller owns the keys.
export const upsertKeyedBubble = <T extends { streamKey?: string }>(
    messages: T[],
    key: string,
    build: (existing?: T) => T,
): T[] => {
    const idx = messages.findIndex((m) => m.streamKey === key);
    if (idx === -1) return [...messages, build()];
    return [...messages.slice(0, idx), build(messages[idx]), ...messages.slice(idx + 1)];
};

export const createStreamReveal = ({
    wpm,
    onText,
    onComplete,
    now = () => performance.now(),
    schedule = (cb: () => void) => requestAnimationFrame(cb),
    cancelScheduled = (id: number) => cancelAnimationFrame(id),
}: {
    wpm?: number | null;
    // Called only when the visible text changes.
    onText: (visible: string) => void;
    // Called once, after the final character.
    onComplete: () => void;
    now?: () => number;
    schedule?: (cb: () => void) => number;
    cancelScheduled?: (id: number) => void;
}): StreamReveal => {
    const msPerChar = msPerRevealedChar(wpm);

    let buffer = '';
    let revealed = 0;
    let startedAt: number | null = null;
    let inputEnded = false;
    let done = false;
    let frame: number | null = null;

    const complete = () => {
        if (done) return;
        done = true;
        if (frame !== null) {
            cancelScheduled(frame);
            frame = null;
        }
        onComplete();
    };

    const tick = () => {
        frame = null;
        if (done) return;

        // Characters due by now, however many frames actually fired.
        const elapsed = now() - (startedAt as number);
        const target = Math.min(buffer.length, Math.floor(elapsed / msPerChar));

        if (target > revealed) {
            revealed = target;
            onText(buffer.slice(0, revealed));
        }

        if (inputEnded && revealed >= buffer.length) {
            complete();
            return;
        }
        frame = schedule(tick);
    };

    const ensureRunning = () => {
        if (done || frame !== null) return;
        if (startedAt === null) startedAt = now();
        frame = schedule(tick);
    };

    return {
        push(chunk: string) {
            if (done || !chunk) return;
            buffer += chunk;
            ensureRunning();
        },
        endInput() {
            if (done) return;
            inputEnded = true;
            // Empty reply: no frame would ever run, so complete now.
            if (!buffer.length) {
                complete();
                return;
            }
            ensureRunning();
        },
        // Show everything and complete, e.g. when the participant leaves the conversation.
        finish() {
            if (done) return;
            inputEnded = true;
            if (revealed < buffer.length) {
                revealed = buffer.length;
                onText(buffer);
            }
            complete();
        },
        // Stop without firing onComplete.
        cancel() {
            if (done) return;
            done = true;
            if (frame !== null) {
                cancelScheduled(frame);
                frame = null;
            }
        },
        revealedLength: () => revealed,
        isDone: () => done,
    };
};

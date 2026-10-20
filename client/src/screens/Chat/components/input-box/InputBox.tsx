import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { MessageType } from '@models/AppModels';
import { speakerMessageColors } from '@root/Theme';
import SendIcon from '@mui/icons-material/Send';
import { Box, Button, IconButton } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import {
    computeMessageDelayMs,
    getConversation,
    GroupStreamCallbacks,
    reportDisplayedAt,
    sendAutonomousRound,
    sendGroupMessage,
    sendGroupStream,
    sendMessage,
    sendStreamMessage,
} from '../../../../DAL/server-requests/conversations';
import { extractError } from '../../../../DAL/extractError';
import { TERMINAL_ERROR_REASONS } from '../../../../DAL/errorReasons';
import { postToHost } from '@root/utils/hostBridge';
import { createStreamReveal, StreamReveal, upsertKeyedBubble } from './streamReveal';
import { classifyStreamClose, createStreamedRound, hasVisibleText, StreamCloseKind } from './streamedRound';
import { newClientMessageId, removeUserMessage } from './clientMessageId';
import { resyncGroupRound } from './groupResync';
import {
    abortAutonomousRound,
    GROUP_SEND_IDLE,
    GroupSendState,
    RoundOutcome,
    roundFailureOutcome,
    settleGroupRound,
    startAutonomousRound,
    submitGroupMessage,
    withdrawUserBubbles,
} from './groupSendQueue';
import { StyledInputBase, StyledInputBox } from './InputBox.s';

// Idle wait before an autonomous (agent-only) round fires while the user is silent.
const AUTONOMOUS_IDLE_MS = 6000;

// A group message shown on screen but not yet sent. The id stays with it so the send and any
// re-sync name the same message the bubble shows.
interface QueuedMessage {
    content: string;
    clientMessageId: string;
}

// Pause between streamed agent turns so they read as turn-taking, not one wall of text.
// Presentation only, not a study setting. Never delays a round's first bubble.
const INTER_TURN_GAP_MS = 1000;

interface InputBoxProps {
    isMobile: boolean;
    messages: MessageType[];
    setMessages: (messages: MessageType[] | ((prevMessages: MessageType[]) => MessageType[])) => void;
    conversationId: string;
    setIsMessageLoading: (isLoading: boolean) => void;
    fontSize: string;
    isStreamMessage: boolean;
    // Reveal rate for streamed replies, in words per minute. Undefined => module default.
    streamWordsPerMinute?: number;
    isGroup?: boolean;
    speakerColors?: Record<string, string>;
    // Colors of the agents currently typing (0-2); ChatPage renders one indicator per color.
    setTypingColors?: (colors: string[]) => void;
    autonomousRounds?: number;
    // Survey-embedded study: the chat is one block of a larger survey.
    isSegmented?: boolean;
    // Re-reads the block's state. Awaited at round end before anything else is started.
    onRoundEnd?: () => Promise<{ isOpen: boolean } | null>;
}

const InputBox: React.FC<InputBoxProps> = ({
    isMobile,
    messages,
    fontSize,
    conversationId,
    setMessages,
    setIsMessageLoading,
    isStreamMessage,
    streamWordsPerMinute,
    isGroup = false,
    speakerColors,
    setTypingColors,
    autonomousRounds = 0,
    isSegmented = false,
    onRoundEnd,
}) => {
    const { openSnackbar } = useSnackbar();
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState(null);

    // Latest messages for async rounds, where the `messages` closure would be stale.
    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    // Group send queue: messages sent during a round wait and run as their own rounds, in order.
    // All transitions live in groupSendQueue.ts.
    const groupSendRef = useRef<GroupSendState<QueuedMessage>>(GROUP_SEND_IDLE);

    // 1-1 stream guard: two concurrent streams would mix their text into one bubble.
    const isStreamInFlightRef = useRef(false);
    // When the first character became visible (not the first token). Becomes displayedAt.
    const streamStartedAtRef = useRef<number | null>(null);
    // Held so unmount can finish the reveal instead of freezing a half-typed bubble.
    const revealRef = useRef<StreamReveal | null>(null);

    // Agent-only rounds while the participant is idle: remaining budget and idle timer.
    const autonomousBudgetRef = useRef(0);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Actual reveal time per message, flushed to the server in one batch per round.
    const displayLogRef = useRef<{ messageId: string; displayedAt: number }[]>([]);
    // Ids already reported. A re-sync can replay old turns, and reportDisplayedAt does a
    // plain $set, so a second report would overwrite the true first render time.
    const reportedIdsRef = useRef<Set<string>>(new Set());

    // Stops a round that completes after unmount from re-arming billed agent rounds nobody sees.
    const isUnmountedRef = useRef(false);

    // Group reveal state: pending timers, agents mid-typing (segmentId -> color), and the count
    // of bubbles shown this round so an error reset drops exactly these.
    const roundTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const activeTypersRef = useRef<Map<string, string>>(new Map());
    const revealedCountRef = useRef(0);

    // One key per typed-out bubble, so a typewriter finds its bubble even if the participant
    // sends mid-reveal. Unique per conversation: turnIds restart every round.
    const streamBubbleSeqRef = useRef(0);
    const nextStreamKey = () => `sb${(streamBubbleSeqRef.current += 1)}`;

    // Replace the bubble carrying `key`, or append it on the first frame.
    const upsertStreamBubble = (key: string, build: (existing?: MessageType) => MessageType) =>
        setMessages((prevMessages) => upsertKeyedBubble(prevMessages, key, build));

    // Survey block: seed the agent-only budget at mount. A resumed block has no opener, so with
    // a zero budget the agents would wait for the participant to speak first.
    useEffect(() => {
        if (isSegmented && isGroup && autonomousRounds > 0) {
            autonomousBudgetRef.current = autonomousRounds;
            scheduleAutonomousIfIdle();
        }
        // Mount-only: a later prop change must not refill the budget mid-block.
    }, []);

    useEffect(
        () => () => {
            isUnmountedRef.current = true;
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            // The reply is already saved, so show it in full rather than truncated.
            revealRef.current?.finish();
            revealRef.current = null;
            roundTimersRef.current.forEach((id) => clearTimeout(id));
            roundTimersRef.current = [];
            // Report reveals collected so far. A real tab close still drops this POST.
            flushDisplayLog();
        },
        [],
    );

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Record a message's first reveal only; a replayed turn must not overwrite it.
    const recordDisplayed = (turn: MessageType) => {
        if (turn._id && !reportedIdsRef.current.has(String(turn._id))) {
            reportedIdsRef.current.add(String(turn._id));
            displayLogRef.current.push({ messageId: String(turn._id), displayedAt: Date.now() });
        }
    };

    // Push distinct typing colors to ChatPage; hide the generic dots once any agent types.
    const syncTypingColors = () => {
        const seen = new Set<string>();
        const colors: string[] = [];
        activeTypersRef.current.forEach((color) => {
            if (color && !seen.has(color)) {
                seen.add(color);
                colors.push(color);
            }
        });
        // Palette order, so an agent's indicator keeps its slot across turns.
        const rank = (c: string) => {
            const i = speakerMessageColors.indexOf(c);
            return i === -1 ? speakerMessageColors.length : i;
        };
        colors.sort((a, b) => rank(a) - rank(b));
        setTypingColors?.(colors);
        if (colors.length > 0) setIsMessageLoading(false);
    };

    // 1-1 paced reveal: reading pause, typing indicator, bubble.
    const playTurn = async (turn: MessageType, keepIndicatorDuringPreTyping: boolean) => {
        const phase1Ms = turn.interSegmentPauseMs ?? turn.preTypingDelayMs ?? 0;
        const typingDurationMs = turn.typingDurationMs != null ? turn.typingDurationMs : computeMessageDelayMs(turn);

        if (phase1Ms > 0) {
            if (!keepIndicatorDuringPreTyping) setIsMessageLoading(false);
            await sleep(phase1Ms);
        }
        // Skip a 0ms typing phase, or the dots flash for a frame.
        if (typingDurationMs > 0) {
            setIsMessageLoading(true);
            await sleep(typingDurationMs);
        }
        setIsMessageLoading(false);
        setMessages((prevMessages) => [...prevMessages, turn]);
        recordDisplayed(turn);
    };

    // 1-1 streamed split reply: type one buffered segment out as its own bubble with the
    // stream typewriter (not playTurn: this is a streaming experiment). Resolves when fully typed.
    const typeOutSegment = (seg: MessageType): Promise<void> =>
        new Promise<void>((resolve) => {
            // One key per segment, or segment 2 would type over segment 1.
            let bubbleCreated = false;
            const streamKey = nextStreamKey();
            const reveal = createStreamReveal({
                wpm: streamWordsPerMinute,
                onText: (visible) => {
                    const isFirst = !bubbleCreated;
                    bubbleCreated = true;
                    // displayedAt = first visible character.
                    if (isFirst) recordDisplayed(seg);
                    // _id withheld until fully typed, so the annotation control can't rate a half bubble.
                    upsertStreamBubble(streamKey, () => ({
                        ...seg,
                        _id: undefined,
                        userAnnotation: undefined,
                        content: visible,
                        streamKey,
                    }));
                    setErrorMessage(null);
                },
                onComplete: () => {
                    // Fully typed: swap in the saved document and drop the key.
                    if (bubbleCreated) {
                        upsertStreamBubble(streamKey, (existing) => {
                            const { streamKey: _drop, ...rest } = (existing ?? {}) as MessageType;
                            return { ...rest, ...seg };
                        });
                    }
                    revealRef.current = null;
                    resolve();
                },
            });
            revealRef.current = reveal;
            reveal.push(typeof seg.content === 'string' ? seg.content : '');
            reveal.endInput();
        });

    // Group reveal: play a round's segments on one clock from the server's revealAtMs, so
    // typing can overlap. Resolves after the last bubble; never rejects.
    const playSchedule = (segments: MessageType[]): Promise<void> => {
        if (!segments.length) return Promise.resolve();
        const t0 = performance.now();
        let lastRevealAtMs = -1; // round-relative; keeps reveals strictly ordered
        const reveals: Promise<void>[] = [];

        segments.forEach((turn, i) => {
            const revealAtMs = turn.revealAtMs ?? 0;
            const typingMs = turn.typingDurationMs ?? 0;
            const color = turn.speakerId ? speakerColors?.[turn.speakerId] : undefined;
            const segId = String(turn._id ?? `${turn.speakerId ?? 's'}:${i}`);

            // Strictly increasing so timer jitter can't reorder bubbles vs messageNumber.
            const revealMs = Math.max(revealAtMs, lastRevealAtMs + 1);
            lastRevealAtMs = revealMs;
            const typingStartMs = Math.max(0, revealMs - typingMs);

            // Typing indicator on, only for a real typing phase.
            if (typingMs > 0 && revealMs - typingStartMs > 1) {
                const delay = Math.max(0, t0 + typingStartMs - performance.now());
                const id = setTimeout(() => {
                    if (color) activeTypersRef.current.set(segId, color);
                    syncTypingColors();
                }, delay);
                roundTimersRef.current.push(id);
            }

            // Reveal the bubble and turn this agent's indicator off.
            reveals.push(
                new Promise<void>((resolve) => {
                    const delay = Math.max(0, t0 + revealMs - performance.now());
                    const id = setTimeout(() => {
                        activeTypersRef.current.delete(segId);
                        syncTypingColors();
                        setMessages((prevMessages) => [...prevMessages, turn]);
                        revealedCountRef.current += 1;
                        recordDisplayed(turn);
                        resolve();
                    }, delay);
                    roundTimersRef.current.push(id);
                }),
            );
        });

        return Promise.all(reveals).then(() => undefined);
    };

    // Telemetry only: never awaited, never fails into the chat.
    const flushDisplayLog = () => {
        const batch = displayLogRef.current;
        displayLogRef.current = [];
        if (batch.length) void reportDisplayedAt(conversationId, batch);
    };

    const handleSendMessage = async () => {
        if (!message && !errorMessage && !message.trim().length) {
            openSnackbar('Message cannot be empty', SnackbarStatus.WARNING);
            return;
        }
        // 1-1 stream still open: refuse before touching the screen, or the message shows unsent.
        if (!isGroup && isStreamInFlightRef.current) {
            openSnackbar('Please wait for the current reply to finish.', SnackbarStatus.WARNING);
            return;
        }
        const messageContent: string = message || errorMessage;
        // One id per submit (a Resend gets a new one), so re-sync and refusal find this message.
        const clientMessageId = newClientMessageId();
        // The ref, not the prop: the prop can lag behind bubbles revealed since the last render.
        const conversation: MessageType[] = [
            ...messagesRef.current,
            { content: messageContent, role: 'user', clientMessageId },
        ];
        setMessages(conversation);
        setMessage('');

        // A submit cancels a pending agent-only round and refills the budget.
        if (isGroup) {
            cancelAutonomous();
            autonomousBudgetRef.current = autonomousRounds;
        }

        // The queue decides whether a round starts now; with a backlog the oldest message goes first.
        if (isGroup) {
            const step = submitGroupMessage(groupSendRef.current, { content: messageContent, clientMessageId });
            groupSendRef.current = step.state;
            if (step.send !== null) runGroupTurn(step.send);
            return;
        }

        setIsMessageLoading(true);
        try {
            if (isStreamMessage) {
                isStreamInFlightRef.current = true;
                streamStartedAtRef.current = null;
                try {
                    await runStreamedTurn(conversation, messageContent, clientMessageId);
                } finally {
                    isStreamInFlightRef.current = false;
                }
            } else {
                const response = await sendMessage({ content: messageContent, role: 'user', clientMessageId }, conversationId);
                // Humanized replies carry a pacing envelope; a plain reply's delay already elapsed.
                const enveloped = response.some(
                    (m) => m.typingDurationMs != null || m.segmentCount != null || m.preTypingDelayMs != null,
                );
                if (enveloped) {
                    for (const seg of response) {
                        await playTurn(seg, false);
                    }
                    flushDisplayLog();
                } else {
                    setMessages((prevMessages) => [...prevMessages, ...response]);
                }
                setIsMessageLoading(false);
                setErrorMessage(null);
            }
        } catch (err) {
            onMessageError(conversation, messageContent, err, clientMessageId);
        }
    };

    // The screen minus this round's revealed turns: what an error resets to.
    const conversationBeforeTurns = () =>
        messagesRef.current.slice(0, Math.max(0, messagesRef.current.length - revealedCountRef.current));

    // Reset per-round reveal state at the start of each group round.
    const startRoundReveal = () => {
        roundTimersRef.current.forEach((id) => clearTimeout(id));
        roundTimersRef.current = [];
        activeTypersRef.current.clear();
        revealedCountRef.current = 0;
        setTypingColors?.([]);
    };

    // Buffer a group round; turns arrive in a burst in revealAtMs order and are played after.
    const collectGroupRound = async (
        open: (cb: { onTurn: (t: MessageType) => void; onError: (e: any) => void }) => Promise<void>,
    ): Promise<{ segments: MessageType[]; streamError: any }> => {
        const segments: MessageType[] = [];
        let streamError: any = null;
        await open({
            onTurn: (turn) => segments.push(turn),
            onError: (error) => {
                streamError = streamError ?? error ?? { message: 'stream failed' };
            },
        });
        return { segments, streamError };
    };

    // Group token streaming: types each turn out in arrival order, one at a time (queue logic
    // in streamedRound.ts). Resolves when the last character shows, not when the socket closes.
    // sawDelta=false means the server sent a paced round instead. Only a user round with nothing
    // saved is torn down; the caller removes its bubbles by `roundKeys`.
    const playStreamedRound = async (
        open: (cb: GroupStreamCallbacks) => Promise<void>,
        kind: 'user' | 'autonomous',
    ): Promise<{
        segments: MessageType[];
        streamError: any;
        sawDelta: boolean;
        closeKind: StreamCloseKind;
        roundKeys: ReadonlySet<string>;
    }> => {
        const segments: MessageType[] = [];
        let sawDelta = false;
        let streamError: any = null;
        // Bubble keys issued this round, for teardown.
        const roundKeys = new Set<string>();

        const round = createStreamedRound<MessageType, StreamReveal>({
            interTurnGapMs: INTER_TURN_GAP_MS,
            now: () => performance.now(),
            wait: (ms, cb) => {
                roundTimersRef.current.push(setTimeout(cb, ms));
            },
            // Called only for turns with visible text.
            startReveal: (turn, finished) => {
                setIsMessageLoading(false);

                // Update by key, not "last message": a user send mid-reveal would start a second bubble.
                let bubbleCreated = false;
                const streamKey = nextStreamKey();
                roundKeys.add(streamKey);
                const reveal = createStreamReveal({
                    wpm: streamWordsPerMinute,
                    onText: (visible) => {
                        // No empty-looking bubble for leading whitespace.
                        if (!bubbleCreated && !hasVisibleText(visible)) return;
                        bubbleCreated = true;
                        upsertStreamBubble(streamKey, () => ({
                            ...(turn.saved ?? {}),
                            content: visible,
                            role: 'assistant',
                            speakerId: turn.speakerId,
                            speakerName: turn.speakerName,
                            streamKey,
                        }) as MessageType);
                        setErrorMessage(null);
                    },
                    onComplete: () => {
                        // Count only shown bubbles, or an error reset drops an unrelated message.
                        if (bubbleCreated) {
                            revealedCountRef.current += 1;
                            if (turn.saved) recordDisplayed(turn.saved);
                            // Commit here too: the final frame can arrive after the last character.
                            upsertStreamBubble(streamKey, (existing) => {
                                const { streamKey: _drop, ...rest } = (existing ?? {}) as MessageType;
                                return { ...rest, ...(turn.saved ?? {}) } as MessageType;
                            });
                        }
                        finished();
                    },
                });
                revealRef.current = reveal;
                return reveal;
            },
        });

        await open({
            onDelta: (delta) => {
                sawDelta = true;
                round.delta(delta);
            },
            onTurn: (saved) => {
                segments.push(saved);
                round.final(saved);
            },
            onError: (error) => {
                streamError = streamError ?? error ?? { message: 'stream failed' };
            },
        });

        // Close every turn, including ones still waiting, or `drained` never resolves and the chat wedges.
        const closeKind = classifyStreamClose({ streamError, savedTurns: segments.length });
        // 'unconfirmed' is torn down too: the re-sync shows the server's round, so typing the
        // fragments out would show it twice.
        const tearDown = kind === 'user' && (closeKind === 'not-persisted' || closeKind === 'unconfirmed');
        round.close(tearDown ? 'abandon' : 'finish');
        if (sawDelta) await round.drained;
        revealRef.current = null;
        return { segments, streamError, sawDelta, closeKind, roundKeys };
    };

    // Stream failed with no answer: ask the server by message id. Saved -> play the saved round,
    // no autonomous follow-up. Not saved -> the round failed (Resend, or the terminal refusal).
    const resyncAndSettle = async (queued: QueuedMessage, screenWithoutRound: () => MessageType[]) => {
        const outcome = await resyncGroupRound<MessageType>(queued, {
            readTranscript: async () => {
                const data: any = await getConversation(conversationId);
                return Array.isArray(data?.conversation) ? data.conversation : [];
            },
            // Same id: a duplicate refusal means the first send landed.
            repost: () =>
                sendGroupMessage(
                    { content: queued.content, role: 'user', clientMessageId: queued.clientMessageId },
                    conversationId,
                ),
        });
        if (outcome.kind === 'failed') {
            onMessageError(screenWithoutRound(), queued.content, outcome.error, queued.clientMessageId);
            onRoundComplete(roundFailureOutcome(outcome.error));
            return;
        }
        await playSchedule(outcome.turns);
        onRoundComplete('ok', false);
    };

    // Server refused the round (non-2xx): nothing was saved, so no re-sync. Settles like a 1-1 refusal.
    const refuseGroupRound = (queued: QueuedMessage, refusal: unknown) => {
        onMessageError(messagesRef.current, queued.content, refusal, queued.clientMessageId);
        onRoundComplete(roundFailureOutcome(refusal));
    };

    // One group round for a queued message (already on screen). Always ends via onRoundComplete,
    // which runs the next queued message.
    const runGroupTurn = async (queued: QueuedMessage) => {
        const { content: messageContent, clientMessageId } = queued;
        const userMessage: MessageType = { content: messageContent, role: 'user', clientMessageId };
        startRoundReveal();
        setIsMessageLoading(true); // network-wait dots until the first agent starts typing

        // A humanized roster is never streamed; sawDelta=false means a paced round came back.
        if (isStreamMessage) {
            try {
                const { segments, streamError, sawDelta, closeKind, roundKeys } = await playStreamedRound(
                    (cb) => sendGroupStream(userMessage, conversationId, cb, true),
                    'user',
                );
                // Only a torn-down round still has keyed bubbles.
                const withoutRoundBubbles = () =>
                    messagesRef.current.filter((m) => !m.streamKey || !roundKeys.has(m.streamKey));

                // Check first: a refusal also looks like the error frame below.
                if (closeKind === 'refused') {
                    refuseGroupRound(queued, streamError);
                    return;
                }
                if (!sawDelta) {
                    if (streamError) {
                        await resyncAndSettle(queued, withoutRoundBubbles);
                        return;
                    }
                    await playSchedule(segments);
                } else if (closeKind === 'not-persisted') {
                    // Failed before saving anything, and the user turn was taken back: fail the round
                    // (Resend) and drop its unsaved bubbles by key, not off the end of the list.
                    onMessageError(withoutRoundBubbles(), messageContent, streamError, clientMessageId);
                    onRoundComplete(roundFailureOutcome(streamError));
                    return;
                } else if (closeKind === 'unconfirmed') {
                    // Connection lost before any save; the server may still finish. Remove the
                    // fragments and ask the server what it has.
                    setMessages((prev) => prev.filter((m) => !m.streamKey || !roundKeys.has(m.streamKey)));
                    setIsMessageLoading(true);
                    await resyncAndSettle(queued, withoutRoundBubbles);
                    return;
                }
                // Failure after a saved turn: re-sync would duplicate shown turns, so just end the
                // round without an autonomous follow-up.
                onRoundComplete('ok', !streamError);
            } catch (err) {
                onMessageError(conversationBeforeTurns(), messageContent, err, clientMessageId);
                onRoundComplete(roundFailureOutcome(err));
            }
            return;
        }

        try {
            const { segments, streamError } = await collectGroupRound((cb) =>
                sendGroupStream(userMessage, conversationId, cb),
            );

            // Check refusal first, as above.
            if (classifyStreamClose({ streamError, savedTurns: segments.length }) === 'refused') {
                refuseGroupRound(queued, streamError);
                return;
            }
            if (streamError) {
                // Nothing revealed yet, so re-sync and play the saved round.
                await resyncAndSettle(queued, () => messagesRef.current);
                return;
            }

            await playSchedule(segments);
            onRoundComplete('ok');
        } catch (err) {
            onMessageError(conversationBeforeTurns(), messageContent, err, clientMessageId);
            onRoundComplete(roundFailureOutcome(err));
        }
    };

    // Remove queued user bubbles the server will refuse (block closed or terminal refusal), so
    // the participant doesn't see unanswered messages in a study about being ignored.
    const removeOptimisticUserMessages = (contents: readonly string[]) => {
        setMessages((prev) => withdrawUserBubbles(prev, contents));
    };

    // End of any group round: re-read the block, then settle the queue. ok runs the next message
    // (or arms an agent-only round); failed waits for Resend; refused or a closed block withdraws it.
    const onRoundComplete = async (outcome: RoundOutcome, allowAutonomous = true) => {
        flushDisplayLog();
        setTypingColors?.([]);
        activeTypersRef.current.clear();
        roundTimersRef.current.forEach((id) => clearTimeout(id));
        roundTimersRef.current = [];

        // Ask before acting: the block may have just closed. The round stays in flight across
        // the await so a message typed meanwhile is queued, not started.
        const nextSegment = isSegmented ? await onRoundEnd?.() : null;
        const segmentClosed = !!nextSegment && !nextSegment.isOpen;

        setIsMessageLoading(false);
        if (outcome === 'ok') setErrorMessage(null);

        const step = settleGroupRound(groupSendRef.current, { outcome, blockClosed: segmentClosed });
        groupSendRef.current = step.state;
        if (step.withdraw.length > 0) removeOptimisticUserMessages(step.withdraw.map((queued) => queued.content));
        if (step.send !== null) {
            runGroupTurn(step.send); // user turn already on screen -> no re-append
        } else if (step.mayGoAutonomous && allowAutonomous) {
            scheduleAutonomousIfIdle();
        }
    };

    const cancelAutonomous = () => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    };

    // Typing pushes back a pending agent-only round. Only re-arms an existing timer, so a
    // keystroke can never start a round. Idle means no keystroke for AUTONOMOUS_IDLE_MS.
    const deferAutonomousForTyping = () => {
        if (!isGroup || idleTimerRef.current === null) return;
        scheduleAutonomousIfIdle();
    };

    const scheduleAutonomousIfIdle = () => {
        // The chain's only re-arm point, so the unmount check here stops it for good.
        if (isUnmountedRef.current) return;
        if (!isGroup || autonomousRounds <= 0 || autonomousBudgetRef.current <= 0) return;
        cancelAutonomous();
        idleTimerRef.current = setTimeout(() => {
            idleTimerRef.current = null;
            // Backstop: never start ahead of a round in flight or queued messages.
            const started = startAutonomousRound(groupSendRef.current);
            if (!started) return;
            groupSendRef.current = started;
            autonomousBudgetRef.current -= 1;
            runAutonomousRound();
        }, AUTONOMOUS_IDLE_MS);
    };

    // A failed agent-only round ends silently (the user didn't start it). Queued user messages
    // still run; with none queued, the chain stops.
    const abortAutonomousSilently = () => {
        flushDisplayLog();
        setIsMessageLoading(false);
        setTypingColors?.([]);
        activeTypersRef.current.clear();
        roundTimersRef.current.forEach((id) => clearTimeout(id));
        roundTimersRef.current = [];
        const step = abortAutonomousRound(groupSendRef.current);
        groupSendRef.current = step.state;
        if (step.send !== null) {
            runGroupTurn(step.send);
        } else {
            autonomousBudgetRef.current = 0;
        }
    };

    // One agent-only round. Errors are silent and never drop a queued user message.
    const runAutonomousRound = async () => {
        startRoundReveal();
        setIsMessageLoading(true);

        if (isStreamMessage) {
            try {
                const { segments, streamError, sawDelta } = await playStreamedRound(
                    (cb) => sendAutonomousRound(conversationId, cb, true),
                    'autonomous',
                );
                if (streamError && !sawDelta) {
                    abortAutonomousSilently();
                    return;
                }
                // Agents had nothing to add -> stop the chain.
                if (!sawDelta && segments.length === 0) autonomousBudgetRef.current = 0;
                if (!sawDelta) await playSchedule(segments);
                onRoundComplete('ok', !streamError);
            } catch {
                abortAutonomousSilently();
            }
            return;
        }

        try {
            const { segments, streamError } = await collectGroupRound((cb) =>
                sendAutonomousRound(conversationId, cb),
            );
            if (streamError) {
                abortAutonomousSilently();
                return;
            }
            // Empty round: agents had nothing to add, stop the chain.
            if (segments.length === 0) {
                autonomousBudgetRef.current = 0;
            }
            await playSchedule(segments);
            onRoundComplete('ok');
        } catch {
            // Unexpected; an unguarded throw would leave the round in flight and wedge the chat.
            abortAutonomousSilently();
        }
    };

    // `clientMessageId` lets the terminal branch remove exactly the failed bubble.
    const onMessageError = (conversation, messageContent, error, clientMessageId?: string) => {
        setIsMessageLoading(false);
        const { message: errorText, isNetworkError } = extractError(error, "Couldn't send message");
        const reason = error?.response?.data?.reason;

        // Survey block, terminal refusal: no Resend. Remove the refused message (by id, since a
        // queued one may read the same) and tell the host so it shows its Next button.
        if (isSegmented && TERMINAL_ERROR_REASONS.has(reason)) {
            setMessages(removeUserMessage(conversation, { content: messageContent, clientMessageId }));
            setErrorMessage(null);
            // Re-read the closed block; this renders the end-of-block line and posts state to the host.
            void onRoundEnd?.();
            postToHost({ type: 'error', conversationId, reason: reason || 'CHAT_UNAVAILABLE' });
            return;
        }

        setMessages([
            ...conversation,
            {
                content: errorText,
                role: 'assistant',
            },
        ]);
        if (isNetworkError) {
            openSnackbar(errorText, SnackbarStatus.ERROR);
        }
        setErrorMessage(messageContent);
    };

    // One streamed 1-1 turn. Resolves when fully typed out, not when the network closes
    // (a reply can arrive in 2s and take 45s to type).
    const runStreamedTurn = async (conversation: MessageType[], messageContent: string, clientMessageId: string) => {
        let saved: MessageType | null = null;
        let aborted = false;
        // Outside the updater because React may call updaters twice.
        let bubbleCreated = false;

        let resolveReveal!: () => void;
        const revealFinished = new Promise<void>((resolve) => {
            resolveReveal = resolve;
        });

        const reveal = createStreamReveal({
            wpm: streamWordsPerMinute,
            onText: (visible) => {
                setIsMessageLoading(false);
                // displayedAt = first visible character, not first token.
                if (streamStartedAtRef.current === null) streamStartedAtRef.current = Date.now();
                const isFirst = !bubbleCreated;
                bubbleCreated = true;
                setMessages((prevMessages) => {
                    const lastMessage = prevMessages[prevMessages.length - 1];
                    if (isFirst || !lastMessage || lastMessage.role !== 'assistant') {
                        return [...prevMessages, { content: visible, role: 'assistant' }];
                    }
                    return [...prevMessages.slice(0, -1), { ...lastMessage, content: visible }];
                });
                setErrorMessage(null);
            },
            onComplete: () => resolveReveal(),
        });
        revealRef.current = reveal;

        await sendStreamMessage(
            { content: messageContent, role: 'user', clientMessageId },
            conversationId,
            (chunk) => reveal.push(chunk),
            (savedMessage) => {
                saved = savedMessage;
            },
            (error) => {
                // Drop the half-typed reply; the error bubble replaces it.
                aborted = true;
                reveal.cancel();
                resolveReveal();
                onMessageError(conversation, messageContent, error, clientMessageId);
            },
            // Buffered segments instead of a stream; the X-Lexi-Reveal header says how to show them.
            // No header: humanized, play with the indicator. 'typewriter': split reply, type each out.
            async (segments, revealStyle) => {
                aborted = true;
                reveal.cancel();
                resolveReveal();
                if (revealStyle === 'typewriter') {
                    // No typing indicator: the typewriter is the reveal.
                    setIsMessageLoading(false);
                    for (const seg of segments) {
                        // Short pause between segments; null on the first.
                        const pauseMs = seg.interSegmentPauseMs ?? 0;
                        if (pauseMs > 0) await sleep(pauseMs);
                        // Unmounted: cleanup already flushed, so stop typing.
                        if (isUnmountedRef.current) break;
                        await typeOutSegment(seg);
                    }
                } else {
                    for (const seg of segments) {
                        await playTurn(seg, false);
                    }
                }
                flushDisplayLog();
                setIsMessageLoading(false);
                setErrorMessage(null);
            },
        );

        // Network done; let the typewriter drain.
        if (!aborted) reveal.endInput();
        await revealFinished;
        revealRef.current = null;

        if (aborted || !saved) return;
        finalizeStreamedReply(saved);
    };

    // Attach the saved id after the typewriter drains (the id arrives much earlier).
    const finalizeStreamedReply = (message: MessageType) => {
        setIsMessageLoading(false);

        if (message._id && !reportedIdsRef.current.has(String(message._id))) {
            reportedIdsRef.current.add(String(message._id));
            displayLogRef.current.push({
                messageId: String(message._id),
                displayedAt: streamStartedAtRef.current ?? Date.now(),
            });
        }
        streamStartedAtRef.current = null;
        flushDisplayLog();

        setMessages((prevMessages) => {
            const lastMessage = prevMessages[prevMessages.length - 1];
            // An empty reply leaves the user's message last; append rather than stamp the id on it.
            if (!lastMessage || lastMessage.role !== 'assistant') {
                return [
                    ...prevMessages,
                    {
                        content: message.content ?? '',
                        role: 'assistant',
                        _id: message._id,
                        userAnnotation: message.userAnnotation,
                    },
                ];
            }
            return [
                ...prevMessages.slice(0, -1),
                { ...lastMessage, _id: message._id, userAnnotation: message.userAnnotation },
            ];
        });
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <Box
            style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                width: isMobile ? '95%' : '85%',
                alignItems: 'center',
            }}
        >
            {errorMessage ? (
                <Button
                    variant="contained"
                    onClick={() => {
                        setMessage(errorMessage);
                        handleSendMessage();
                    }}
                    style={{ width: 'fit-content', marginBottom: '24px' }}
                >
                    Resend Message
                </Button>
            ) : (
                <StyledInputBox>
                    <StyledInputBase
                        fullWidth
                        placeholder="Type a message…"
                        multiline
                        // `auto` so Hebrew input renders RTL and English stays LTR.
                        inputProps={{ dir: 'auto' }}
                        maxRows={5}
                        value={message}
                        onChange={(e) => {
                            setMessage(e.target.value);
                            deferAutonomousForTyping();
                        }}
                        onKeyDown={handleKeyDown}
                        fontSize={fontSize === 'sm' ? '1rem' : '1.25rem'}
                    />
                    <IconButton color="primary" onClick={handleSendMessage}>
                        <SendIcon />
                    </IconButton>
                </StyledInputBox>
            )}
        </Box>
    );
};

export default InputBox;

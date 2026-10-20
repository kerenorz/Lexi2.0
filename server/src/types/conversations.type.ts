import mongoose from 'mongoose';
import { IAgent } from '../types/agents.type';
import { SegmentQuota, TurnTakingConfig } from '../types/experiments.type';

export type UserAnnotation = 1 | 0 | -1;

export interface IConversation {
    conversationId: string;
    content: string;
    role: 'system' | 'user' | 'assistant';
    speakerId?: string;
    speakerName?: string;
    createdAt: Date;
    timestamp: number;
    messageNumber: number;
    userAnnotation: UserAnnotation;
    valence: number;
    arousal: number;
    timeDelay: number;
    prev_message?: string | null;
    pit: number;
    loud: number;
    snr: number;
    preTypingDelayMs?: number | null;
    typingDurationMs?: number | null;
    interSegmentPauseMs?: number | null;
    segmentGroupId?: string | null;
    segmentIndex?: number | null;
    segmentCount?: number | null;
    revealAtMs?: number | null;
    displayedAt?: number | null;
    // Phase that generated this message (0 = base prompts). Stamped at generation, not delivery,
    // since pacing can deliver a bubble after the next phase boundary.
    phaseIndex?: number | null;
    phaseLabel?: string | null;
    // Thread-control move that steered this turn. Export only, never sent to the browser.
    move?: string | null;
    // Client-generated id; user turns only, when well-formed.
    clientMessageId?: string;
}

export interface IExplainable {
    conversationId: string;
    prompt_input: string;
    user_input: string,
    response: string;
    role: string;
    createdAt: Date;
    timestamp: number;
    messageNumber: number;
    valence: number;
    arousal: number;
    //userAnnotation: UserAnnotation;
}

export interface Message {
    _id?: mongoose.Types.ObjectId;
    role: 'system' | 'user' | 'assistant';
    content: string;
    speakerId?: string;
    speakerName?: string;
    timeDelay: number;
    prev_message?: string | null;
    userAnnotation?: UserAnnotation;
    preTypingDelayMs?: number | null;
    typingDurationMs?: number | null;
    interSegmentPauseMs?: number | null;
    segmentGroupId?: string | null;
    segmentIndex?: number | null;
    segmentCount?: number | null;
    revealAtMs?: number | null;
    displayedAt?: number | null;
    phaseIndex?: number | null;
    phaseLabel?: string | null;
    // See IConversation.clientMessageId. Never sent to a model.
    clientMessageId?: string;
}

export interface Audio {
    _id?: mongoose.Types.ObjectId;
    role: 'system' | 'user' | 'assistant';
    content: Blob | Buffer | string;
    timeDelay: number;
    prev_message?: string | null;
    userAnnotation?: UserAnnotation;
}

// One agent's first entry into a phase. Recorded, not recomputed: time triggers can't be
// replayed from the seed.
export interface PhaseTransition {
    agentId: string;
    phaseIndex: number;
    phaseLabel?: string | null;
    // Wall clock.
    at: number;
    // Chat clock (time the chat was open, excluding survey breaks). Absent on old entries;
    // kept separate from `at` because the two differ in segmented studies.
    atChatElapsedMs?: number | null;
    atMessageNumber: number;
    // Chat block it happened in; absent when unsegmented.
    atSegment?: number | null;
    trigger: 'time' | 'turns' | 'segment';
    // Set when phases were skipped (an idle participant can cross two boundaries).
    skippedFrom?: number | null;
}

// A round thread control ended early. The transcript alone can't tell this from running out of turns.
export interface ThreadCloseRecord {
    // Message number the round started from.
    atMessageNumber: number;
    // Seeded draw key ('u12' / 'a17'), for lining up a replay.
    roundAnchor: string;
    // Which turn of the round closed it. 0 = the round produced nothing at all.
    turnIndex: number;
    // 'draw': the seeded move was 'close'. 'guard': the degeneration guard fired.
    by: 'draw' | 'guard';
    at: number;
}

// A user round with no agent turn because every asked agent returned empty. Recorded so it can be
// told apart from a deliberate silence (moderator NONE, silenceChance), which is not recorded here.
export interface SilentRoundRecord {
    // The participant message nobody answered.
    messageNumber: number;
    at: number;
    // Agents whose replies came back empty, in the order asked.
    agentIds: string[];
}

// Why a block ended. Recorded, since it depends on a clock and an editable quota.
export type SegmentCloseReason =
    // The researcher's quota was reached.
    | 'messages'
    | 'seconds'
    // The host survey branched forward past this block.
    | 'override'
    // The host survey said the chat is over. The only way the last block closes (it has no
    // next page). Unlike 'override', the study ran to its end.
    | 'host-finished'
    // The conversation's maxMessages cap was hit, so the block was not fully delivered.
    | 'message-limit'
    // Terminal chat error. Closed so the participant can go back to the survey.
    | 'error'
    // A researcher closed it from the preview panel.
    | 'manual';

// One chat block. Append-only: a closed segment is never reopened or changed.
export interface SegmentRecord {
    // 1-based.
    number: number;
    openedAt: number;
    closedAt?: number | null;
    closedBy?: SegmentCloseReason | null;
    // metadata.messagesNumber at open/close: a count of participant rounds, not a transcript
    // position. Still written because old records have only these and readers fall back to them.
    openedAtMessageNumber: number;
    closedAtMessageNumber?: number | null;
    // Highest persisted messageNumber at open/close; slices the transcript into blocks.
    // Absent on old records. Close is written only when open is, so units never mix.
    openedAtTranscriptPosition?: number;
    closedAtTranscriptPosition?: number | null;
    // Participant messages before this block opened. Not the transcript position, which counts
    // agent turns too and would close a message quota far too early.
    openedAtUserMessages: number;
    // Frozen at open, so editing the experiment can't change a running block.
    quota?: SegmentQuota | null;
    // A close asked for mid-round, performed at the next round boundary.
    closeRequested?: SegmentCloseReason | null;
    // Block to open once the deferred close runs; without it the target block would be skipped.
    openAfterClose?: number | null;
    // Previous segment number when the survey skipped blocks.
    skippedFrom?: number | null;
}

export interface IMetadataConversation {
    _id: mongoose.Types.ObjectId;
    ownerId?: string;
    experimentId: string;
    messagesNumber: number;
    createdAt: Date;
    timestamp: number;
    lastMessageDate: Date;
    lastMessageTimestamp: number;
    conversationNumber: number;
    agent: IAgent;
    agents?: IAgent[];
    mode?: string;
    // Snapshot of experiment.turnTaking; group conversations only.
    turnTaking?: TurnTakingConfig;
    // Deterministic PRNG seed (hex); group conversations only.
    seed?: string;
    // messagesNumber at which a seed was backfilled; earlier rounds can't be replayed.
    seedBackfilledAtMessage?: number;
    // Start of the running chat span; absent when none is running.
    // Unsegmented: stamped at the first round, not createdAt, so time on the pre-chat form
    // doesn't count; never cleared. Segmented: set on segment open, cleared on close.
    phaseClockStartedAt?: number;
    // Sum of closed segments' spans. Absent until one closes.
    chatElapsedAccumulatedMs?: number;
    // First time the chat clock started, never cleared. The export's elapsed origin, since
    // phaseClockStartedAt is cleared after the last block.
    chatClockFirstStartedAt?: number;
    // Append-only log of phase entries; see PhaseTransition.
    phaseHistory?: PhaseTransition[];
    // Append-only; see ThreadCloseRecord.
    threadLog?: ThreadCloseRecord[];
    // Append-only; see SilentRoundRecord.
    silentRounds?: SilentRoundRecord[];
    // Survey-embedded chat blocks. Absent on ordinary conversations (`isSegmented` tests this).
    segments?: SegmentRecord[];
    // Raw host-survey answers keyed by gap (gap N is between segments N and N+1). The
    // agent-facing form is in `knowledge`.
    surveyAnswers?: Record<string, { values: Record<string, unknown>; receivedAt: number }>;
    // Agent-facing knowledge by agent id. Only ever extended.
    knowledge?: Record<string, string[]>;
    // Agent-only rounds claimed since the budget last refilled; absent means none.
    // See claimAutonomousRound.
    autonomousRoundsUsed?: number;
    // When the in-progress agent-only round was claimed; absent when none is.
    autonomousRoundStartedAt?: Date;
    userId: string;
    preConversation?: object;
    postConversation?: object;
    maxMessages: number;
    isFinished: boolean;
}

export interface ICurrentState {
    id: string;
    valence: number;
    arousal: number;
    count: number;
}

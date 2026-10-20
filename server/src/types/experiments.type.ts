import mongoose from 'mongoose';
import { ApiKeyOverrides } from './apiKeys.type';

export interface ABAgents {
    agentA: string;
    distA: number;
    agentB: string;
    distB: number;
}

export type TurnTakingPolicy = 'llm' | 'probabilistic' | 'rules';

// Thread control: agents replying to each other drift off topic ("yes, and" forever).
// Before each agent-to-agent reply a move is drawn from the conversation seed and appended
// as one context line. Seeded, so runs replay exactly. Absent = off.
export interface ThreadControlConfig {
    enabled?: boolean;
    // Probability per eligible turn; absent uses the default shown. 0 disables the move.
    groundChance?: number; // 0.20: say something concrete
    shiftChance?: number; // 0.15: move the thread on
    returnChance?: number; // 0.05: pick up something said earlier
    closeChance?: number; // 0.08: end the round here
}

export interface TurnTakingConfig {
    policy: TurnTakingPolicy;
    moderatorPrompt?: string;
    perAgentProbability?: Record<string, number>;
    silenceChance?: number;
    maxAgentTurnsPerRound?: number;
    // Per-round agent turn cap: off->2, brief->3 (+1 random speaker), extended->4.
    autonomousLevel?: 'off' | 'brief' | 'extended';
    // Agent-only rounds fired while the participant is silent. 0 = off. Triggered by the client.
    autonomousRounds?: number;
    // Name the human participant in the group preamble. Off by default to keep the illusion.
    identifyHumanParticipant?: boolean;

    // Non-turn-taking group settings live here too, since turnTaking is already snapshotted,
    // hidden from the public route, and allow-listed for participants.

    // Scene text appended to every agent's context on every turn. Empty = none.
    scene?: string;

    threadControl?: ThreadControlConfig;

    // Bounded context: opening, all participant messages, recent messages; older agent-only
    // chatter dropped. Pure selection, so it replays exactly. Absent = full transcript.
    memoryWindow?: boolean;
}

// Phase timing lives on the experiment (one timeline for the study); phase text lives on
// each agent. mergeAgentPhases joins them at conversation creation.
// Index 0 is phase 2's trigger; phase 1 is the agent's base prompts.

export interface PhaseBoundary {
    // Researcher-facing only.
    label?: string;
    // Seconds since phaseClockStartedAt. Absent = no time trigger.
    startAfterSeconds?: number | null;
    // Participant messages so far, including the one being answered.
    startAfterUserMessages?: number | null;
    // 1-based segment number. Whichever trigger comes first wins.
    startAtSegment?: number | null;
}

// 'shared': one list for all agents. 'perAgent': a list per agent id.
export type PhaseScheduleMode = 'shared' | 'perAgent';

export interface PhaseScheduleConfig {
    mode: PhaseScheduleMode;
    boundaries?: PhaseBoundary[];
    perAgent?: Record<string, PhaseBoundary[]>;
}

// Segments: one conversation split into chat blocks between survey pages. See segments.service.

// Floor: all minimums must be met to continue. Ceiling: any maximum closes the block.
// Absent is not a threshold; 0 is.
export interface SegmentQuota {
    minUserMessages?: number | null;
    minSeconds?: number | null;
    maxUserMessages?: number | null;
    maxSeconds?: number | null;
}

export interface SegmentsConfig {
    enabled: boolean;
    // Needed so the last block's close can finish the conversation.
    count: number;
    // One row per block; a blank field inherits from the row above.
    quotas?: SegmentQuota[];
    // Shown in place of the composer once a block closes.
    endOfSegmentNotice?: string;
    // Knowledge template per gap (index 0 = after block 1) for agents without their own.
    defaultKnowledgeTemplates?: string[];
}

export interface DisplaySettings {
    welcomeContent: string;
    welcomeHeader: string;
}

export interface ExperimentForms {
    registration: string;
    preConversation: string;
    postConversation: string;
}

export interface ExperimentFeatures {
    userAnnotation: boolean;
    streamMessage: boolean;
    // Client reveal rate for streamed text (word = 5 chars). Absent: use DEFAULT_STREAM_WPM.
    streamWordsPerMinute?: number;
}

// An experiment references an agent that was deleted. Shown on the admin list and thrown
// at registration so the participant gets a reason instead of a 500.
export interface ExperimentConfigIssue {
    reason: 'MISSING_AGENTS';
    // Same sentence in the badge tooltip and the registration error.
    message: string;
    missingAgentIds: string[];
    configuredCount: number;
    availableCount: number;
}

export interface IExperimentLean {
    _id: mongoose.Types.ObjectId;
    title: string;
}

export interface IExperiment {
    _id: mongoose.Types.ObjectId;
    ownerId: string;
    agentsMode: string;
    activeAgent: string;
    abAgents: ABAgents;
    groupAgents?: string[];
    turnTaking?: TurnTakingConfig;
    // Absent = no phases.
    phaseSchedule?: PhaseScheduleConfig;
    // Group only: which agent(s) send the opening message.
    firstMessageSender?: 'agent1' | 'agent2' | 'both';
    segments?: SegmentsConfig;
    // Per-provider key for this study. Absent = the owner's default key.
    apiKeyOverrides?: ApiKeyOverrides;
    createdAt: Date;
    timestamp: number;
    displaySettings: DisplaySettings;
    isActive: boolean;
    title: string;
    description: string;
    numberOfParticipants: number;
    experimentForms: ExperimentForms;
    maxMessages: number;
    maxConversations: number;
    maxParticipants: number;
    totalSessions: number;
    openSessions: number;
    experimentFeatures: ExperimentFeatures;
    ownerUsername?: string;
    // Admin list only, when the roster is broken. Computed per request, never stored.
    configIssue?: ExperimentConfigIssue;
}

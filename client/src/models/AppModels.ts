import { QuestionType, QuestionTypeProps } from '../components/questions/Question';

export interface MessageType {
    _id?: string;
    role: 'system' | 'user' | 'assistant';
    content: string | Blob;
    speakerId?: string;
    speakerName?: string;
    prev_message?: string | null;
    userAnnotation?: UserAnnotation;
    // Legacy pacing hint, read by computeMessageDelayMs.
    timeDelay?: number | null;
    // Server-set timing for paced messages. Absent on unpaced messages.
    preTypingDelayMs?: number | null;
    typingDurationMs?: number | null;
    interSegmentPauseMs?: number | null;
    segmentGroupId?: string | null;
    segmentIndex?: number | null;
    segmentCount?: number | null;
    // Round-relative ms at which this bubble is revealed.
    revealAtMs?: number | null;
    displayedAt?: number | null;
    // Client-only: marks the bubble a typewriter is filling, since a mid-reveal user message
    // means it is no longer the last one. Removed on commit, never sent.
    streamKey?: string;
    // Client-generated id for user messages, persisted by the server. Used to re-sync and
    // withdraw messages. See clientMessageId.ts.
    clientMessageId?: string;
}

export interface AudioType {
    _id?: string;
    role: 'system' | 'user' | 'assistant';
    content: Blob | string;
    userAnnotation?: UserAnnotation;
    // Sent as its own multipart field.
    clientMessageId?: string;
}

export type UserAnnotation = 1 | 0 | -1;

export interface ConversationType {
    conversationId: string;
    content: string;
    role: string;
    createdAt: Date;
    timestamp: number;
    messageNumber: number;
}

export interface MetadataConversationType {
    _id: string;
    experimentId: string;
    messagesNumber: number;
    createdAt: Date;
    timestamp: number;
    lastMessageDate: Date;
    lastMessageTimestamp: number;
    conversationNumber: number;
    agent: AgentType;
    agents?: AgentType[];
    mode?: string;
    turnTaking?: TurnTakingConfig;
    // Pacing seed (hex). Group conversations only.
    seed?: string;
    userId: string;
}

export type UserRole = 'admin' | 'user' | 'participant';

export interface UserType {
    _id: string;
    experimentId: string;
    username: string;
    age: number;
    gender: 'male' | 'female' | 'other';
    biologicalSex: string;
    maritalStatus: string;
    childrenNumber: number;
    nativeEnglishSpeaker: boolean;
    createdAt: Date;
    timestamp: number;
    role: UserRole;
    password?: string;
    numberOfConversations: number;
    agent: AgentType;
    agents?: AgentType[];
    mode?: string;
    // Empty or absent allowedModels means unrestricted.
    limits?: { allowedModels?: string[] };
    // Shared account whose password only an admin may change.
    passwordLocked?: boolean;
}

// Pacing switches, mirroring the server's `pacing.enabled`. A knob is on unless explicitly
// false, so older agents without this object keep every knob on.
export interface AgentPacingEnabled {
    typingSpeed?: boolean; // inverseTimeDelay + pacing.typingSpeed
    typingVariation?: boolean; // pacing.typingSpeedVariation (needs typingSpeed)
    preTypingPause?: boolean; // preTypingDelayMsMean + preTypingDelayMsRange
    split?: boolean; // splitProbability + maxSegments (not a Human-Deception knob)
}

// Omitted fields fall back to the server's DEFAULT_PACING.
export interface AgentPacing {
    typingSpeed?: number; // words/sec base rate (generalizes inverseTimeDelay)
    typingSpeedVariation?: number; // jitter sigma
    preTypingDelayMsMean?: number; // reading pause mean
    preTypingDelayMsRange?: number; // reading pause +/- range
    splitProbability?: number; // 0..1 tendency to split
    maxSegments?: number; // 1..3
    // Which knobs apply. Absent means all.
    enabled?: AgentPacingEnabled;
}

// Same union as LLMProvider in apiKeys.ts, redeclared to avoid an import cycle.
export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'openrouter';

// One entry of the server's model catalogue (GET /agents/models).
export interface CatalogueModel {
    id: string;
    provider: ModelProvider;
    // OpenRouter only: the pinned host, the sampling params it honours, and whether it reasons.
    openrouter?: {
        host: string;
        params: string[];
        reasonsByDefault: boolean;
    };
    // Agent settings Lexi can't apply to this model. The picker marks these models with "!".
    ignoredSettings?: string[];
}

// Conversation phases: timing lives on the experiment (PhaseBoundary) so group agents share
// one schedule; text lives on the agent (AgentPhase). Index 0 is phase 2; phase 1 is the
// agent's top-level prompts.

export interface PhaseBoundary {
    label?: string;
    // The first threshold met starts the phase. Strings while typing, coerced on save; blank = unused.
    // Stored as total elapsed since start; the form edits per-phase durations (see PhaseScheduleEditor).
    startAfterSeconds?: number | string | null;
    startAfterUserMessages?: number | string | null;
    // 1-based chat block for survey-embedded studies. Absolute, not a duration.
    startAtSegment?: number | string | null;
}

export type PhaseScheduleMode = 'shared' | 'perAgent';

export interface PhaseScheduleConfig {
    mode: PhaseScheduleMode;
    // 'shared' mode: one list for every agent.
    boundaries?: PhaseBoundary[];
    // 'perAgent' mode: keyed by agent id.
    perAgent?: Record<string, PhaseBoundary[]>;
}

// A blank field inherits from the previous phase.
export interface AgentPhase {
    label?: string;
    systemStarterPrompt?: string;
    beforeUserSentencePrompt?: string;
    afterUserSentencePrompt?: string;
}

export interface AgentType {
    _id: string;
    title: string;
    displayName?: string;
    summary: string;
    systemStarterPrompt: string;
    beforeUserSentencePrompt: string;
    afterUserSentencePrompt: string;
    inverseTimeDelay: number;
    firstChatSentence: string;
    model: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    cameraCaptureRate: number;
    audioInput: number;
    vaIntegration: number;
    stopSequences: { value: string; id: string }[];
    // null inherits the server defaults.
    pacing?: AgentPacing | null;
    // Phases after the first. Absent means no phases; not seeded into defaultSettings.
    phases?: AgentPhase[];
    // Survey-embedded studies: what the agent learns from each break; index 0 follows block 1.
    knowledgeTemplates?: string[];
    createdAt?: Date;
    timestamp?: number;
    // Added by GET /agents. creatorUsername is admin-only.
    ownerId?: string;
    referenceCount?: number;
    creatorUsername?: string;
    // The owner's allowedModels, so an admin editing the agent obeys them. Admin-only; absent = unrestricted.
    ownerAllowedModels?: string[];
}

// One row of GET /agents/removed-models.
export interface RemovedModelAgent {
    agentId: string;
    agentTitle: string;
    model: string;
    removedOn?: string;
    reason: string;
    experiments: { _id: string; title: string; isActive: boolean }[];
}

export interface AgentLeanType {
    _id: string;
    title: string;
}

export type AbAgentsType = {
    agentA: string;
    distA: number;
    agentB: string;
    distB: number;
};

export const AgentsModes = {
    SINGLE: 'Single',
    AB: 'A/B',
    GROUP: 'Group',
} as const;

export type TurnTakingPolicy = 'llm' | 'probabilistic' | 'rules';

// Mirrors server/src/types/experiments.type.ts.
export interface ThreadControlConfig {
    enabled?: boolean;
    groundChance?: number;
    shiftChance?: number;
    returnChance?: number;
    closeChance?: number;
}

export interface TurnTakingConfig {
    policy: TurnTakingPolicy;
    moderatorPrompt?: string;
    perAgentProbability?: Record<string, number>;
    silenceChance?: number;
    maxAgentTurnsPerRound?: number;
    autonomousLevel?: 'off' | 'brief' | 'extended';
    // Agent-only rounds fired while the participant is silent. 0 = off.
    autonomousRounds?: number;
    // Names the human in the agents' preamble. Default false keeps human/AI unstated.
    identifyHumanParticipant?: boolean;
    // Not turn-taking, but turnTaking is the group settings object the form strips for Single/AB.
    scene?: string;
    threadControl?: ThreadControlConfig;
    memoryWindow?: boolean;
}

export interface DisplaySettings {
    welcomeContent: string;
    welcomeHeader: string;
}

export interface ExperimentType {
    _id: string;
    ownerId?: string;
    ownerUsername?: string;
    agentsMode: string;
    activeAgent: string;
    abAgents: AbAgentsType;
    groupAgents?: string[];
    turnTaking?: TurnTakingConfig;
    // All modes, so don't strip it with the group-only fields.
    phaseSchedule?: PhaseScheduleConfig;
    // Survey-embedded: chat split into blocks between survey pages. Absent = one sitting.
    segments?: {
        enabled?: boolean;
        count?: number;
        quotas?: Array<{
            minUserMessages?: number | null;
            minSeconds?: number | null;
            maxUserMessages?: number | null;
            maxSeconds?: number | null;
        }>;
        endOfSegmentNotice?: string;
        defaultKnowledgeTemplates?: string[];
    };
    // Group-only: which agent(s) send the opening message.
    firstMessageSender?: 'agent1' | 'agent2' | 'both';
    // API key per provider. Absent uses the account default.
    apiKeyOverrides?: Record<string, string> | null;
    createdAt: Date;
    timestamp: number;
    welcomeText: string;
    welcomeCSS: object;
    displaySettings: DisplaySettings;
    isActive: boolean;
    title: string;
    description: string;
    numberOfParticipants: number;
    maxMessages: number | undefined;
    maxConversations: number | undefined;
    maxParticipants: number | undefined;
    totalSessions: number;
    openSessions: number;
    experimentFeatures: ExperimentFeatures;
    // Computed per request when referenced agents no longer exist. Not stored.
    configIssue?: {
        reason: 'MISSING_AGENTS';
        message: string;
        missingAgentIds: string[];
        configuredCount: number;
        availableCount: number;
    };
}

export interface ExperimentLeanType {
    _id: string;
    title: string;
}

export interface ExperimentFeatures {
    userAnnotation: boolean;
    streamMessage: boolean;
    // Streamed reveal rate (a word = 5 characters). Absent: use DEFAULT_STREAM_WPM.
    streamWordsPerMinute?: number;
}

export interface NewUserInfoType {
    // Survey participant id, only inside a survey iframe. Joins the survey export to Lexi's.
    externalPid?: string;
    username: string;
    age: number | string;
    gender: string;
    biologicalSex: string;
    maritalStatus: string;
    childrenNumber: number;
    nativeEnglishSpeaker: string | boolean;
}

export interface ExperimentContentType {
    content: DisplaySettings;
    isActive: boolean;
}

export interface UserResourcesType {
    agents: Array<{
        _id: string;
        title: string;
        model: string;
        createdAt: string;
    }>;
    experiments: Array<{
        _id: string;
        title: string;
        isActive: boolean;
        numberOfParticipants: number;
        agentsMode: string;
        createdAt: string;
    }>;
    forms: Array<{
        _id: string;
        name: string;
        title: string;
    }>;
}

export interface FormType {
    name: string;
    title: string;
    instructions: string;
    questions: Array<{ type: QuestionType; props: QuestionTypeProps }>;
}

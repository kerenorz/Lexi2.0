import { AbAgentsType, AgentPacing, AgentType, FormType, TurnTakingConfig } from '@models/AppModels';

export const defaultSliderSettings = {
    temperature: 1,
    maxTokens: 256,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    audioInput: 1,
} as const;

// The model list is served by GET /agents/models (server modelCatalogue.ts).

// Seeded when "Response pace" is switched on. Keep in sync with the server's DEFAULT_PACING.
// typingSpeed is omitted so it falls back to the agent's inverseTimeDelay.
export const defaultPacing: AgentPacing = {
    typingSpeedVariation: 0.22,
    preTypingDelayMsMean: 900,
    preTypingDelayMsRange: 600,
    splitProbability: 0.35,
    maxSegments: 3,
};

// Mirrors the server's isHumanized; every form must use this one. The explicit flag wins
// both ways, so an agent saved with HD off stays off even with pacing data kept.
export const isAgentDocHumanized = (agent: {
    humanized?: boolean;
    inverseTimeDelay?: number | null;
    pacing?: unknown;
}): boolean => {
    if (!agent) return false;
    if (agent.humanized === true) return true;
    if (agent.humanized === false) return false;
    if (agent.inverseTimeDelay != null) return true;
    const p = agent.pacing;
    return p != null && typeof p === 'object' && Object.keys(p).length > 0;
};

// Mirrors the server's isSplitEnabled. The explicit flag wins both ways; without one the
// server decides by humanization, so this does too.
export const isAgentDocSplitting = (agent: {
    humanized?: boolean;
    inverseTimeDelay?: number | null;
    pacing?: { enabled?: { split?: boolean } } | null;
}): boolean => {
    if (!agent) return false;
    const flag = agent.pacing?.enabled?.split;
    if (flag === true) return true;
    if (flag === false) return false;
    return isAgentDocHumanized(agent);
};

export const defaultSettings: AgentType = {
    _id: '',
    title: '',
    displayName: '',
    summary: '',
    systemStarterPrompt: '',
    beforeUserSentencePrompt: '',
    afterUserSentencePrompt: '',
    inverseTimeDelay: null,
    firstChatSentence: '',
    model: 'gpt-4o-mini',
    temperature: null,
    maxTokens: null,
    topP: null,
    frequencyPenalty: null,
    presencePenalty: null,
    cameraCaptureRate: null,
    audioInput: null,
    vaIntegration: null,
    stopSequences: [],
    // No `pacing` key: mongoose would persist an explicit null onto every new agent.
};

export const defaultAbAgents: AbAgentsType = {
    agentA: null,
    distA: 50,
    agentB: null,
    distB: 50,
} as const;

// Attached to an experiment only when Group mode is chosen.
export const defaultGroupAgents: string[] = [];

// Seeded onto new group experiments only; never merged over a stored turnTaking. Thread
// control and memoryWindow default off because they sit behind the unticked "Conversation
// phases" checkbox, and hidden must mean off. GroupAgents must seed these leaf paths
// individually: a parent setValue doesn't reach Controllers with their own defaultValue.
export const defaultTurnTaking: TurnTakingConfig = {
    policy: 'rules',
    maxAgentTurnsPerRound: 2,
    silenceChance: 0,
    perAgentProbability: {},
    autonomousLevel: 'off',
    autonomousRounds: 0,
    identifyHumanParticipant: false,
    // Never prefilled: forgotten example text would become the study's setting.
    scene: '',
    threadControl: {
        enabled: false,
        groundChance: 0.2,
        shiftChance: 0.15,
        returnChance: 0.05,
        closeChance: 0.08,
    },
    memoryWindow: false,
};

// Thread-control slider bounds. The sum cap leaves 'continue' (an ordinary reply) some share.
export const MAX_MOVE_CHANCE = 0.5;
export const MAX_MOVE_CHANCE_SUM = 1;

// Stream Message reveal rate in words per minute, 5 characters per word. 200 is fast but
// human (a 150-word reply in ~45s). Only paces the client reveal, not the provider stream.
export const DEFAULT_STREAM_WPM = 200;
export const MIN_STREAM_WPM = 10;
export const MAX_STREAM_WPM = 2000;
export const CHARS_PER_WORD = 5;

// Milliseconds each character should wait before it is revealed.
export const msPerRevealedChar = (wpm?: number | null): number => {
    const rate = Number(wpm);
    const safe =
        Number.isFinite(rate) && rate > 0
            ? Math.min(MAX_STREAM_WPM, Math.max(MIN_STREAM_WPM, rate))
            : DEFAULT_STREAM_WPM;
    return 60000 / (safe * CHARS_PER_WORD);
};

export const defaultExperiment = {
    title: '',
    description: '',
    agentsMode: 'Single',
    activeAgent: null,
    abAgents: null,
    isActive: true,
    maxMessages: undefined,
    maxConversations: undefined,
    maxParticipants: undefined,
    displaySettings: {
        welcomeHeader: 'Welcome',
        welcomeContent:
            'This is an experiment that is being carried out by Cambridge University.\nHere you will have a therapy session with a chat bot.\nThe conversation is completely anonymous.\nFeel free to share as you like.',
    },
    experimentForms: {
        registration: null,
        preConversation: null,
        postConversation: null,
    },
    experimentFeatures: {
        userAnnotation: false,
        streamMessage: false,
        streamWordsPerMinute: DEFAULT_STREAM_WPM,
    },
} as const;

export const initialSlidersEnabled = {
    temperatureEnabled: false,
    maxTokensEnabled: false,
    topPEnabled: false,
    frequencyPenaltyEnabled: false,
    presencePenaltyEnabled: false,
    audioInputEnabled: false,
} as const;

export const ApiPaths = {
    CONVERSATIONS_PATH: 'conversations',
    USERS_PATH: 'users',
    DATA_AGGREGATION_PATH: 'dataAggregation',
    AGENTS_PATH: 'agents',
    EXPERIMENTS_PATH: 'experiments',
    FORMS_PATH: 'forms',
    API_KEYS_PATH: 'apiKeys',
} as const;

export const AdminSections = {
    AGENTS: 'agents',
    EXPERIMENTS: 'experiments',
    FORMS: 'forms',
    DATA: 'data',
    SETTINGS: 'settings',
    USERS: 'users',
} as const;

export const defaultQuestionProps = {
    'binary-radio-selector': { fieldKey: '', label: 'Example For a binary question:', required: true },
    'scale-radio': {
        fieldKey: '',
        label: 'Choose on the scale:',
        left: 'Left Option',
        right: 'Right Option',
        range: 5,
        required: true,
        numbered: false,
    },
    'selection-text-input': {
        fieldKey: '',
        label: 'Select an option',
        required: true,
        selectionOptions: [{ label: 'Option 1', value: 'option1' }],
    },
    'number-input': {
        fieldKey: '',
        label: 'Insert a number',
        min: 0,
        max: 100,
        defaultValue: null,
        required: true,
    },
    'radio-selection': {
        fieldKey: '',
        label: 'Select one of the following options:',
        required: true,
        selectionOptions: [{ label: 'Option 1', value: 'option1' }],
    },
};

export const defaultForm: FormType = {
    name: 'Untitled',
    title: '',
    instructions: '',
    questions: [{ type: 'selection-text-input', props: defaultQuestionProps['selection-text-input'] }],
};

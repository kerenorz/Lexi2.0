import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { ABAgents, IExperiment, PhaseBoundary, PhaseScheduleConfig, SegmentQuota, SegmentsConfig } from '../types';

const AbAgentsSchema = new Schema<ABAgents>({
    distA: { type: Number, required: true },
    agentA: { type: String, required: true },
    distB: { type: Number, required: true },
    agentB: { type: String, required: true },
});

// When each phase starts. Index 0 = phase 2. The first trigger to fire wins.
const PhaseBoundarySchema = new Schema<PhaseBoundary>(
    {
        label: { type: String, required: false },
        startAfterSeconds: { type: Number, required: false },
        startAfterUserMessages: { type: Number, required: false },
        startAtSegment: { type: Number, required: false },
    },
    { _id: false, versionKey: false },
);

// All optional; a quota with no fields never closes the block automatically.
const SegmentQuotaSchema = new Schema<SegmentQuota>(
    {
        minUserMessages: { type: Number, required: false },
        minSeconds: { type: Number, required: false },
        maxUserMessages: { type: Number, required: false },
        maxSeconds: { type: Number, required: false },
    },
    { _id: false, versionKey: false },
);

// Sub-schema, not inline, so experiments without it carry no `segments` key.
const SegmentsConfigSchema = new Schema<SegmentsConfig>(
    {
        enabled: { type: Boolean, required: false },
        count: { type: Number, required: false },
        quotas: { type: [SegmentQuotaSchema], required: false, default: undefined },
        endOfSegmentNotice: { type: String, required: false },
        defaultKnowledgeTemplates: { type: [String], required: false, default: undefined },
    },
    { _id: false, versionKey: false },
);

// Sub-schema, not inline, so experiments without phases carry no `phaseSchedule` key.
const PhaseScheduleSchema = new Schema<PhaseScheduleConfig>(
    {
        mode: { type: String, required: false, enum: ['shared', 'perAgent'] },
        boundaries: { type: [PhaseBoundarySchema], required: false, default: undefined },
        // Keyed by agent id.
        perAgent: { type: Object, required: false },
    },
    { _id: false, versionKey: false },
);

export const experimentsSchema = new Schema<IExperiment>(
    {
        ownerId: { type: String, required: true, index: true },
        agentsMode: { type: String, required: true },
        activeAgent: { type: String },
        abAgents: { type: AbAgentsSchema },
        groupAgents: { type: [String], required: false, default: undefined },
        turnTaking: {
            policy: { type: String, required: false },
            moderatorPrompt: { type: String, required: false },
            perAgentProbability: { type: Object, required: false },
            silenceChance: { type: Number, required: false },
            maxAgentTurnsPerRound: { type: Number, required: false },
            autonomousLevel: { type: String, required: false, default: 'off' },
            autonomousRounds: { type: Number, required: false, default: 0 },
            identifyHumanParticipant: { type: Boolean, required: false, default: false },
            // Must be declared (mongoose strips undeclared paths of an inline object on save)
            // and have no defaults (a default would switch them on for existing experiments).
            scene: { type: String, required: false },
            // Untyped so absent fields stay absent (meaning "use the default").
            threadControl: { type: Object, required: false },
            memoryWindow: { type: Boolean, required: false },
        },
        // Absent = no phases. Applies to every agent mode.
        phaseSchedule: { type: PhaseScheduleSchema, required: false },
        // Group only: which agent(s) post the opening sentence.
        firstMessageSender: { type: String, required: false, enum: ['agent1', 'agent2', 'both'], default: 'both' },
        segments: { type: SegmentsConfigSchema, required: false },
        // { provider: apiKeyId }. Absent = the owner's default keys.
        apiKeyOverrides: { type: Object, required: false },
        createdAt: { type: Date, default: Date.now },
        timestamp: { type: Number, default: () => Date.now() },
        displaySettings: { type: Object },
        isActive: { type: Boolean },
        title: { type: String },
        description: { type: String },
        numberOfParticipants: { type: Number, default: () => 0 },
        experimentForms: {
            registration: { type: String },
            preConversation: { type: String },
            postConversation: { type: String },
        },
        maxMessages: { type: Number },
        maxConversations: { type: Number },
        maxParticipants: { type: Number },
        totalSessions: { type: Number, default: () => 0 },
        openSessions: { type: Number, default: () => 0 },
        experimentFeatures: { type: Object },
    },
    { versionKey: false },
);

export const ExperimentsModel = mongoDbProvider.getModel('experiments', experimentsSchema);

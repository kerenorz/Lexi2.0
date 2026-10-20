import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IMetadataConversation } from '../types';
import { agentsSchema } from './AgentsModel';

export const metadataConversationSchema = new Schema<IMetadataConversation>(
    {
        ownerId: { type: String, index: true },
        experimentId: { type: String, required: true },
        messagesNumber: { type: Number, default: () => 0 },
        createdAt: { type: Date, default: Date.now },
        timestamp: { type: Number, default: () => Date.now() },
        lastMessageDate: { type: Date, default: Date.now },
        lastMessageTimestamp: { type: Number, default: () => Date.now() },
        preConversation: { type: Object },
        postConversation: { type: Object },
        conversationNumber: { type: Number },
        userId: { type: String, required: true },
        maxMessages: { type: Number },
        isFinished: { type: Boolean, default: () => false },
        agent: { type: agentsSchema, required: true },
        agents: { type: [agentsSchema], required: false, default: undefined },
        mode: { type: String, required: false },
        // Snapshot of experiment.turnTaking at creation.
        turnTaking: { type: Object, required: false },
        // PRNG seed (hex); group conversations only.
        seed: { type: String, required: false },
        // Message count when a seed was backfilled; earlier rounds are not replayable.
        seedBackfilledAtMessage: { type: Number, required: false },
        // Stamped at the first round, not creation, since the pre-conversation form comes first.
        phaseClockStartedAt: { type: Number, required: false },
        // Append-only log of phase entries.
        phaseHistory: { type: [Object], required: false, default: undefined },
        // Append-only log of rounds thread control ended early.
        threadLog: { type: [Object], required: false, default: undefined },
        // Append-only log of user rounds with no reply. Must be declared: strict mode drops $push to undeclared paths.
        silentRounds: { type: [Object], required: false, default: undefined },
        // Segment fields below have no default, so unsegmented docs carry no keys.
        //
        // Presence of the array is the "segmented" flag. Untyped (Mixed) on purpose, so every
        // SegmentRecord field round-trips; a typed sub-schema would drop undeclared fields.
        segments: { type: [Object], required: false, default: undefined },
        // Sum of closed blocks' spans; with phaseClockStartedAt this is chat time excluding survey pages.
        chatElapsedAccumulatedMs: { type: Number, required: false },
        // Written once; the export's time origin, since phaseClockStartedAt is cleared between blocks.
        chatClockFirstStartedAt: { type: Number, required: false },
        // Survey answers keyed by gap index.
        surveyAnswers: { type: Object, required: false },
        // Agent knowledge keyed by agent id.
        knowledge: { type: Object, required: false },
        // Agent-only round budget. No defaults; see claimAutonomousRound.
        // Rounds used since the last refill. A refill unsets it.
        autonomousRoundsUsed: { type: Number, required: false },
        // Set while an agent-only round is generating. Honoured only within
        // AUTONOMOUS_ROUND_MARKER_TTL_MS so a crashed process can't block the conversation.
        autonomousRoundStartedAt: { type: Date, required: false },
    },
    { versionKey: false },
);

// One segmented conversation per participant per experiment. Partial, not sparse: sparse
// would also hit ordinary conversations. The entry route's lookup must use the same filter.
metadataConversationSchema.index(
    { userId: 1, experimentId: 1 },
    { unique: true, partialFilterExpression: { segments: { $exists: true } } },
);

export const MetadataConversationsModel = mongoDbProvider.getModel(
    'metadata_conversations',
    metadataConversationSchema,
);

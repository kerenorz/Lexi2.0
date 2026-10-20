import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IConversation } from '../types';

export const conversationSchema = new Schema<IConversation>(
    {
        conversationId: { type: String, required: true },
        content: { type: String, required: true },
        role: { type: String, required: true },
        speakerId: { type: String, required: false },
        speakerName: { type: String, required: false },
        timeDelay: {type: Number, default: null},
        prev_message: { type: String, default: null },
        createdAt: { type: Date, default: Date.now },
        timestamp: { type: Number, default: () => Date.now() },
        messageNumber: { type: Number, required: true },
        valence: { type: Number, default: 0, required: true },
        arousal: { type: Number, default: 0, required: true },
        userAnnotation: { type: Number, default: () => 0 },
        pit: {type: Number, default: 0},
        loud: {type: Number, default: 0},
        snr: {type: Number, default: 0},
        // Optional fields below have no `default` on purpose, so they stay absent on docs
        // that don't use them instead of being written onto every message.
        preTypingDelayMs: { type: Number, required: false },
        typingDurationMs: { type: Number, required: false },
        interSegmentPauseMs: { type: Number, required: false },
        segmentGroupId: { type: String, required: false },
        segmentIndex: { type: Number, required: false },
        segmentCount: { type: Number, required: false },
        revealAtMs: { type: Number, required: false },
        displayedAt: { type: Number, required: false },
        // Phase that produced this message (0 = phase 1).
        phaseIndex: { type: Number, required: false },
        phaseLabel: { type: String, required: false },
        // Thread-control move that steered this turn.
        move: { type: String, required: false },
        // Client-sent id on user turns only (utils/clientMessageId); used to dedupe re-sends
        // and to re-sync.
        clientMessageId: { type: String, required: false },
    },
    { versionKey: false },
);

// Two indexes on the same pair:
// 1. { conversationId, messageNumber }, not unique: serves transcript reads. Can't be unique
//    because older data holds duplicate pairs.
// 2. { messageNumber, conversationId }, unique, partial on createdAt >= a fixed cutoff, so old
//    duplicates stay outside it. Guards numbering across processes; a clash becomes a 409.
//    Key order differs so MongoDB treats it as a separate index and reads keep using (1).
//    Changing its name, keys or filter (cutoff included) conflicts with the existing index:
//    drop the old one by name first.
// A failed build is silent in mongoose, so the 'index' listener below logs it.
const TRANSCRIPT_UNIQUE_SINCE = new Date('2026-10-09T00:00:00Z');
const TRANSCRIPT_UNIQUE_INDEX = 'messageNumber_unique_per_conversation_since_2026_10_09';

conversationSchema.index({ conversationId: 1, messageNumber: 1 });
conversationSchema.index(
    { messageNumber: 1, conversationId: 1 },
    {
        name: TRANSCRIPT_UNIQUE_INDEX,
        unique: true,
        partialFilterExpression: { createdAt: { $gte: TRANSCRIPT_UNIQUE_SINCE } },
    },
);

export const ConversationsModel = mongoDbProvider.getModel('conversations', conversationSchema);

// Fires once per build with the first failure. Must not throw: it runs in mongoose's build callback.
ConversationsModel.on('index', (error?: { code?: unknown; message?: unknown }) => {
    if (!error) return;
    console.error(
        '[index] conversations: an index could not be built, and the server is running WITHOUT it. ' +
            (error.code === 11000
                ? `${TRANSCRIPT_UNIQUE_INDEX} failed because messages dated from ` +
                  `${TRANSCRIPT_UNIQUE_SINCE.toISOString()} already repeat a (conversationId, messageNumber) ` +
                  'pair, so nothing stops a second writer numbering into a transcript. List them with ' +
                  'tools/transcript-duplicates.js. '
                : '') +
            `Cause: ${String(error.message ?? error)}`,
    );
});

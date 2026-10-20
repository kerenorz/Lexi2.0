import mongoose from 'mongoose';
import { PhaseBoundary } from './experiments.type';

// One conversation phase. On a saved agent only the prompts are set (timing lives on the
// experiment); a conversation snapshot carries both, merged by mergeAgentPhases.
// A blank prompt inherits from the previous phase (phase 2 from the base prompts).
export interface ConversationPhase extends PhaseBoundary {
    systemStarterPrompt?: string;
    beforeUserSentencePrompt?: string;
    afterUserSentencePrompt?: string;
}

export interface IAgent {
    _id?: mongoose.Types.ObjectId | string;
    ownerId?: string;
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
    stopSequences: string[];
    pacing?: {
        typingSpeed?: number;
        typingSpeedVariation?: number;
        preTypingDelayMsMean?: number;
        preTypingDelayMsRange?: number;
        splitProbability?: number;
        maxSegments?: number;
        // Human Deception toggles. Four, not six, because the knobs are coupled:
        // variation needs a typing speed, Range is meaningless without Mean, and
        // maxSegments without splitProbability. Absent means enabled; only `false` disables.
        enabled?: {
            typingSpeed?: boolean;
            typingVariation?: boolean;
            preTypingPause?: boolean;
            split?: boolean;
        };
    };
    // Humanized pacing. Older agents with HD on lack this flag and stay non-humanized.
    humanized?: boolean;
    // Index 0 is phase 2 (phase 1 is the base prompts). Absent means no phases.
    phases?: ConversationPhase[];
    // What this agent learns from survey answers in each break; index 0 = after block 1.
    // Per agent so group agents can know different things; the experiment holds a default.
    // {{placeholder}} prose; sentences with unanswered slots are dropped (renderKnowledgeTemplate).
    knowledgeTemplates?: string[];
    createdAt: Date;
    timestamp: number;
}

export interface IAgentLean {
    _id?: mongoose.Types.ObjectId | string;
    title: string;
}

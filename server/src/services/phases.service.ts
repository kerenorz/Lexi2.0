import { ConversationPhase, IAgent, PhaseBoundary, PhaseScheduleConfig } from '../types';

// Conversation phases: swap an agent's prompts as the conversation progresses. Pure.
// Timing lives on the experiment (one schedule, so agents can't drift apart); text lives
// on the agent. Both are merged into the conversation's agent snapshot at creation.
// Indexing: phaseIndex 0 is the base prompts; phases[0] / boundaries[0] describe phase 2.

// Blank means "inherit", not "clear", so a phase can't blank an inherited prompt.
const filled = (s?: string | null): string | undefined =>
    typeof s === 'string' && s.trim() !== '' ? s : undefined;

// A spread of a hydrated mongoose doc loses its fields (they are getters).
const toPlain = <T>(doc: any): T => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

// The boundaries this agent runs. 'perAgent' with no entry: the agent stays in phase 1.
export const boundariesForAgent = (
    schedule: PhaseScheduleConfig | undefined | null,
    agentId: unknown,
): PhaseBoundary[] => {
    const s = toPlain<PhaseScheduleConfig>(schedule);
    if (!s) return [];
    if (s.mode === 'perAgent') return toPlain<PhaseBoundary[]>(s.perAgent?.[String(agentId)]) ?? [];
    return toPlain<PhaseBoundary[]>(s.boundaries) ?? [];
};

export interface MergeResult {
    agent: IAgent;
    // Text phases beyond the schedule's end (they can never start), so the caller can warn.
    droppedTextPhases: number;
}

// Merge schedule and text into a fully resolved phases[], so the snapshot records exactly
// what each phase said. A blank field inherits from the previous phase; a schedule longer
// than the text list carries the last authored phase forward.
export const mergeAgentPhases = (agent: IAgent, schedule?: PhaseScheduleConfig | null): MergeResult => {
    const plain = toPlain<IAgent>(agent);
    const boundaries = boundariesForAgent(schedule, plain?._id);
    const authored: ConversationPhase[] = (toPlain<ConversationPhase[]>(plain?.phases) as any) || [];

    // A missing agent must not break conversation creation for the whole roster.
    if (!plain) return { agent: plain, droppedTextPhases: 0 };

    if (!boundaries.length) {
        // No schedule: strip text phases that could never fire. An unphased agent is returned untouched.
        if (plain.phases === undefined) return { agent: plain, droppedTextPhases: 0 };
        const stripped = { ...plain };
        delete (stripped as any).phases;
        return { agent: stripped, droppedTextPhases: authored.length };
    }

    let prevSystem = plain.systemStarterPrompt;
    let prevBefore = plain.beforeUserSentencePrompt;
    let prevAfter = plain.afterUserSentencePrompt;

    const phases: ConversationPhase[] = boundaries.map((boundary, i) => {
        const text = authored[i];
        prevSystem = filled(text?.systemStarterPrompt) ?? prevSystem;
        prevBefore = filled(text?.beforeUserSentencePrompt) ?? prevBefore;
        prevAfter = filled(text?.afterUserSentencePrompt) ?? prevAfter;

        const merged: ConversationPhase = {
            // The schedule's label is shared by every agent, so it wins.
            label: filled(boundary?.label) ?? filled(text?.label),
            systemStarterPrompt: prevSystem,
            beforeUserSentencePrompt: prevBefore,
            afterUserSentencePrompt: prevAfter,
        };
        if (typeof boundary?.startAfterSeconds === 'number') merged.startAfterSeconds = boundary.startAfterSeconds;
        if (typeof boundary?.startAfterUserMessages === 'number') {
            merged.startAfterUserMessages = boundary.startAfterUserMessages;
        }
        // Only when declared, so dueBy reads a missing key as "not declared", not 0.
        if (typeof boundary?.startAtSegment === 'number') merged.startAtSegment = boundary.startAtSegment;
        return merged;
    });

    return {
        agent: { ...plain, phases },
        droppedTextPhases: Math.max(0, authored.length - boundaries.length),
    };
};

export interface PhaseClock {
    // Chat time, not wall time: survey pages between segments don't count (see chatElapsedMs).
    elapsedMs: number;
    // Participant messages so far, including the one being answered.
    userMessages: number;
    // 1-based open segment. Absent when unsegmented, so segment triggers stay inert.
    segment?: number;
}

export interface PhaseResolution {
    // 0 = phase 1 (base prompts). N = phases[N-1].
    index: number;
    label?: string;
    // Which threshold put us here. null only at index 0.
    trigger: 'time' | 'turns' | 'segment' | null;
}

// Chat clock = closed segments' total + the running span. Unsegmented: just now minus the
// first round. Between segments there is no anchor, so the clock is frozen.
// The anchor is set at segment open (segmented), so a silent participant's time quota still
// fires, and at the first round (unsegmented), so the pre-chat form doesn't eat phase 1.
export interface ChatClockState {
    // Sum of every closed segment's span.
    chatElapsedAccumulatedMs?: number | null;
    // Start of the running span; absent when none is running.
    phaseClockStartedAt?: number | null;
}

export const chatElapsedMs = (state: ChatClockState | undefined | null, now: number): number => {
    const accumulated = typeof state?.chatElapsedAccumulatedMs === 'number' ? state.chatElapsedAccumulatedMs : 0;
    const startedAt = typeof state?.phaseClockStartedAt === 'number' ? state.phaseClockStartedAt : null;
    // Guard a clock that moved backwards, which could walk a participant back a phase.
    const running = startedAt != null ? Math.max(0, now - startedAt) : 0;
    return Math.max(0, accumulated) + running;
};

// Any declared threshold suffices (whichever comes first). A turn-only phase may never fire
// if the participant goes quiet.
const dueBy = (
    b: PhaseBoundary | undefined,
    clock: PhaseClock,
): { time: boolean; turns: boolean; segment: boolean } => ({
    time:
        typeof b?.startAfterSeconds === 'number' &&
        b.startAfterSeconds >= 0 &&
        clock.elapsedMs >= b.startAfterSeconds * 1000,
    turns:
        typeof b?.startAfterUserMessages === 'number' &&
        b.startAfterUserMessages >= 0 &&
        clock.userMessages >= b.startAfterUserMessages,
    // Needs a segment on the clock too, so it stays inert in an unsegmented chat.
    segment:
        typeof b?.startAtSegment === 'number' &&
        b.startAtSegment >= 0 &&
        typeof clock.segment === 'number' &&
        clock.segment >= b.startAtSegment,
});

// The highest phase whose trigger has fired, so skipping past two boundaries while idle
// lands on the later one regardless of how often this is called.
export const resolvePhase = (phases: ConversationPhase[] | undefined | null, clock: PhaseClock): PhaseResolution => {
    if (!phases || !phases.length) return { index: 0, trigger: null };

    let best = -1;
    let bestTrigger: 'time' | 'turns' | 'segment' | null = null;
    for (let i = 0; i < phases.length; i++) {
        const met = dueBy(phases[i], clock);
        if (!met.time && !met.turns && !met.segment) continue;
        best = i;
        // Tie label: segment > turns > time. Cosmetic only (the export label).
        bestTrigger = met.segment ? 'segment' : met.turns ? 'turns' : 'time';
    }

    if (best < 0) return { index: 0, trigger: null };
    return { index: best + 1, label: phases[best]?.label, trigger: bestTrigger };
};

// The agent as the model sees it this round. Index 0 returns the same object, so an
// unphased conversation is never altered.
export const applyPhase = (agent: IAgent, phaseIndex: number): IAgent => {
    if (!agent || !phaseIndex || phaseIndex < 1) return agent;
    const phase = agent.phases?.[phaseIndex - 1];
    if (!phase) return agent;
    return {
        ...agent,
        // Fallbacks cover snapshots not written by mergeAgentPhases.
        systemStarterPrompt: phase.systemStarterPrompt ?? agent.systemStarterPrompt,
        beforeUserSentencePrompt: phase.beforeUserSentencePrompt ?? agent.beforeUserSentencePrompt,
        afterUserSentencePrompt: phase.afterUserSentencePrompt ?? agent.afterUserSentencePrompt,
    };
};

export const applyPhaseForClock = (agent: IAgent, clock: PhaseClock): { agent: IAgent; phase: PhaseResolution } => {
    const phase = resolvePhase(agent?.phases, clock);
    return { agent: applyPhase(agent, phase.index), phase };
};

// Keeps all phase bookkeeping off conversations that never opted in.
export const hasPhases = (agents: (IAgent | undefined)[]): boolean =>
    agents.some((a) => Array.isArray(a?.phases) && a!.phases!.length > 0);

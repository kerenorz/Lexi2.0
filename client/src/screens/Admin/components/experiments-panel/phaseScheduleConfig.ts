// Phase schedule logic without React: parsing, validation, and durations <-> absolute thresholds.
// Indexing: phase 1 is the base prompts and is never stored; boundaries[0] is phase 2, hence
// the + 2 offsets. An experiment without phases must keep no phaseSchedule key at all.
import { AgentType, PhaseBoundary, PhaseScheduleConfig, PhaseScheduleMode } from '@models/AppModels';
import { agentLabel } from '../shared/agentLabel';
// Read segments.count exactly as validateSegments does, or a schedule could pass here and
// point past the last block.
import { SegmentsFormValue, parseNumberInput } from './segmentsConfig';

// No Set iteration: the client targets below ES2015.
const uniqueIds = (ids: string[]): string[] => ids.filter((id, i) => !!id && ids.indexOf(id) === i);

// 270 -> "4:30", 45 -> "0:45".
export const formatMmSs = (seconds: number): string => {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

// Returns undefined for blank (trigger unused), null for unparseable (an error, not "unused"),
// or seconds. Accepts "4:30" or "90". Lenient with half-typed mm:ss since it runs per keystroke.
export const parseSecondsInput = (raw: unknown): number | null | undefined => {
    if (raw === null || raw === undefined) return undefined;
    const text = String(raw).trim();
    if (text === '') return undefined;
    if (text.indexOf(':') !== -1) {
        const parts = text.split(':');
        if (parts.length !== 2) return null;
        const minutes = Number(parts[0].trim() || '0');
        const seconds = Number(parts[1].trim() || '0');
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
        if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) return null;
        if (minutes < 0 || seconds < 0 || seconds >= 60) return null;
        return minutes * 60 + seconds;
    }
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
};

// Same three states, for a whole-number message count.
export const parseCountInput = (raw: unknown): number | null | undefined => {
    if (raw === null || raw === undefined) return undefined;
    const text = String(raw).trim();
    if (text === '') return undefined;
    const n = Number(text);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    return n;
};

// Strings are in-progress keystrokes and shown verbatim; numbers come from a saved schedule.
// Coercion happens only on save, so partial input isn't rewritten under the caret.
export const secondsInputValue = (raw: unknown): string =>
    typeof raw === 'number' ? formatMmSs(raw) : raw === null || raw === undefined ? '' : String(raw);

export const countInputValue = (raw: unknown): string =>
    typeof raw === 'number' ? String(raw) : raw === null || raw === undefined ? '' : String(raw);

// True for any declared block trigger, including a string or empty one, so the field doesn't
// unmount under the caret while typing.
export const declaresSegment = (boundary?: PhaseBoundary): boolean => {
    const raw = boundary?.startAtSegment;
    return raw !== null && raw !== undefined;
};

export const scheduleMode = (schedule?: PhaseScheduleConfig): PhaseScheduleMode =>
    schedule && schedule.mode === 'perAgent' ? 'perAgent' : 'shared';

// Hand-kept mirror of the server's boundariesForAgent (phases.service). An agent with no
// perAgent entry stays in phase 1.
export const boundariesForAgent = (
    schedule: PhaseScheduleConfig | undefined,
    agentId: string,
): PhaseBoundary[] => {
    if (!schedule) return [];
    if (scheduleMode(schedule) === 'perAgent') return (schedule.perAgent && schedule.perAgent[agentId]) || [];
    return schedule.boundaries || [];
};

// Roster ids plus any id already holding a list, so lists of swapped-out agents stay aligned.
export const perAgentIds = (schedule: PhaseScheduleConfig | undefined, rosterAgents: AgentType[]): string[] =>
    uniqueIds([
        ...(rosterAgents || []).map((agent) => String(agent._id)),
        ...Object.keys((schedule && schedule.perAgent) || {}),
    ]);

// Number of phase changes. In perAgent mode, the longest list.
export const rowCount = (schedule: PhaseScheduleConfig | undefined, rosterAgents: AgentType[]): number => {
    if (!schedule) return 0;
    if (scheduleMode(schedule) === 'shared') return (schedule.boundaries || []).length;
    return perAgentIds(schedule, rosterAgents).reduce(
        (max, id) => Math.max(max, boundariesForAgent(schedule, id).length),
        0,
    );
};

export const padTo = (list: PhaseBoundary[], length: number): PhaseBoundary[] => {
    const padded = list.slice();
    while (padded.length < length) padded.push({});
    return padded;
};

// Lists that will run (all stored lists if no roster yet). Padded to the row count so a
// short list's blank rows are flagged instead of leaving that agent stuck in phase 1.
export const listsToValidate = (
    schedule: PhaseScheduleConfig,
    rosterAgents: AgentType[],
): { agentId?: string; agentName?: string; boundaries: PhaseBoundary[] }[] => {
    if (scheduleMode(schedule) === 'shared') return [{ boundaries: schedule.boundaries || [] }];
    const rows = rowCount(schedule, rosterAgents);
    if (rosterAgents && rosterAgents.length) {
        return rosterAgents.map((agent) => ({
            agentId: String(agent._id),
            agentName: agentLabel(agent),
            boundaries: padTo(boundariesForAgent(schedule, String(agent._id)), rows),
        }));
    }
    return Object.keys((schedule && schedule.perAgent) || {}).map((agentId) => ({
        agentId,
        boundaries: padTo(schedule.perAgent[agentId] || [], rows),
    }));
};

export type PhaseIssueField = 'seconds' | 'messages' | 'segment' | 'row';

export interface PhaseScheduleIssue {
    // perAgent mode only.
    agentId?: string;
    // 0 is phase 2.
    index: number;
    field: PhaseIssueField;
    // Self-contained: also shown in the snackbar on a blocked save.
    message: string;
}

// Save-blocking issues: no trigger, unreadable trigger, a 0 duration (makes the previous phase
// unreachable), or a block trigger that can't fire. Axes and per-agent lists are checked
// independently. Absent `segments` means not survey-embedded.
export const validatePhaseSchedule = (
    schedule: PhaseScheduleConfig | undefined,
    rosterAgents: AgentType[],
    segments?: SegmentsFormValue,
): PhaseScheduleIssue[] => {
    if (!schedule) return [];
    const issues: PhaseScheduleIssue[] = [];
    const isSegmented = !!segments?.enabled;
    // A bad count is validateSegments' error to report, not this row's.
    const segmentCount = isSegmented ? parseNumberInput(segments?.count) : undefined;

    listsToValidate(schedule, rosterAgents).forEach(({ agentId, agentName, boundaries }) => {
        const who = agentName ? ` (${agentName})` : '';

        (boundaries || []).forEach((boundary, index) => {
            const phase = index + 2;
            const seconds = parseSecondsInput(boundary && boundary.startAfterSeconds);
            const count = parseCountInput(boundary && boundary.startAfterUserMessages);
            const segment = parseCountInput(boundary && boundary.startAtSegment);

            if (seconds === null) {
                issues.push({
                    agentId,
                    index,
                    field: 'seconds',
                    message: `Phase ${phase}${who}: that is not a time. Use mm:ss (4:30) or a whole number of seconds.`,
                });
            }
            if (count === null) {
                issues.push({
                    agentId,
                    index,
                    field: 'messages',
                    message: `Phase ${phase}${who}: the message count must be a whole number of participant messages.`,
                });
            }
            if (segment === null) {
                issues.push({
                    agentId,
                    index,
                    field: 'segment',
                    message: `Phase ${phase}${who}: the chat block must be a whole number, where 1 is the first block.`,
                });
            }
            // A 0 duration shares the previous phase's threshold, and resolvePhase takes the
            // highest met boundary, so the previous phase would never be seen.
            if (seconds === 0) {
                issues.push({
                    agentId,
                    index,
                    field: 'seconds',
                    message: `Phase ${phase}${who} cannot last 0 seconds — it would start at the very moment phase ${
                        phase - 1
                    } does, so phase ${phase - 1} would never be seen. Use 1 or more, or leave it blank to start on messages alone.`,
                });
            }
            if (count === 0) {
                issues.push({
                    agentId,
                    index,
                    field: 'messages',
                    message: `Phase ${phase}${who} cannot last 0 participant messages — it would start on the same message as phase ${
                        phase - 1
                    }, so phase ${phase - 1} would never be seen. Use 1 or more, or leave it blank to start on time alone.`,
                });
            }
            if (typeof segment === 'number' && segment < 2) {
                // Block 1 is phase 1's, so phase 1 would never be seen.
                issues.push({
                    agentId,
                    index,
                    field: 'segment',
                    message: `Phase ${phase}${who} cannot start at block 1 — that is where phase 1 runs. The first change can start at block 2.`,
                });
            }
            // Block triggers are inert in an unsegmented conversation (dueBy).
            if (typeof segment === 'number' && segment >= 2 && !isSegmented) {
                issues.push({
                    agentId,
                    index,
                    field: 'segment',
                    message: `Phase ${phase}${who} starts at chat block ${segment}, but this study is not split into chat blocks — tick "Used inside a survey" above, or start this phase on time or messages instead. A block trigger can never fire in an ordinary conversation.`,
                });
            }
            if (
                typeof segment === 'number' &&
                segment >= 2 &&
                typeof segmentCount === 'number' &&
                segment > segmentCount
            ) {
                issues.push({
                    agentId,
                    index,
                    field: 'segment',
                    message: `Phase ${phase}${who} starts at chat block ${segment}, but this study has only ${segmentCount} block${
                        segmentCount === 1 ? '' : 's'
                    } — the participant never reaches that block, so the phase would never start.`,
                });
            }
            if (seconds === undefined && count === undefined && segment === undefined) {
                issues.push({
                    agentId,
                    index,
                    field: 'row',
                    message: `Phase ${phase}${who} needs a duration or a chat block — a phase with no trigger can never start.`,
                });
            }

            // No cross-row ordering check: durations can't be negative, and the zero check above
            // covers equality. Out-of-order block numbers are legal; resolvePhase handles them.
        });
    });

    return issues;
};

// One row, form -> DB. Drops blank keys rather than writing nulls (the server tests
// typeof === 'number'). Does not accumulate; see accumulateBoundaries.
export const normalizeBoundary = (boundary: PhaseBoundary): PhaseBoundary => {
    const normalized: PhaseBoundary = {};
    const label = typeof boundary?.label === 'string' ? boundary.label.trim() : '';
    if (label) normalized.label = label;
    const seconds = parseSecondsInput(boundary?.startAfterSeconds);
    if (typeof seconds === 'number') normalized.startAfterSeconds = seconds;
    const count = parseCountInput(boundary?.startAfterUserMessages);
    if (typeof count === 'number') normalized.startAfterUserMessages = count;
    // Block numbers are absolute, so never accumulated.
    const segment = parseCountInput(boundary?.startAtSegment);
    if (typeof segment === 'number') normalized.startAtSegment = segment;
    return normalized;
};

// The form shows per-phase durations ("3, 3, 3"); the DB stores totals since the start
// ("3, 6, 9"). Summed per axis, skipping rows that leave that axis blank.
// Limit: with both axes set, a phase that fires early on one axis doesn't shift the other's
// baseline, so durations are nominal.

type TriggerAxis = 'startAfterSeconds' | 'startAfterUserMessages';
const DURATION_AXES: TriggerAxis[] = ['startAfterSeconds', 'startAfterUserMessages'];

// Durations -> absolute. Runs on save over normalized rows.
export const accumulateBoundaries = (boundaries: PhaseBoundary[]): PhaseBoundary[] => {
    const running: Partial<Record<TriggerAxis, number>> = {};
    return (boundaries || []).map((boundary) => {
        const out: PhaseBoundary = { ...boundary };
        DURATION_AXES.forEach((axis) => {
            const duration = out[axis];
            if (typeof duration !== 'number') return;
            const total = (running[axis] ?? 0) + duration;
            running[axis] = total;
            (out as any)[axis] = total;
        });
        return out;
    });
};

// Absolute -> durations, for loading into the form. Clamped at 0 for out-of-order stored data;
// the resulting 0 then blocks save, since that phase really is unreachable.
export const differenceBoundaries = (boundaries: PhaseBoundary[]): PhaseBoundary[] => {
    const running: Partial<Record<TriggerAxis, number>> = {};
    return (boundaries || []).map((boundary) => {
        const out: PhaseBoundary = { ...boundary };
        DURATION_AXES.forEach((axis) => {
            const total = out[axis];
            if (typeof total !== 'number') return;
            (out as any)[axis] = Math.max(0, total - (running[axis] ?? 0));
            running[axis] = total;
        });
        return out;
    });
};

// For ExperimentForm's defaultValues, so it runs once rather than per render.
export const phaseScheduleForForm = (
    schedule: PhaseScheduleConfig | undefined | null,
): PhaseScheduleConfig | undefined => {
    if (!schedule) return undefined;
    if (schedule.mode === 'perAgent') {
        const perAgent: Record<string, PhaseBoundary[]> = {};
        Object.keys(schedule.perAgent || {}).forEach((agentId) => {
            perAgent[agentId] = differenceBoundaries((schedule.perAgent || {})[agentId] || []);
        });
        return { mode: 'perAgent', perAgent };
    }
    return { mode: 'shared', boundaries: differenceBoundaries(schedule.boundaries || []) };
};

// Form strings -> stored numbers. Returns undefined for an empty schedule so the key is
// dropped. Lists for agents no longer in the roster are kept (harmless at runtime).
export const normalizePhaseSchedule = (
    schedule: PhaseScheduleConfig | undefined,
    rosterAgents: AgentType[],
): PhaseScheduleConfig | undefined => {
    if (!schedule) return undefined;

    if (scheduleMode(schedule) === 'shared') {
        const boundaries = accumulateBoundaries((schedule.boundaries || []).map(normalizeBoundary));
        if (!boundaries.length) return undefined;
        return { mode: 'shared', boundaries };
    }

    const perAgent: Record<string, PhaseBoundary[]> = {};
    perAgentIds(schedule, rosterAgents).forEach((agentId) => {
        // Accumulated per agent: each has its own timeline.
        const boundaries = accumulateBoundaries(boundariesForAgent(schedule, agentId).map(normalizeBoundary));
        // Omit empty lists; the server reads a missing key the same way.
        if (boundaries.length) perAgent[agentId] = boundaries;
    });
    if (!Object.keys(perAgent).length) return undefined;
    return { mode: 'perAgent', perAgent };
};

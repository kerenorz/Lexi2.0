import { SegmentCloseReason, SegmentRecord } from '../types/conversations.type';
import { SegmentQuota, SegmentsConfig } from '../types/experiments.type';

// Chat blocks (segments) for a conversation embedded in a survey. Pure: no IO, no clock.
// A segment is open or closed; closed is permanent. Entry resumes the open segment, else
// opens the next, which makes reloads, back buttons and double clicks idempotent.
// Segments are 1-based.

// Presence of the array is the flag.
export const isSegmented = (segments: SegmentRecord[] | undefined | null): boolean =>
    Array.isArray(segments) && segments.length > 0;

// At most one is open at a time.
export const openSegment = (segments: SegmentRecord[] | undefined | null): SegmentRecord | undefined =>
    (segments || []).find((s) => s && s.closedAt == null);

// 0 when none have opened, so the next is always last + 1.
export const lastSegmentNumber = (segments: SegmentRecord[] | undefined | null): number =>
    (segments || []).reduce((max, s) => Math.max(max, s?.number ?? 0), 0);

export const closedSegmentCount = (segments: SegmentRecord[] | undefined | null): number =>
    (segments || []).filter((s) => s && s.closedAt != null).length;

const declared = (n: unknown): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;

// Quota for block N. Blank fields inherit per field from earlier rows; blocks past the
// list reuse the last row. Frozen onto the segment at open so mid-study edits don't apply.
export const quotaForSegment = (config: SegmentsConfig | undefined | null, segmentNumber: number): SegmentQuota => {
    const rows = Array.isArray(config?.quotas) ? config!.quotas! : [];
    const resolved: SegmentQuota = {};
    const upTo = Math.min(segmentNumber, rows.length);
    for (let i = 0; i < upTo; i++) {
        const row = rows[i] || {};
        const min = declared(row.minUserMessages);
        const minS = declared(row.minSeconds);
        const max = declared(row.maxUserMessages);
        const maxS = declared(row.maxSeconds);
        if (min !== undefined) resolved.minUserMessages = min;
        if (minS !== undefined) resolved.minSeconds = minS;
        if (max !== undefined) resolved.maxUserMessages = max;
        if (maxS !== undefined) resolved.maxSeconds = maxS;
    }
    return resolved;
};

export interface QuotaProgress {
    // Participant messages in this block only.
    userMessagesInSegment: number;
    elapsedInSegmentMs: number;
}

export interface QuotaVerdict {
    // Releases the survey's Next button. No floor means true from the start.
    floorMet: boolean;
    ceilingHit: boolean;
    closedBy: SegmentCloseReason | null;
}

// Floors must all be met; any ceiling closes the block. Undeclared thresholds are ignored.
export const evaluateQuota = (quota: SegmentQuota | undefined | null, progress: QuotaProgress): QuotaVerdict => {
    const q = quota || {};
    const minMsgs = declared(q.minUserMessages);
    const minSecs = declared(q.minSeconds);
    const maxMsgs = declared(q.maxUserMessages);
    const maxSecs = declared(q.maxSeconds);

    const floorMet =
        (minMsgs === undefined || progress.userMessagesInSegment >= minMsgs) &&
        (minSecs === undefined || progress.elapsedInSegmentMs >= minSecs * 1000);

    const messagesHit = maxMsgs !== undefined && progress.userMessagesInSegment >= maxMsgs;
    const secondsHit = maxSecs !== undefined && progress.elapsedInSegmentMs >= maxSecs * 1000;

    return {
        floorMet,
        ceilingHit: messagesHit || secondsHit,
        // Tie goes to messages, as in resolvePhase.
        closedBy: messagesHit ? 'messages' : secondsHit ? 'seconds' : null,
    };
};

export type EntryDecision =
    | { action: 'reuse'; segment: number }
    | { action: 'open'; segment: number; skippedFrom?: number }
    // Survey branched past the open block. The caller defers the close if a round is in flight.
    | { action: 'closeThenOpen'; close: number; open: number; skippedFrom?: number }
    | { action: 'exhausted'; lastSegment: number };

export interface EntryRequest {
    segments: SegmentRecord[] | undefined | null;
    declaredCount: number;
    // Honoured only forward.
    requestedSegment?: number | null;
}

// A requested segment is honoured only forward (a survey may skip blocks). A backward request
// would replay a closed block, so it is treated as a bare entry and resumes the current one.
export const resolveEntry = ({ segments, declaredCount, requestedSegment }: EntryRequest): EntryDecision => {
    const open = openSegment(segments);
    const last = lastSegmentNumber(segments);
    const count = Number.isFinite(declaredCount) && declaredCount > 0 ? declaredCount : 0;
    const override =
        typeof requestedSegment === 'number' && Number.isFinite(requestedSegment) && requestedSegment > 0
            ? Math.min(Math.floor(requestedSegment), count || Math.floor(requestedSegment))
            : undefined;

    if (open) {
        if (override !== undefined && override > open.number) {
            return {
                action: 'closeThenOpen',
                close: open.number,
                open: override,
                // Recorded so the export shows skipped blocks explicitly.
                ...(override > open.number + 1 ? { skippedFrom: open.number } : {}),
            };
        }
        return { action: 'reuse', segment: open.number };
    }

    const next = override !== undefined && override > last ? override : last + 1;
    if (count && next > count) return { action: 'exhausted', lastSegment: last };
    return {
        action: 'open',
        segment: next,
        ...(next > last + 1 ? { skippedFrom: last } : {}),
    };
};

// Participant turns only (openedAtUserMessages), never the transcript position: a group
// round stores several agent messages per participant turn.
export const userMessagesInSegment = (
    segment: SegmentRecord | undefined | null,
    userMessagesTotal: number,
): number => {
    if (!segment) return userMessagesTotal;
    const openedAt = typeof segment.openedAtUserMessages === 'number' ? segment.openedAtUserMessages : 0;
    return Math.max(0, userMessagesTotal - openedAt);
};

// Transcript position a block opened at. Older records only have openedAtMessageNumber
// (a round count), used as-is so their exports stay unchanged.
const segmentOpenedAt = (segment: SegmentRecord): number =>
    typeof segment.openedAtTranscriptPosition === 'number'
        ? segment.openedAtTranscriptPosition
        : typeof segment.openedAtMessageNumber === 'number'
          ? segment.openedAtMessageNumber
          : 0;

// Highest messageNumber among the docs, 0 for none.
export const transcriptPositionOf = (docs: ReadonlyArray<{ messageNumber?: unknown }>): number =>
    docs.reduce(
        (max: number, d) => (typeof d?.messageNumber === 'number' && d.messageNumber > max ? d.messageNumber : max),
        0,
    );

// Block a message belongs to: the last block whose open position is below its number.
// Derived, not stamped on each message.
export const segmentForMessage = (
    segments: SegmentRecord[] | undefined | null,
    messageNumber: number,
): number | null => {
    if (!Array.isArray(segments) || !segments.length) return null;
    if (!Number.isFinite(messageNumber)) return null;
    let found: number | null = null;
    for (const s of segments) {
        if (!s) continue;
        if (messageNumber > segmentOpenedAt(s) && (found === null || s.number > found)) found = s.number;
    }
    // A message before any block (hand-edited record) is reported as the first block.
    return found ?? (segments[0]?.number ?? null);
};

export const isFinalSegment = (segmentNumber: number, declaredCount: number): boolean =>
    Number.isFinite(declaredCount) && declaredCount > 0 && segmentNumber >= declaredCount;

// Survey answers become plain facts the agent knows, from a researcher-written template.
// No mention of a survey and no fake turns, which would break the deception or the transcript.

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

// Keeps the punctuation with its sentence so dropping one leaves the rest readable.
const intoSentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '');

// Fills a template, dropping any sentence with an unanswered placeholder, so the agent never
// says "you are {{age}}" or "you are  years old" and exposes the survey link.
export const renderKnowledgeTemplate = (
    template: string | undefined | null,
    values: Record<string, unknown> | undefined | null,
): string => {
    const raw = (template || '').trim();
    if (!raw) return '';
    const answers = values || {};

    const kept = intoSentences(raw).filter((sentence) => {
        const names = [...sentence.matchAll(PLACEHOLDER)].map((m) => m[1]);
        return names.every((name) => {
            const v = answers[name];
            return v !== undefined && v !== null && String(v).trim() !== '';
        });
    });

    return kept
        .map((sentence) => sentence.replace(PLACEHOLDER, (_m, name) => String(answers[name])))
        .join(' ')
        .trim();
};

export const templatePlaceholders = (template: string | undefined | null): string[] => [
    ...new Set([...String(template || '').matchAll(PLACEHOLDER)].map((m) => m[1])),
];

// Knowledge accumulates across blocks, capped so the system prompt can't grow without limit.
// Oldest entries drop first; the latest answers matter most to the current block.
export const KNOWLEDGE_CHAR_BUDGET = 2000;

export const composeKnowledge = (entries: string[] | undefined | null): string => {
    const kept = (entries || []).map((e) => (e || '').trim()).filter(Boolean);
    if (!kept.length) return '';

    const out: string[] = [];
    let used = 0;
    for (let i = kept.length - 1; i >= 0; i--) {
        const cost = kept[i].length + 1;
        if (used + cost > KNOWLEDGE_CHAR_BUDGET) break;
        out.unshift(kept[i]);
        used += cost;
    }
    return out.join(' ');
};

// Must run after applyPhase: a phase replaces the whole system prompt and would silently
// erase the knowledge. Returns the same object when there is nothing to add.
export const applyKnowledge = <T extends { systemStarterPrompt?: string }>(agent: T, knowledge: string): T => {
    if (!agent || !knowledge) return agent;
    return {
        ...agent,
        systemStarterPrompt: `${agent.systemStarterPrompt || ''}\n\n${knowledge}`.trim(),
    };
};

export interface ClientSegmentView {
    number: number;
    isOpen: boolean;
    isFinal: boolean;
    // Releases the survey's Next button.
    canProceed: boolean;
    totalSegments: number;
    // Researcher text shown in place of the composer once closed.
    notice?: string;
}

// Allow-list of what the browser may see. Never the quota or counters: a participant who
// sees the limit starts counting, which changes the behaviour being measured.
export const clientSegmentView = (
    segment: SegmentRecord | undefined | null,
    declaredCount: number,
    floorMet: boolean,
    notice?: string,
): ClientSegmentView | null => {
    if (!segment) return null;
    const isOpen = segment.closedAt == null;
    return {
        number: segment.number,
        isOpen,
        isFinal: isFinalSegment(segment.number, declaredCount),
        // A closed block is always proceedable, whatever the floor said.
        canProceed: !isOpen || floorMet,
        totalSegments: Number.isFinite(declaredCount) && declaredCount > 0 ? declaredCount : 0,
        ...(!isOpen && notice ? { notice } : {}),
    };
};

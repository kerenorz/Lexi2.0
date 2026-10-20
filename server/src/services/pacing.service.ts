// Message pacing helpers. Pure: no DB access, randomness passed in.
import { IAgent } from '../types';
import { getResponseDelay, normalRandom } from '../utils/seededRandom';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const DEFAULT_PACING = {
    typingSpeed: undefined as number | undefined, // words/sec; undefined => use inverseTimeDelay
    typingSpeedVariation: 0.22, // jitter sigma
    preTypingDelayMsMean: 900, // reading pause mean
    preTypingDelayMsRange: 600, // +/- uniform => ~[300,1500]ms
    splitProbability: 0.35, // chance a long answer splits into several messages
    maxSegments: 3, // clamped by MAX_SEGMENTS_CEILING
};

// Default cadence for non-humanized agents: deterministic, so messages arrive one at a time.
//   beat   = pause after the previous bubble, for the user to read it.
//   typing = how long the typing indicator shows.
// Clamped: replies are unbounded, so typing time can't grow with length.
const DEFAULT_TYPE_WPS = 6.0; // brisker than HD's human default
const DEFAULT_TYPE_MIN_MS = 800;
const DEFAULT_TYPE_MAX_MS = 3500;
const DEFAULT_READ_WPS = 10.0; // skim speed
const DEFAULT_BEAT_MIN_MS = 300;
const DEFAULT_BEAT_MAX_MS = 1200;

// Soft round budget: past it, gaps scale down proportionally. The compression floor wins,
// so the typing indicator stays visible even if the round runs long.
export const DEFAULT_ROUND_BUDGET_MS = 20000;
const MIN_ROUND_COMPRESSION = 0.4;

// 0 for blank input ('' would otherwise split to ['']).
const countWords = (text: string | null | undefined): number => {
    const t = (text ?? '').trim();
    return t.length === 0 ? 0 : t.split(/\s+/).length;
};

// Human Deception on? An explicit `humanized` flag wins; older agents without it count as
// humanized when a typing speed is set. Pass a plain object: a hydrated Mongoose subdoc
// reads as `{}`, which would humanize every agent.
export function isHumanized(
    agent:
        | { humanized?: boolean; pacing?: IAgent['pacing']; inverseTimeDelay?: number | null }
        | null
        | undefined,
): boolean {
    if (!agent) return false;
    if (agent.humanized === true) return true;
    if (agent.humanized === false) return false;
    if (agent.inverseTimeDelay != null) return true;
    const p = agent.pacing;
    return p != null && typeof p === 'object' && Object.keys(p).length > 0;
}

// Splitting is independent of Human Deception. The explicit flag wins; without it, fall back
// to isHumanized so older agents keep their behaviour. Pass a plain object.
export function isSplitEnabled(
    agent:
        | { humanized?: boolean; pacing?: IAgent['pacing']; inverseTimeDelay?: number | null }
        | null
        | undefined,
): boolean {
    if (!agent) return false;
    const flag = agent.pacing?.enabled?.split;
    if (flag === true) return true;
    if (flag === false) return false;
    return isHumanized(agent);
}

// isHumanized minus audio-input and valence/arousal agents (their second completion's numbering
// would collide with segments). The SSE controller and message() must both use this, or the
// client gets a response shape it didn't expect. Pass a plain object.
export function isHumanizedOneOnOne(
    agent:
        | {
              humanized?: boolean;
              pacing?: IAgent['pacing'];
              inverseTimeDelay?: number | null;
              audioInput?: unknown;
              cameraCaptureRate?: number | null;
              vaIntegration?: unknown;
          }
        | null
        | undefined,
): boolean {
    if (!agent) return false;
    if (!isHumanized(agent)) return false;
    if (agent.audioInput != null) return false;
    if (agent.cameraCaptureRate != null && agent.vaIntegration != null) return false;
    return true;
}

// Non-humanized agents: no pause, jitter or split. Typing still follows inverseTimeDelay.
// Without this they would inherit DEFAULT_PACING's human behaviour.
export const NO_OP_PACING: IAgent['pacing'] = {
    typingSpeedVariation: 0,
    preTypingDelayMsMean: 0,
    preTypingDelayMsRange: 0,
    splitProbability: 0,
    maxSegments: 1,
};

// Hard ceiling on segments whatever the config. Replies under MIN_SPLIT_CHARS never split.
// The inter-segment pause (~[300,900]ms) is shorter than a reading pause.
const MAX_SEGMENTS_CEILING = 5;
const MIN_SPLIT_CHARS = 160;
const INTER_SEGMENT_PAUSE_MS_MEAN = 600;
const INTER_SEGMENT_PAUSE_MS_RANGE = 300;

// Guard against a mis-set typingSpeed, not a pacing knob. Keep it far above normal use
// (Jones-2024 can run minutes), or it flattens the seeded variation.
const TYPING_DURATION_CEILING_MS = 600000; // 10 min

// `??` lets NaN through, and NaN defeats every comparison guard downstream.
const finiteOr = (v: number | undefined, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

// A knob is on unless explicitly false, so older docs without `enabled` keep every knob on.
type PacingEnabled = NonNullable<IAgent['pacing']>['enabled'];
const knobOn = (e: PacingEnabled, k: keyof NonNullable<PacingEnabled>): boolean => e?.[k] !== false;

const PACING_SWITCHES = ['typingSpeed', 'typingVariation', 'preTypingPause', 'split'] as const;

// Plain copy of the switches set to a boolean, or undefined. Checks values, not keys: a hydrated
// subdoc has all four keys with undefined values. Absent flags stay absent (isSplitEnabled
// treats absent differently from true).
const setSwitches = (e: PacingEnabled): PacingEnabled | undefined => {
    if (e == null || typeof e !== 'object') return undefined;
    const out: Record<string, boolean> = {};
    for (const k of PACING_SWITCHES) if (typeof e[k] === 'boolean') out[k] = e[k] as boolean;
    return Object.keys(out).length > 0 ? (out as PacingEnabled) : undefined;
};

// Fill defaults per field and clamp everything: the trust boundary for admin-editable pacing.
// Disabled knobs become zero, which every consumer already treats as off, so no seeded
// draws are added or removed.
export function resolvePacing(p?: IAgent['pacing']) {
    const on = p?.enabled;
    // Keep `enabled` in the persisted snapshot: typingSpeed and split can't be expressed as
    // resolved numbers. Omitted when no switches are set.
    const setOn = setSwitches(on);
    const echo = setOn ? { enabled: setOn } : {};
    return {
        ...echo,
        // Undefined falls back to inverseTimeDelay; disabling typing also needs resolveTypingDelay.
        typingSpeed: knobOn(on, 'typingSpeed')
            ? typeof p?.typingSpeed === 'number' && Number.isFinite(p.typingSpeed)
                ? p.typingSpeed
                : DEFAULT_PACING.typingSpeed
            : undefined,
        // Only applied to a positive typing duration, so it needs no extra gating.
        typingSpeedVariation: knobOn(on, 'typingVariation')
            ? clamp(finiteOr(p?.typingSpeedVariation, DEFAULT_PACING.typingSpeedVariation), 0, 5)
            : 0,
        // One knob: a zero mean disables the pause; range is zeroed too for an honest snapshot.
        preTypingDelayMsMean: knobOn(on, 'preTypingPause')
            ? clamp(finiteOr(p?.preTypingDelayMsMean, DEFAULT_PACING.preTypingDelayMsMean), 0, 8000)
            : 0,
        preTypingDelayMsRange: knobOn(on, 'preTypingPause')
            ? clamp(finiteOr(p?.preTypingDelayMsRange, DEFAULT_PACING.preTypingDelayMsRange), 0, 8000)
            : 0,
        // 0 disables splitting. maxSegments is kept so the setting survives toggling.
        splitProbability: knobOn(on, 'split')
            ? clamp(finiteOr(p?.splitProbability, DEFAULT_PACING.splitProbability), 0, 1)
            : 0,
        maxSegments: clamp(Math.floor(finiteOr(p?.maxSegments, DEFAULT_PACING.maxSegments)), 1, MAX_SEGMENTS_CEILING),
    };
}

// The `timeDelay` to pass computeTimingEnvelope, or null when typing is off. Callers must use
// this instead of inverseTimeDelay, which lives outside pacing, or the toggle does nothing.
// 0 is valid (selects Jones-2024). Typing off also removes the reading pause. Pass a plain object.
export function resolveTypingDelay(
    agent: { pacing?: IAgent['pacing']; inverseTimeDelay?: number | null } | null | undefined,
): number | null {
    if (!agent) return null;
    if (!knobOn(agent.pacing?.enabled, 'typingSpeed')) return null;
    return agent.inverseTimeDelay ?? null;
}

// Message splitting: slice one reply into contiguous chunks, no extra model calls.
// Invariant: never lose, duplicate or reorder text.

// List markers ("1." "2)" "(3)" "a." bullets), two anchorings kept side by side:
//   BARE_LIST_MARKER: chunk is only a marker. `\s*` so a reply opening "\n1." still matches.
//   LIST_ITEM_LINE: line starts with a marker followed by text. `[ \t]*` is the indent used to
//   detect sub-items; the `[ \t]+\S` lookahead rejects "3.14" and a trailing bare "4.".
const BARE_LIST_MARKER = /^\s*(?:[(\[]?(?:\d{1,3}|[a-zA-Z])[.)\]]|[-*•])\s*$/;
const LIST_ITEM_LINE = /^[ \t]*(?:[(\[]?(?:\d{1,3}|[a-zA-Z])[.)\]]|[-*•])(?=[ \t]+\S)/;

// ``` or ~~~ fence line. `m` so it works per line and per block.
const CODE_FENCE_LINE = /^[ \t]*(?:```|~~~)/m;

// Lossless sentence chunks: join('') rebuilds the input. `[^.!?]*` not `+`, or match() would
// silently drop a bare "..." run. Carried into the next chunk instead of cut:
//   - a bare terminator run ("...", "?!"), which opens the next sentence;
//   - a chunk not ending in whitespace ("3." of "3.14");
//   - a line-leading list marker, so "2." stays with its item. Tested on raw[i] so it still
//     carries when something is already being carried.
export function splitSentences(text: string): string[] {
    const raw = text.match(/[^.!?]*[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
    const out: string[] = [];
    let carry = '';
    for (let i = 0; i < raw.length; i++) {
        const chunk = carry + raw[i];
        const isLast = i === raw.length - 1;
        const isBare = !/[^\s.!?"')\]]/.test(chunk);
        const startsLine = i === 0 || /\n[ \t]*$/.test(raw[i - 1]);
        const isMarker = startsLine && BARE_LIST_MARKER.test(raw[i]);
        if (!isLast && (isBare || isMarker || !/\s$/.test(chunk))) {
            carry = chunk;
            continue;
        }
        out.push(chunk);
        carry = '';
    }
    return out.length ? out : [text];
}

// Lossless structural blocks: a list item with its continuation lines and sub-items, a fenced
// code region, or prose up to a blank line. splitReply only cuts between units, so this keeps
// a bubble from ending mid-bullet or mid-code. An unclosed fence swallows the rest (safe: it
// just stops splitting). Leading blank lines attach to the next block, so no unit is pure
// whitespace. No minimum size: a one-line block is a good cut.
export function splitBlocks(text: string): string[] {
    // Lines keep their terminator so CRLF survives and slices stay contiguous.
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [text];
    const blocks: string[] = [];
    let cur = '';
    // A flag, not /\S/.test(cur): re-testing is O(n^2) on a reply of blank lines and blocks the event loop.
    let curHasContent = false;
    // Indent of the marker that opened cur; -1 if cur isn't a list item.
    let markerIndent = -1;
    let inFence = false;
    for (const line of lines) {
        if (inFence) {
            cur += line;
            curHasContent = true;
            if (CODE_FENCE_LINE.test(line)) inFence = false;
            continue;
        }
        if (CODE_FENCE_LINE.test(line)) {
            // Joins the open block, keeping a lead-in line with its code.
            cur += line;
            curHasContent = true;
            inFence = true;
            continue;
        }
        if (!/\S/.test(line)) {
            // Closes a block with content; otherwise leading whitespace for the next one.
            cur += line;
            if (curHasContent) {
                blocks.push(cur);
                cur = '';
                curHasContent = false;
                markerIndent = -1;
            }
            continue;
        }
        if (LIST_ITEM_LINE.test(line)) {
            const indent = (line.match(/^[ \t]*/) as RegExpMatchArray)[0].length;
            const isSubItem = markerIndent >= 0 && indent > markerIndent;
            if (curHasContent && !isSubItem) {
                blocks.push(cur);
                cur = '';
                curHasContent = false;
            }
            // Only the opening marker sets the baseline indent.
            if (!curHasContent) markerIndent = indent;
        }
        cur += line;
        curHasContent = true;
    }
    // A whitespace-only tail joins the previous block.
    if (cur !== '') {
        if (blocks.length > 0 && !curHasContent) blocks[blocks.length - 1] += cur;
        else blocks.push(cur);
    }
    return blocks.length ? blocks : [text];
}

// List items and code fences must not be cut; prose can be cut at sentences.
// Leading whitespace is skipped since blank lines attach to the following block.
const isAtomicBlock = (block: string): boolean =>
    LIST_ITEM_LINE.test(block.replace(/^\s+/, '')) || CODE_FENCE_LINE.test(block);

// Seeded decision to split a reply, and the slicing. Exactly two draws: `roll` always (even on
// early returns, to keep streams aligned across configs), then the segment count only when splitting.
export function splitReply(rng: () => number, text: string, pacing?: IAgent['pacing']): string[] {
    const p = resolvePacing(pacing);
    const maxSeg = p.maxSegments; // already floored + clamped to [1, MAX_SEGMENTS_CEILING]
    const roll = rng();
    if (maxSeg < 2 || p.splitProbability <= 0) return [text];
    if (text.trim().length < MIN_SPLIT_CHARS) return [text];
    // Units: atomic blocks stay whole, prose blocks expand into sentences. Otherwise a short
    // lead-in plus one long paragraph could only ever split into those two pieces.
    const blocks = splitBlocks(text);
    const units =
        blocks.length >= 2 ? blocks.flatMap((b) => (isAtomicBlock(b) ? [b] : splitSentences(b))) : splitSentences(text);
    // Fail closed: if chunks don't rebuild the text exactly, don't split.
    if (units.join('') !== text) return [text];
    if (units.length < 2) return [text];
    if (roll >= p.splitProbability) return [text];

    const maxN = Math.min(maxSeg, units.length);
    const n = 2 + Math.floor(rng() * (maxN - 1)); // uniform in [2, maxN]

    // Contiguous and in order; every group non-empty since n <= units.length.
    const groups: string[][] = Array.from({ length: n }, () => []);
    units.forEach((s, i) => groups[Math.floor((i * n) / units.length)].push(s));
    const out = groups.map((g) => g.join('').trim()).filter((s) => s.length > 0);
    return out.length ? out : [text];
}

// Per-message timing: reading pause, typing duration, jitter. Draw order is fixed for
// reproducibility: (1) pre-typing, (2) typing duration (Jones draws), (3) jitter.
export function computeTimingEnvelope(
    rng: () => number,
    content: string,
    timeDelay: number | null | undefined,
    prevContent: string,
    pacing?: IAgent['pacing'],
    // >0: the pause is the shorter inter-segment gap, not a reading pause.
    segmentIndex = 0,
    // false: use the deterministic default cadence.
    humanized = true,
): { preTypingDelayMs: number; typingDurationMs: number; interSegmentPauseMs: number | null } {
    const p = resolvePacing(pacing);

    // (1) Always one draw, so stream position doesn't depend on config. Gate on the mean
    // alone: gating on range too would let a default range revive a pause set to 0.
    const preRoll = rng();
    let preTypingDelayMs = 0;
    let interSegmentPauseMs: number | null = null;
    if (segmentIndex > 0) {
        interSegmentPauseMs = clamp(
            Math.round(INTER_SEGMENT_PAUSE_MS_MEAN + (preRoll * 2 - 1) * INTER_SEGMENT_PAUSE_MS_RANGE),
            0,
            5000,
        );
    } else if (p.preTypingDelayMsMean > 0) {
        const jitter = (preRoll * 2 - 1) * p.preTypingDelayMsRange; // uniform [-range, +range]
        preTypingDelayMs = clamp(Math.round(p.preTypingDelayMsMean + jitter), 0, 8000);
    }

    // (2) pacing.typingSpeed, else timeDelay (words/sec). 0 => Jones-2024.
    const wps = p.typingSpeed != null ? p.typingSpeed : (timeDelay ?? null);
    let typingDurationMs = 0;
    if (wps != null && wps != 0) {
        const numWord = content.trim().split(/\s+/).length;
        typingDurationMs = (numWord / wps) * 1000; // words/sec mode (no draw)
    } else if (wps === 0) {
        typingDurationMs = getResponseDelay(rng, content.length, prevContent?.length ?? 0) * 1000; // Jones-2024 (draws)
    }

    // (3) Jitter: x (1 + N(0, sigma)), clamped [0.4, 2.2].
    if (p.typingSpeedVariation > 0 && typingDurationMs > 0) {
        const factor = clamp(1 + normalRandom(rng, 0, p.typingSpeedVariation), 0.4, 2.2);
        typingDurationMs = Math.round(typingDurationMs * factor);
    }

    // Guards against negative or tiny rates. Must not bind in normal use, or it flattens the
    // jitter and makes split replies slower than unsplit ones.
    typingDurationMs = clamp(Math.round(typingDurationMs), 0, TYPING_DURATION_CEILING_MS);

    // Non-humanized: override with the default cadence. Not an early return, so the draws
    // above still happen and seeded streams stay aligned.
    if (!humanized) {
        const typing = clamp(
            Math.round((countWords(content) / DEFAULT_TYPE_WPS) * 1000),
            DEFAULT_TYPE_MIN_MS,
            DEFAULT_TYPE_MAX_MS,
        );
        if (segmentIndex > 0) {
            return { preTypingDelayMs: 0, typingDurationMs: typing, interSegmentPauseMs: DEFAULT_BEAT_MIN_MS };
        }
        // No previous message gives the minimum beat.
        const beat = clamp(
            Math.round((countWords(prevContent) / DEFAULT_READ_WPS) * 1000),
            DEFAULT_BEAT_MIN_MS,
            DEFAULT_BEAT_MAX_MS,
        );
        return { preTypingDelayMs: beat, typingDurationMs: typing, interSegmentPauseMs: null };
    }

    // No typing means an instant reply; a pause before it would be dead air.
    // Zeroed after the draws to keep stream alignment.
    if (typingDurationMs <= 0) {
        preTypingDelayMs = 0;
        interSegmentPauseMs = null;
    }

    return { preTypingDelayMs, typingDurationMs, interSegmentPauseMs };
}

// Pacing fields of one segment; the caller adds role and speaker and persists it.
export interface PacedSegment {
    content: string;
    prev_message: string;
    timeDelay: number | null;
    preTypingDelayMs: number | null;
    typingDurationMs: number | null;
    interSegmentPauseMs: number | null;
    segmentGroupId: string | null;
    segmentIndex: number | null;
    segmentCount: number | null;
}

// Split a reply and time each segment. `splitRng` is per turn; `timeRngFor(i)` is per emitted
// segment. A non-split reply leaves the segment fields null.
export function buildPacedSegments(input: {
    reply: string;
    prevContent: string;
    pacing?: IAgent['pacing'];
    timeDelay: number | null;
    splitRng: () => number;
    timeRngFor: (segmentIndex: number) => () => number;
    segmentGroupId: string; // only used when the reply splits
    // Optional replacement splitter. Must keep join('') === input.
    split?: (rng: () => number, text: string, pacing?: IAgent['pacing']) => string[];
    // false: default cadence.
    humanized?: boolean;
}): PacedSegment[] {
    const segments = (input.split ?? splitReply)(input.splitRng, input.reply, input.pacing);
    const isSplit = segments.length > 1;
    const groupId = isSplit ? input.segmentGroupId : null;
    const out: PacedSegment[] = [];
    let prev = input.prevContent;
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const env = computeTimingEnvelope(
            input.timeRngFor(segIdx),
            segments[segIdx],
            input.timeDelay,
            prev,
            input.pacing,
            segIdx,
            input.humanized ?? true,
        );
        out.push({
            content: segments[segIdx],
            prev_message: prev,
            timeDelay: input.timeDelay,
            preTypingDelayMs: env.preTypingDelayMs,
            typingDurationMs: env.typingDurationMs,
            interSegmentPauseMs: env.interSegmentPauseMs,
            segmentGroupId: groupId,
            segmentIndex: isSplit ? segIdx : null,
            segmentCount: isSplit ? segments.length : null,
        });
        prev = segments[segIdx];
    }
    return out;
}

// Round layout: puts all turns on one clock so agents' bubbles can interleave and typing can
// overlap. Only reorders existing segments, using its own stream (mixRngFor).

// Minimum gap between turn starts, so order stays deterministic.
const GAP_MIN_MS = 250;

// Kept structural (not StoredMsg) so this module needn't import groupChat.
export interface TimelineSegment {
    interSegmentPauseMs?: number | null;
    preTypingDelayMs?: number | null;
    typingDurationMs?: number | null;
    speakerId?: string;
}

// Returns all segments with `revealAtMs`, sorted (ties by generation order): the order the
// round is emitted and persisted in. Per turn, u = mixRngFor(t)() sets the overlap with the
// previous turn: u->0 no overlap, u->1 starts GAP_MIN_MS after it. Drawn for every turn so
// the stream stays aligned.
// `blind[t]` (default true): generated without seeing the other agent's turns, so it may
// interleave. An aware turn starts after every earlier turn ends, since it replies to them.
// A turn's own bubbles never reorder, and a speaker's turn never starts before its previous one ends.
export function layoutRoundTimeline<T extends TimelineSegment>(
    turns: T[][],
    mixRngFor: (turnIndex: number) => () => number,
    blind?: boolean[],
    // Soft duration ceiling (ms). Default-cadence rounds only; HD rounds should take human time.
    budgetMs?: number,
): (T & { revealAtMs: number })[] {
    const phase1 = (m: T): number => (m.interSegmentPauseMs ?? m.preTypingDelayMs ?? 0) || 0;
    const typing = (m: T): number => m.typingDurationMs || 0;

    const revealStart: number[] = [];
    const endOf: number[] = [];
    const lastEndBySpeaker: Record<string, number> = {};
    const flat: { seg: T & { revealAtMs: number }; gen: number }[] = [];
    let gen = 0;
    let maxEndSoFar = 0;

    for (let t = 0; t < turns.length; t++) {
        const segs = turns[t];
        // Drawn even when unused, to keep the stream aligned.
        const u = mixRngFor(t)();
        const isBlind = blind?.[t] ?? true;

        let start = 0;
        if (t > 0 && isBlind) {
            const prevStart = revealStart[t - 1] ?? 0;
            const durPrev = Math.max(0, (endOf[t - 1] ?? prevStart) - prevStart);
            // durPrev can be 0, so keep hi >= lo.
            const gap = clamp(GAP_MIN_MS + (1 - u) * (durPrev - GAP_MIN_MS), GAP_MIN_MS, Math.max(GAP_MIN_MS, durPrev));
            start = prevStart + gap;
        } else if (t > 0) {
            start = maxEndSoFar;
        }

        if (!segs || segs.length === 0) {
            // Defensive; empty turns shouldn't occur.
            revealStart[t] = start;
            endOf[t] = start;
            maxEndSoFar = Math.max(maxEndSoFar, start);
            continue;
        }

        const sp = segs[0].speakerId != null ? String(segs[0].speakerId) : '';
        start = Math.max(start, lastEndBySpeaker[sp] ?? 0);

        revealStart[t] = start;
        let cursor = start;
        for (const m of segs) {
            cursor += phase1(m) + typing(m);
            // Round only the emitted value so rounding doesn't accumulate.
            flat.push({ seg: { ...m, revealAtMs: Math.round(cursor) }, gen: gen++ });
        }
        endOf[t] = cursor;
        lastEndBySpeaker[sp] = cursor;
        maxEndSoFar = Math.max(maxEndSoFar, cursor);
    }

    // Over budget: scale the whole timeline uniformly, timing fields included so the client's
    // typing start stays in its gap and persisted values match the screen. Floored so typing stays visible.
    if (budgetMs && budgetMs > 0 && flat.length) {
        const lastReveal = flat.reduce((max, x) => Math.max(max, x.seg.revealAtMs), 0);
        if (lastReveal > budgetMs) {
            const factor = Math.max(MIN_ROUND_COMPRESSION, budgetMs / lastReveal);
            const scale = (v: number | null | undefined): number | null =>
                v == null ? (v as null) : Math.round(v * factor);
            for (const x of flat) {
                x.seg.revealAtMs = Math.round(x.seg.revealAtMs * factor);
                x.seg.typingDurationMs = scale(x.seg.typingDurationMs);
                x.seg.preTypingDelayMs = scale(x.seg.preTypingDelayMs);
                x.seg.interSegmentPauseMs = scale(x.seg.interSegmentPauseMs);
            }
        }
    }

    // Ties break by generation order.
    return flat
        .sort((a, b) => a.seg.revealAtMs - b.seg.revealAtMs || a.gen - b.gen)
        .map((x) => x.seg);
}

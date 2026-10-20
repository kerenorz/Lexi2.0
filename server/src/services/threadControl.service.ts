import { TurnTakingConfig } from '../types';

// Thread control: keeps agent-to-agent talk from drifting, since two models building on each
// other ("yes, and") wander off topic. Before each agent reply one seeded move adds a short note,
// and a guard closes degenerate rounds. Pure and seeded so studies replay exactly; no model decides.

import { CONTINUATION_OPENER, contentWords } from '../utils/contentWords';

export type Move = 'continue' | 'ground' | 'shift' | 'return' | 'close';

// Shown verbatim in the admin form. They never say whom to address: that is the researcher's
// manipulation. 'continue' and 'close' have no note.
export const MOVE_NOTES: Record<Exclude<Move, 'continue' | 'close'>, string> = {
    ground:
        'Keep this concrete: say something a real person in this setting would actually say, tied to a specific detail, rather than extending the previous idea further.',
    shift: 'Move the thread on to something else within the setting; do not build on the previous message.',
    return: 'Pick the thread back up from something said earlier in the conversation.',
};

export interface ResolvedThreadControl {
    enabled: boolean;
    ground: number;
    shift: number;
    return: number;
    close: number;
}

export const DEFAULT_CHANCES = { ground: 0.2, shift: 0.15, return: 0.05, close: 0.08 } as const;

// A finite number in [0, 1], else the default. 0 is valid ("never"), hence no truthiness test.
const chance = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;

/**
 * Chances summing over 1 are scaled down proportionally, keeping the researcher's ratios.
 * The form refuses such a save; this guards hand-edited documents.
 */
export const resolveThreadControl = (tt: TurnTakingConfig | undefined | null): ResolvedThreadControl => {
    const cfg = tt?.threadControl;
    if (cfg?.enabled !== true) {
        return { enabled: false, ground: 0, shift: 0, return: 0, close: 0 };
    }
    let ground = chance(cfg.groundChance, DEFAULT_CHANCES.ground);
    let shift = chance(cfg.shiftChance, DEFAULT_CHANCES.shift);
    let ret = chance(cfg.returnChance, DEFAULT_CHANCES.return);
    let close = chance(cfg.closeChance, DEFAULT_CHANCES.close);

    const total = ground + shift + ret + close;
    if (total > 1) {
        ground /= total;
        shift /= total;
        ret /= total;
        close /= total;
    }
    return { enabled: true, ground, shift, return: ret, close };
};

/** The researcher's scene, or undefined when they left it blank. */
export const resolveScene = (tt: TurnTakingConfig | undefined | null): string | undefined =>
    (typeof tt?.scene === 'string' ? tt.scene.trim() : '') || undefined;

/** Whether the anchored context window is on for this conversation. */
export const resolveMemoryWindow = (tt: TurnTakingConfig | undefined | null): boolean =>
    tt?.memoryWindow === true;

/**
 * Exactly one rng() call, whatever the outcome, so seeded runs stay in step.
 * Do not reorder the thresholds: that would re-map every recorded conversation.
 */
export const drawMove = (chances: ResolvedThreadControl, rng: () => number): Move => {
    const u = rng();
    let edge = chances.close;
    if (u < edge) return 'close';
    edge += chances.shift;
    if (u < edge) return 'shift';
    edge += chances.return;
    if (u < edge) return 'return';
    edge += chances.ground;
    if (u < edge) return 'ground';
    return 'continue';
};

// Degeneration guard: closes the round when the last few agent turns stopped being a conversation.
// Calibrated on real transcripts. Healthy rounds repeat words more than degenerate ones, so overlap
// alone can't separate them (0.5 would close one healthy round in four). Thresholds:
//   OVERLAP 0.70: near-copy chain, above every healthy window seen (max 0.64).
//   DISTINCT 0.40: near-verbatim repetition; last-resort backstop.
//   CONTINUATION 0.75: share of turns opening with "or / yeah / sure ...", the best separator.
// Known gap: varied but empty chatter isn't caught; the seeded moves handle that.
export const GUARD_WINDOW = 4;
export const GUARD_OVERLAP = 0.7;
export const GUARD_DISTINCT = 0.4;
export const GUARD_CONTINUATION = 0.75;
// A window containing a shorter turn ("yeah ok") never trips the guard.
export const GUARD_MIN_WORDS = 3;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * `recentAgentTurns`: the last agent-only logical turns, oldest first (a split turn is one
 * entry; participant turns skipped). Pure, so a guard close replays.
 */
export const isDegenerate = (recentAgentTurns: string[]): boolean => {
    if (recentAgentTurns.length < GUARD_WINDOW) return false;
    const turns = recentAgentTurns.slice(-GUARD_WINDOW);
    const words = turns.map(contentWords);
    if (words.some((w) => w.length < GUARD_MIN_WORDS)) return false;

    // 1. Word overlap of each turn with the one before.
    const overlaps: number[] = [];
    for (let i = 1; i < words.length; i++) {
        const previous = new Set(words[i - 1]);
        overlaps.push(words[i].filter((w) => previous.has(w)).length / words[i].length);
    }
    if (mean(overlaps) >= GUARD_OVERLAP) return true;

    // 2. Distinct bigrams across the window.
    const all = words.flat();
    const bigrams: string[] = [];
    for (let i = 1; i < all.length; i++) bigrams.push(`${all[i - 1]} ${all[i]}`);
    if (bigrams.length && new Set(bigrams).size / bigrams.length <= GUARD_DISTINCT) return true;

    // 3. Turns opening with a continuation marker.
    const continuations = turns.filter((t) => CONTINUATION_OPENER.test(t)).length;
    return continuations / turns.length >= GUARD_CONTINUATION;
};

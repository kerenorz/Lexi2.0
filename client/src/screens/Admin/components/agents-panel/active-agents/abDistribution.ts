// A/B split values for the AbAgents boxes, kept pure so it is testable without React.
// - distA is the authority: the server assigns arms from distA alone, so distB = 100 - distA.
// - Clamped to 0..100, which cannot change any assignment since the draw is in [0, 100).
// - Must not reset a saved split to 50/50 when the edit form opens.

export const DEFAULT_DIST_A = 50;

export type AbDistribution = { distA: number; distB: number };

/** A finite number (numeric strings count, as mongoose casts them), else null. */
const readPercent = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

/** Math.max also turns -0 into 0. */
const pairFromA = (distA: number): AbDistribution => {
    const a = Math.min(100, Math.max(0, distA));
    return { distA: a, distB: 100 - a };
};

/**
 * The split when the A/B section opens: the saved one, else 50/50.
 * Stored values are kept as is (no rounding), so saving never rewrites the study.
 */
export const initialAbDistribution = (abAgents: unknown): AbDistribution => {
    const stored = (abAgents && typeof abAgents === 'object' ? abAgents : {}) as {
        distA?: unknown;
        distB?: unknown;
    };
    const distA = readPercent(stored.distA);
    if (distA !== null) return pairFromA(distA);
    // Only distB (a hand-written document): complete from it.
    const distB = readPercent(stored.distB);
    if (distB !== null) return pairFromA(100 - distB);
    return pairFromA(DEFAULT_DIST_A);
};

/**
 * A typed value as a whole percent. Rounded because 100 - 64.1 is 35.900000000000006.
 * Blank (or a lone '-') is 0, matching what the controlled input displays.
 */
const typedPercent = (raw: string): number => {
    const n = readPercent(raw);
    return n === null ? 0 : Math.round(n);
};

export const distributionFromTypedA = (raw: string): AbDistribution => pairFromA(typedPercent(raw));

export const distributionFromTypedB = (raw: string): AbDistribution => pairFromA(100 - typedPercent(raw));

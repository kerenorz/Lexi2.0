// Time left on a key grant. Expiry fails silently until a participant hits it, so show it early.
// `now` is passed in to keep this deterministic.

/** Within this many days a grant is flagged as running out. */
export const EXPIRY_WARNING_DAYS = 7;

export interface GrantExpiry {
    /** Relative phrasing for a reader: "in 3 days", "within the hour", "expired". */
    label: string;
    /** Still live, but close enough that somebody should act. */
    soon: boolean;
    ended: boolean;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

export const describeGrantExpiry = (expiresAt: string | Date | undefined, now: Date): GrantExpiry => {
    if (!expiresAt) return { label: '', soon: false, ended: false };

    const remaining = new Date(expiresAt).getTime() - now.getTime();
    if (Number.isNaN(remaining)) return { label: '', soon: false, ended: false };
    if (remaining <= 0) return { label: 'expired', soon: false, ended: true };

    const hours = Math.floor(remaining / (60 * 60 * 1000));
    if (hours < 1) return { label: 'within the hour', soon: true, ended: false };
    if (hours < 24) return { label: `in ${plural(hours, 'hour')}`, soon: true, ended: false };

    // Floored: overstating time left could delay a renewal.
    const days = Math.floor(hours / 24);
    return { label: `in ${plural(days, 'day')}`, soon: days <= EXPIRY_WARNING_DAYS, ended: false };
};

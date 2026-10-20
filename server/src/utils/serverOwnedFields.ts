// Fields a client may not write, even on a document it owns. The admin update routes `$set`
// the whole client object, so without this a body could reassign ownerId or reset
// numberOfParticipants (the maxParticipants gate). Stripped rather than rejected, because
// the client round-trips the whole loaded document on every save.
const IDENTITY_AND_PROVENANCE = [
    '_id',
    'ownerId',
    // Admin lists sort on these.
    'createdAt',
    'timestamp',
    // Not on these schemas today; listed in case one is added.
    'updatedAt',
    '__v',
] as const;

export const SERVER_OWNED_FIELDS = {
    experiment: [
        ...IDENTITY_AND_PROVENANCE,
        // Live counters, maintained by `$inc` in the experiments service.
        'numberOfParticipants',
        'totalSessions',
        'openSessions',
        // Computed per request, never stored. Listed so a future schema field stays protected.
        'ownerUsername',
        'configIssue',
    ],
    agent: [...IDENTITY_AND_PROVENANCE],
    form: [...IDENTITY_AND_PROVENANCE],
} as const;

// Returns a copy: the controller may still read the original after the update.
export const stripServerOwned = <T extends object>(payload: T, fields: readonly string[]): Partial<T> => {
    // Non-object body: return empty and let the caller's matched-nothing path respond.
    if (!payload || typeof payload !== 'object') return {};
    const out: Partial<T> = { ...payload };
    for (const field of fields) delete out[field as keyof T];
    return out;
};

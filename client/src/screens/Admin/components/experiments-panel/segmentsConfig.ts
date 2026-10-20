// Survey-embedded studies, the non-UI half: parsing, save-blocking rules, and form-to-API
// normalization. Kept free of React so it can be tested without a DOM.

export interface SegmentQuotaRow {
    minUserMessages?: number | string | null;
    minSeconds?: number | string | null;
    maxUserMessages?: number | string | null;
    maxSeconds?: number | string | null;
}

export interface SegmentsFormValue {
    enabled?: boolean;
    count?: number | string | null;
    quotas?: SegmentQuotaRow[];
    endOfSegmentNotice?: string;
    defaultKnowledgeTemplates?: string[];
}

export interface SegmentsIssue {
    index?: number;
    field: 'count' | 'min' | 'max' | 'row' | 'notice';
    // Self-contained: also shown in the snackbar, with no row for context.
    message: string;
}

// undefined = the field is blank (inherit / no threshold); null = unparseable.
export const parseNumberInput = (raw: unknown): number | null | undefined => {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw).trim();
    if (text === '') return undefined;
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
};

// Bounds a positional list to the blocks that exist (quotas to count, templates to count - 1).
// Shown, validated and saved rows must match, or a hidden row can block the save. A blank
// count bounds nothing. The form value itself is untouched, so restoring the count restores rows.
export const liveRows = <T>(rows: T[], keep: number | null | undefined): T[] =>
    typeof keep === 'number' && keep >= 0 ? rows.slice(0, keep) : rows;

// Quotas are optional: with none, the host survey paces the study. The lower bounds catch
// values the server would honour badly (a ceiling of 0 behaves as 1; under 30s closes before
// the first reply), and the cap checks catch studies that run out of messages mid-way.
export const validateSegments = (
    value: SegmentsFormValue | undefined,
    maxMessages?: number | string | null,
): SegmentsIssue[] => {
    if (!value?.enabled) return [];
    const issues: SegmentsIssue[] = [];

    const count = parseNumberInput(value.count);
    if (count === null || count === undefined) {
        issues.push({ field: 'count', message: 'How many chat blocks does this study have?' });
    } else if (count < 1) {
        issues.push({
            field: 'count',
            message: 'A survey-embedded study needs at least one chat block.',
        });
    }
    // One block is a valid study (embedded chat between two questionnaires).

    const rows = liveRows(value.quotas ?? [], count);
    const perRow = rows.map((row) => ({
        minMsgs: parseNumberInput(row?.minUserMessages),
        minSecs: parseNumberInput(row?.minSeconds),
        maxMsgs: parseNumberInput(row?.maxUserMessages),
        maxSecs: parseNumberInput(row?.maxSeconds),
    }));

    let widestCeiling = 0;
    perRow.forEach(({ minMsgs, minSecs, maxMsgs, maxSecs }, index) => {
        const block = index + 1;

        for (const [parsed, field, label] of [
            [minMsgs, 'min', 'minimum messages'],
            [minSecs, 'min', 'minimum seconds'],
            [maxMsgs, 'max', 'maximum messages'],
            [maxSecs, 'max', 'maximum seconds'],
        ] as const) {
            if (parsed === null) {
                issues.push({ index, field, message: `Block ${block}: the ${label} must be a whole number.` });
            }
        }

        if (typeof maxMsgs === 'number') {
            if (maxMsgs < 1) {
                issues.push({
                    index,
                    field: 'max',
                    message: `Block ${block}: a maximum of 0 messages closes the block after the participant's first message. Use 1 or more.`,
                });
            }
            widestCeiling = Math.max(widestCeiling, maxMsgs);
        }
        if (typeof maxSecs === 'number' && maxSecs < 30) {
            issues.push({
                index,
                field: 'max',
                message: `Block ${block}: a time limit under 30 seconds can close the block before the agents finish their first reply.`,
            });
        }
        if (typeof minMsgs === 'number' && typeof maxMsgs === 'number' && minMsgs > maxMsgs) {
            issues.push({
                index,
                field: 'row',
                message: `Block ${block}: the minimum (${minMsgs}) is above the maximum (${maxMsgs}), so the participant could never continue.`,
            });
        }
        if (typeof minSecs === 'number' && typeof maxSecs === 'number' && minSecs > maxSecs) {
            issues.push({
                index,
                field: 'row',
                message: `Block ${block}: the minimum time is above the maximum, so the participant could never continue.`,
            });
        }
    });

    // A message floor without a time ceiling traps a participant who stops replying: Next never
    // appears. Judged on the resolved quota, mirroring server quotaForSegment (blanks inherit
    // from the row above, later blocks keep the last row).
    const blocks = typeof count === 'number' && count > 0 ? count : rows.length;
    const resolved: { minMsgs?: number; minSecs?: number; maxMsgs?: number; maxSecs?: number } = {};
    let strandedAbove = false;
    for (let block = 1; block <= blocks; block++) {
        const row = perRow[block - 1];
        if (row) {
            if (typeof row.minMsgs === 'number') resolved.minMsgs = row.minMsgs;
            if (typeof row.minSecs === 'number') resolved.minSecs = row.minSecs;
            if (typeof row.maxMsgs === 'number') resolved.maxMsgs = row.maxMsgs;
            if (typeof row.maxSecs === 'number') resolved.maxSecs = row.maxSecs;
        }
        const stranded =
            typeof resolved.minMsgs === 'number' && resolved.minMsgs > 0 && typeof resolved.maxSecs !== 'number';
        // Reported once, on the block where it starts: that row is the one to fix.
        if (stranded && !strandedAbove) {
            issues.push({
                index: block - 1,
                field: 'min',
                message: `Block ${block}: a minimum number of messages needs a time limit alongside it. A participant who stops replying never reaches the minimum, so your survey's Next button would never appear for them.`,
            });
        }
        strandedAbove = stranded;
    }

    // maxMessages is per conversation, so blocks that need more than the cap get stuck mid-block.
    const cap = parseNumberInput(maxMessages);
    if (typeof cap === 'number' && cap > 0 && typeof count === 'number' && count > 0) {
        if (widestCeiling > 0) {
            // Same worst-case formula as the server's validateSegmentsConfig, so the form never
            // accepts what the API rejects.
            const needed = count * widestCeiling;
            if (cap < needed) {
                issues.push({
                    field: 'count',
                    message: `This study allows ${cap} messages per conversation but ${count} blocks of up to ${widestCeiling} need ${needed}. A participant would hit the cap mid-study and be unable to continue.`,
                });
            }
        } else if (cap < count) {
            // No ceilings: require at least one round per block. Anything more is a research choice.
            issues.push({
                field: 'count',
                message: `This study allows ${cap} messages per conversation but has ${count} chat blocks. A participant could spend the whole cap inside the first block, and the later blocks would have no messages left for them.`,
            });
        }
    }

    return issues;
};

export const normalizeQuota = (row: SegmentQuotaRow): SegmentQuotaRow => {
    // Blank keys are dropped, not null: the server reads an absent threshold as "no limit".
    const out: SegmentQuotaRow = {};
    const min = parseNumberInput(row?.minUserMessages);
    const minS = parseNumberInput(row?.minSeconds);
    const max = parseNumberInput(row?.maxUserMessages);
    const maxS = parseNumberInput(row?.maxSeconds);
    if (typeof min === 'number') out.minUserMessages = min;
    if (typeof minS === 'number') out.minSeconds = minS;
    if (typeof max === 'number') out.maxUserMessages = max;
    if (typeof maxS === 'number') out.maxSeconds = maxS;
    return out;
};

// undefined when disabled, so the caller can drop the key instead of saving an empty object.
export const normalizeSegments = (value: SegmentsFormValue | undefined): SegmentsFormValue | undefined => {
    if (!value?.enabled) return undefined;
    const count = parseNumberInput(value.count);
    const quotas = liveRows(value.quotas ?? [], count).map(normalizeQuota);
    while (quotas.length && !Object.keys(quotas[quotas.length - 1]).length) quotas.pop();

    const notice = (value.endOfSegmentNotice || '').trim();
    // One template per break between blocks: count - 1.
    const templates = liveRows(
        value.defaultKnowledgeTemplates ?? [],
        typeof count === 'number' ? Math.max(0, count - 1) : undefined,
    ).map((t) => (t || '').trim());
    while (templates.length && !templates[templates.length - 1]) templates.pop();

    return {
        enabled: true,
        ...(typeof count === 'number' ? { count } : {}),
        ...(quotas.length ? { quotas } : {}),
        ...(notice ? { endOfSegmentNotice: notice } : {}),
        ...(templates.length ? { defaultKnowledgeTemplates: templates } : {}),
    };
};

// Content-word tokenizer for the degeneration guard. Must stay identical to
// server/tools/drift-metric.js, which measures the same signal offline.
// Stop words are function words plus chat fillers, so turns don't match just for being English.

export const STOP_WORDS = new Set(
    (
        'a an the and or but so if then than that this these those it its i you he she we they them me my your our ' +
        'his her their of to in on at for from with by as is are was were be been being do does did have has had not no yes ' +
        'what which who whom whose when where why how all any both each few more most other some such only own same too very ' +
        'can could would should will just really actually even also still like about into over out up down off again there here ' +
        'now way thing things something anything everything nothing one two get got go going gonna kind sort lot bit much many ' +
        'im ive dont doesnt didnt cant wont isnt arent thats theres youre were theyre lets ok okay hey hi oh yeah yep sure mm mmm ' +
        'anyway maybe probably pretty though right back next last first make makes made take takes took keep keeps kept let ' +
        'say says said tell told think thought know knew feel felt want wanted need needed see seen look looks looking come came'
    ).split(/\s+/),
);

// Unicode-aware (`\p{L}`) so non-Latin text such as Hebrew tokenizes.
export const contentWords = (text: string | null | undefined): string[] =>
    (text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .split(/\s+/)
        .map((w) => w.replace(/'s$/, ''))
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

// A reply that opens by continuing the previous one, which drives threads off topic.
// Must match drift-metric.js's CONT.
export const CONTINUATION_OPENER =
    /^\s*(or\b|yeah\b|yep\b|sure\b|mm\b|mmm\b|anyway\b|that\b|those\b|then\b|and\b|plus\b|also\b)/i;

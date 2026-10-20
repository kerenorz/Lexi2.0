// Does this text name this person? One shared rule for the mention handover, the llm moderator
// and the `Addressed Participant %` export, so the export matches what the runtime did.
// Not `\b`: it is ASCII-only and never matches a Hebrew name.

// Word character in any script (what `\b` should have meant).
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';

// One Hebrew prefix letter (ו ה ל ב כ מ ש) may attach to the name, as in "לדנה". Only one:
// two would find רון inside "הברון".
const HEBREW_PREFIX = '[והלבכמש]';

// A one-letter name would match stray letters in any text. Short names are excluded from
// mention detection only; the agent still takes turns.
export const MIN_ADDRESSABLE_NAME_LEN = 2;

// Escapes only SyntaxCharacters, so the result stays valid under the `u` flag.
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The compiled test, or null when the name is too short to be addressable.
export const nameMentionPattern = (name?: string | null): RegExp | null => {
    const trimmed = (name || '').trim();
    if (trimmed.length < MIN_ADDRESSABLE_NAME_LEN) return null;
    return new RegExp(`(?<!${WORD_CHAR})(?:${HEBREW_PREFIX})?${escapeRegExp(trimmed)}(?!${WORD_CHAR})`, 'iu');
};

// Compiled once per name. A too-short name yields an always-false test.
export const nameMentionTest = (name?: string | null): ((text: string) => boolean) => {
    const pattern = nameMentionPattern(name);
    if (!pattern) return () => false;
    return (text: string) => !!text && pattern.test(text);
};

export const mentionsName = (text: string, name?: string | null): boolean => nameMentionTest(name)(text);

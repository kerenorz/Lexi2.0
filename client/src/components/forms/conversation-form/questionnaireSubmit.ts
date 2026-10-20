// Save questionnaire answers before moving the participant on, so a failed save can't hide lost answers.

// String tag, not a boolean: with `strict: false` a boolean discriminant doesn't narrow the union.
export type QuestionnaireSubmitOutcome = { status: 'saved' } | { status: 'failed'; error: unknown };

/** A failed save is returned, not thrown, and skips `onSaved`, so the form stays up for a retry. */
export const submitQuestionnaire = async ({
    save,
    onSaved,
}: {
    save: () => Promise<unknown>;
    onSaved: () => void;
}): Promise<QuestionnaireSubmitOutcome> => {
    try {
        await save();
    } catch (error) {
        return { status: 'failed', error };
    }
    // Outside the try: the answers are saved, so an onSaved error must not read as a save failure.
    onSaved();
    return { status: 'saved' };
};

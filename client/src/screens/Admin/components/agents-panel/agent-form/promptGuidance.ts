// Researcher-facing guidance under the agent form's prompt fields. Deliberately narrow, not a
// prompting guide. No model names: they go stale within months.

export interface PromptGuidanceParagraph {
    /** Bolded lead-in, or undefined for the opening paragraph which needs no label. */
    lead?: string;
    body: string;
}

export const PROMPT_GUIDANCE: PromptGuidanceParagraph[] = [
    {
        body:
            'The prompt decides how this agent behaves, more than any other setting on this page. ' +
            'Write concrete instructions — "reply in one or two short sentences", "never open with ' +
            "someone's name\" — rather than adjectives like \"be casual\". Specific instructions get " +
            'followed; descriptions get interpreted.',
    },
    {
        lead: 'The same prompt behaves differently on different models.',
        body:
            'A prompt that produces exactly the behaviour you want on one model can be followed only ' +
            'partly on another, or ignored at its most demanding points. Changing the model is not just ' +
            'a cost decision — it changes your results, so re-test after any model change.',
    },
    {
        lead: 'Pilot it before you go live.',
        body: 'Run the conversation yourself, read the whole transcript, adjust the prompt, and run it again.',
    },
];

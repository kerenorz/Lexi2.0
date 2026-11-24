// Context a researcher can switch on per experiment (Experiment Features), added to each 1-1 turn
// before it goes to the model. Off by default, so existing studies send exactly what they did.

// Studies run in Israel; the model has no clock of its own.
export const TURN_CONTEXT_TIME_ZONE = 'Asia/Jerusalem';

// A system line with the current date and time, e.g. "Tuesday, 24 November 2026, 14:05 (Israel time)".
// It sits next to the agent's prompt, so the participant never sees it; the model uses it only when the
// question needs it ("when does Shabbat start", "what day is it").
export const todaysDateLine = (now: Date = new Date()): string => {
    const date = new Intl.DateTimeFormat('en-GB', {
        timeZone: TURN_CONTEXT_TIME_ZONE,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(now);
    const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: TURN_CONTEXT_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(now);
    return (
        `Current date and time: ${date}, ${time} (Israel time). ` +
        'Use it to understand questions about today, this week or upcoming dates; do not mention it unless it is relevant.'
    );
};

export interface TurnContextFeatures {
    todaysDate?: boolean;
    webSearch?: boolean;
}

// Adds the switched-on context to a chat request built by getChatRequest. The date goes in as a
// system message right after the agent's prompt; web search is a flag the provider layer turns into
// its own search tool (see llmProviders.service).
export const applyTurnContext = <R extends { messages: any[] }>(
    chatRequest: R,
    features: TurnContextFeatures | null | undefined,
    now: Date = new Date(),
): R & { webSearch?: boolean } => {
    if (!features) return chatRequest;
    const out: any = { ...chatRequest, messages: [...chatRequest.messages] };
    if (features.todaysDate) {
        const firstNonSystem = out.messages.findIndex((m: any) => m.role !== 'system');
        const at = firstNonSystem === -1 ? out.messages.length : firstNonSystem;
        out.messages.splice(at, 0, { role: 'system', content: todaysDateLine(now) });
    }
    if (features.webSearch) out.webSearch = true;
    return out;
};

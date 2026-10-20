import Anthropic from '@anthropic-ai/sdk';
import { IAgent, IUser, LLMProvider, TurnTakingConfig } from '../types';
import { anthropicSamplingFor, COMPLETION_CLIENT_OPTIONS, createChatCompletion, geminiCompletion, geminiMaxOutputTokens, isAnthropicDefaultThinking, isGrokReasoning, isOpenAIResponsesOnly, isOpenAIRestricted, makeOpenAIClient, mergeConsecutiveMessages, openAIResponsesCompletion, openRouterBody, openRouterKeepsSystemInPlace, PART_CARRIES_TEXT, REASONING_OUTPUT_FLOOR, responsesParamsFromChat, runProvider, trackStreamEmission, watchStream, withRetry } from './llmProviders.service';
import { makeRng, mulberry32 } from '../utils/seededRandom';
import { escapeRegExp, mentionsName } from '../utils/nameMention';
import {
    drawMove,
    isDegenerate,
    GUARD_WINDOW,
    Move,
    MOVE_NOTES,
    ResolvedThreadControl,
} from './threadControl.service';
import {
    isHumanized,
    isSplitEnabled,
    resolveTypingDelay,
    NO_OP_PACING,
    buildPacedSegments,
    layoutRoundTimeline,
    DEFAULT_ROUND_BUDGET_MS,
} from './pacing.service';

// Group chat: prompt building, speaker selection and round orchestration.

export type StoredMsg = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    speakerId?: string;
    speakerName?: string;
    timeDelay?: number | null;
    prev_message?: string | null;
    // Server-authoritative per-turn timing.
    preTypingDelayMs?: number | null;
    typingDurationMs?: number | null;
    interSegmentPauseMs?: number | null;
    segmentGroupId?: string | null;
    segmentIndex?: number | null;
    segmentCount?: number | null;
    // Round-relative ms when the client reveals this bubble. Set by layoutRoundTimeline.
    revealAtMs?: number | null;
    // Rendered without a "Name: " prefix. Only the window's elision placeholder sets it.
    unattributed?: boolean;
    // Thread-control move that steered this turn. Absent when off or 'continue'.
    move?: string | null;
};

export interface GroupBuildInput {
    targetAgent: IAgent;
    history: StoredMsg[];
    allAgents: IAgent[];
    participantLabel: string;
    // Name the human participant in the preamble (experiment opt-in). Default false.
    identifyHuman?: boolean;
    // beforePrompt joins the system block; afterPrompt is a trailing system message.
    beforePrompt?: string;
    afterPrompt?: string;
    // Goes in the tail block, because a phase prompt replaces the system block.
    scene?: string;
    // Thread-control note for this turn. Always the last line of context.
    tailNote?: string;
    // Bound the transcript the agent sees (see selectWindowed).
    memoryWindow?: boolean;
}

export interface CanonicalRequest {
    system: string;
    // 'system' only as the trailing afterPrompt; providers that can't place it hoist it.
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
}

const chatName = (agent: IAgent): string => agent.displayName || agent.title;

const humanJoin = (names: string[]): string => {
    if (names.length <= 1) return names[0] || '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

// Names only, never "AI"/"bot"/"agent" or role labels, so a prompt leak doesn't break the
// illusion. identifyHuman adds one sentence naming the human participant.
export const buildGroupPreamble = (
    target: IAgent,
    allAgents: IAgent[],
    participantLabel: string,
    identifyHuman = false,
): string => {
    const name = chatName(target);
    const others = [
        participantLabel,
        ...allAgents.filter((a) => String(a._id) !== String(target._id)).map(chatName),
    ];

    const humanLine = identifyHuman ? `${participantLabel} is the human participant in this conversation. ` : '';

    return (
        `You are ${name}. You're in a conversation with ${humanJoin(others)}. Each message is labeled with ` +
        `the speaker's name. ${humanLine}Reply only as ${name}, in your own voice. Write ONLY the words you ` +
        `say: never begin your message with a speaker label of any kind — not your own name, and not anyone ` +
        `else's. Stay in character.`
    );
};

// Labels a reply might wrongly open with: all roster names plus the participant's.
export const buildSpeakerLabels = (agents: IAgent[], participantLabel: string): string[] =>
    [...agents.map(chatName), participantLabel].map((n) => (n || '').trim()).filter(Boolean);

// Removes leading "<Speaker>:" labels that models copy from the transcript format.
// Loops for doubled prefixes; anchored at ^ with a colon, so mid-sentence names are safe.
export const stripSpeakerPrefix = (text: string, labels: string[]): string => {
    if (!text) return text;
    let out = text;
    for (let guard = 0; guard < 4; guard++) {
        const before = out;
        for (const label of labels) {
            const re = new RegExp(`^\\s*${escapeRegExp(label)}\\s*:\\s*`, 'i');
            if (re.test(out)) {
                out = out.replace(re, '');
                break;
            }
        }
        if (out === before) break;
    }
    return out;
};

// Streaming version: holds back the head until a prefix can be ruled out, then passes through.
export const createPrefixStripper = (labels: string[]) => {
    const maxHold = labels.reduce((m, l) => Math.max(m, l.length), 0) + 8;
    let head = '';
    let passthrough = false;
    let stripped = false;

    const release = (): string => {
        passthrough = true;
        const out = stripSpeakerPrefix(head, labels);
        if (out !== head) stripped = true;
        head = '';
        return out;
    };

    return {
        push(chunk: string): string {
            if (passthrough) return chunk;
            head += chunk;
            // A newline means the first line is complete.
            if (head.length < maxHold && !head.includes('\n')) return '';
            return release();
        },
        // Stream ended while still holding (a reply shorter than maxHold).
        flush(): string {
            return passthrough ? '' : release();
        },
        // True once a label was removed.
        didStrip: (): boolean => stripped,
    };
};

// Log each strip so a model ignoring the prompt is visible, not silently repaired.
const warnLabelStripped = (agentName: string, sample: string): void => {
    console.warn(
        `[group] stripped a speaker label from ${agentName}'s reply: ${JSON.stringify(sample.slice(0, 40))} — ` +
            `the model is copying the transcript's "Name:" format.`,
    );
};

const nonBlank = (s?: string): s is string => typeof s === 'string' && s.trim() !== '';

// Long transcripts fuel drift, so agents see the first HEAD, every participant message and the
// last WINDOW. Selection only, no summary, so context is reproducible from the database.
export const HEAD = 6;
export const WINDOW = 30;
const ELISION = '(earlier messages not shown)';

// Each dropped run becomes one placeholder. A split turn is kept or dropped whole.
export const selectWindowed = (msgs: StoredMsg[]): StoredMsg[] => {
    if (msgs.length <= HEAD + WINDOW) return msgs;

    const keep = msgs.map(
        (m, i) => i < HEAD || i >= msgs.length - WINDOW || m.role === 'user',
    );
    const keptGroups = new Set(
        msgs.filter((m, i) => keep[i] && m.segmentGroupId).map((m) => m.segmentGroupId as string),
    );
    for (let i = 0; i < msgs.length; i++) {
        if (!keep[i] && msgs[i].segmentGroupId && keptGroups.has(msgs[i].segmentGroupId as string)) {
            keep[i] = true;
        }
    }

    const out: StoredMsg[] = [];
    let dropping = false;
    for (let i = 0; i < msgs.length; i++) {
        if (keep[i]) {
            out.push(msgs[i]);
            dropping = false;
        } else if (!dropping) {
            out.push({ role: 'user', content: ELISION, unattributed: true });
            dropping = true;
        }
    }
    return out;
};

export const buildGroupRequest = (input: GroupBuildInput): CanonicalRequest => {
    const { targetAgent, history, allAgents, participantLabel, identifyHuman, beforePrompt, afterPrompt, scene, tailNote, memoryWindow } = input;
    const targetId = String(targetAgent._id);

    const system = [
        targetAgent.systemStarterPrompt,
        buildGroupPreamble(targetAgent, allAgents, participantLabel, identifyHuman),
        beforePrompt,
    ]
        .filter(Boolean)
        .join('\n\n');

    // Filter before windowing so the counts are of messages the agent actually sees.
    const visible = history.filter((m) => m.role !== 'system' && m.content && m.content.trim());
    const messages: CanonicalRequest['messages'] = (memoryWindow ? selectWindowed(visible) : visible).map((m) => {
        const isTarget = m.role === 'assistant' && m.speakerId != null && String(m.speakerId) === targetId;
        if (isTarget) {
            // Own turns: raw, no prefix.
            return { role: 'assistant' as const, content: m.content };
        }
        // Elision placeholder: no name, or an agent would answer it as if someone said it.
        if (m.unattributed) return { role: 'user' as const, content: m.content };
        // Others: name-prefixed user turns, so attribution survives provider-side merging.
        const name = m.role === 'user' ? participantLabel : m.speakerName || 'Unknown';
        return { role: 'user' as const, content: `${name}: ${m.content}` };
    });

    // Tail block: read last, since the system block fades in long chats and phases replace it.
    // Fixed order: after-prompt, setting, move note.
    const tail = [afterPrompt, scene ? `Setting: ${scene}` : undefined, tailNote].filter(nonBlank).join('\n\n');
    if (tail) {
        messages.push({ role: 'system', content: tail });
    }

    return { system, messages };
};

// Splits off the tail block (a trailing system turn), which each provider places differently.
const splitTail = (messages: CanonicalRequest['messages']): { body: CanonicalRequest['messages']; tail?: string } => {
    const last = messages[messages.length - 1];
    if (last?.role !== 'system') return { body: messages };
    return { body: messages.slice(0, -1), tail: last.content };
};

// Pure per-provider payload builders. Each emits only fields its API accepts.

export const toOpenAIPayload = (req: CanonicalRequest, agent: IAgent) => {
    const restricted = isOpenAIRestricted(agent.model);
    const grok = isGrokReasoning(agent.model);

    const params: any = {
        model: agent.model,
        // Only {role, content}; stray stored fields must not reach the API.
        messages: [
            { role: 'system', content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
    };

    // gpt-5 and o-series reject 'max_tokens'. Reasoning models get the floor for headroom.
    if (restricted || grok) {
        params.max_completion_tokens = REASONING_OUTPUT_FLOOR;
    } else if (agent.maxTokens != null) {
        params.max_completion_tokens = agent.maxTokens;
    }
    // Restricted models reject non-default sampling. Grok-4 rejects penalties and stop.
    if (!restricted) {
        if (agent.temperature != null) params.temperature = agent.temperature;
        if (agent.topP != null) params.top_p = agent.topP;
        if (!grok) {
            if (agent.frequencyPenalty != null) params.frequency_penalty = agent.frequencyPenalty;
            if (agent.presencePenalty != null) params.presence_penalty = agent.presencePenalty;
            if (agent.stopSequences?.length) params.stop = agent.stopSequences;
        }
    }

    return params;
};

// Responses-only OpenAI models: the same chat body, converted for the Responses API.
export const toOpenAIResponsesPayload = (req: CanonicalRequest, agent: IAgent) => responsesParamsFromChat(toOpenAIPayload(req, agent));

export const toAnthropicPayload = (req: CanonicalRequest, agent: IAgent) => {
    const { system, messages } = hoistedMessages(req);

    const params: any = {
        model: agent.model,
        // Default-thinking models get the floor so the reply has room.
        max_tokens: isAnthropicDefaultThinking(agent.model)
            ? REASONING_OUTPUT_FLOOR
            : (agent.maxTokens ?? 1024),
        messages,
    };

    if (system) params.system = system;
    // Temperature or top_p, never both. See anthropicSamplingFor.
    Object.assign(params, anthropicSamplingFor(agent.model, agent.temperature, agent.topP));
    if (agent.stopSequences?.length) params.stop_sequences = agent.stopSequences;

    return params;
};

// Anthropic shape (also for non-OpenAI OpenRouter models): one system text, alternating turns.
const hoistedMessages = (req: CanonicalRequest): { system: string; messages: { role: 'user' | 'assistant'; content: string }[] } => {
    // The tail goes on the last user turn, not into system, so every provider reads it last.
    const { body, tail } = splitTail(req.messages);
    const inlineSystem = body.filter((m) => m.role === 'system').map((m) => m.content);
    const system = [req.system, ...inlineSystem].filter(Boolean).join('\n');

    // Name prefixes are in the content, so attribution survives the merge.
    const messages = mergeConsecutiveMessages(body.filter((m) => m.role !== 'system'));

    // Anthropic requires the first message to be 'user'.
    while (messages.length > 0 && messages[0].role === 'assistant') {
        messages.shift();
    }

    if (tail) {
        // Safe to mutate: mergeConsecutiveMessages returns fresh objects.
        const last = messages[messages.length - 1];
        if (last && last.role === 'user') last.content += `\n\n${tail}`;
        // A trailing assistant turn would prefill the reply, so the tail gets its own user turn.
        else messages.push({ role: 'user', content: tail });
    }

    return { system, messages };
};

// OpenRouter: sampling/routing from openRouterBody (shared with 1-1). Messages follow the
// model's maker. A trailing assistant turn gets a "(continue)" user turn to avoid a prefill.
export const toOpenRouterPayload = (req: CanonicalRequest, agent: IAgent) => {
    let messages: { role: string; content: string }[];
    if (openRouterKeepsSystemInPlace(agent.model)) {
        messages = [{ role: 'system', content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))];
    } else {
        const hoisted = hoistedMessages(req);
        const turns: { role: string; content: string }[] = [...hoisted.messages];
        if (turns.length === 0 || turns[turns.length - 1].role === 'assistant') {
            turns.push({ role: 'user', content: '(continue)' });
        }
        messages = hoisted.system ? [{ role: 'system', content: hoisted.system }, ...turns] : turns;
    }

    return {
        model: agent.model,
        messages,
        ...openRouterBody(agent.model, {
            temperature: agent.temperature,
            top_p: agent.topP,
            frequency_penalty: agent.frequencyPenalty,
            presence_penalty: agent.presencePenalty,
            stop: agent.stopSequences,
            max_tokens: agent.maxTokens,
        }),
    };
};

export const toGooglePayload = (req: CanonicalRequest, agent: IAgent) => {
    // Same tail rule as Anthropic: on the final user turn, not in systemInstruction.
    const { body, tail } = splitTail(req.messages);
    const inlineSystem = body.filter((m) => m.role === 'system').map((m) => m.content);
    const systemInstruction = [req.system, ...inlineSystem].filter(Boolean).join('\n');

    // Gemini expects alternating roles.
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = mergeConsecutiveMessages(
        body.filter((m) => m.role !== 'system'),
    ).map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    // First turn must be 'user': prepend an opener rather than drop content.
    if (contents.length > 0 && contents[0].role === 'model') {
        contents.unshift({ role: 'user', parts: [{ text: '(conversation begins)' }] });
    }

    // If the agent spoke last, add a trigger rather than drop trailing turns.
    if (contents.length === 0 || contents[contents.length - 1].role === 'model') {
        contents.push({ role: 'user', parts: [{ text: '(continue)' }] });
    }

    // The last turn is always a user turn here.
    if (tail) {
        const last = contents[contents.length - 1];
        last.parts = [{ text: `${last.parts[0].text}\n\n${tail}` }];
    }

    const generationConfig: any = {};
    if (agent.temperature != null) generationConfig.temperature = agent.temperature;
    if (agent.topP != null) generationConfig.topP = agent.topP;
    // Always set, with a thinking floor, or thinking models can return an empty reply.
    generationConfig.maxOutputTokens = geminiMaxOutputTokens(agent.model, agent.maxTokens ?? 2048);

    const payload: any = {
        model: agent.model,
        // History is everything except the turn being sent.
        history: contents.slice(0, -1),
        sendMessage: contents[contents.length - 1].parts[0].text,
        generationConfig,
    };
    if (systemInstruction) payload.systemInstruction = systemInstruction;

    return payload;
};

// Group completion. Reuses runProvider/withRetry but not the single-agent *ChatCompletion.

export async function createGroupChatCompletion(
    apiKey: string,
    provider: LLMProvider,
    targetAgent: IAgent,
    history: StoredMsg[],
    allAgents: IAgent[],
    participantLabel: string,
    identifyHuman = false,
    stream = false,
    onStreamChunk?: (chunk: string) => Promise<void>,
    // Optional and last, since callers pass args positionally. tailNote is set per turn.
    scene?: string,
    tailNote?: string,
    memoryWindow = false,
): Promise<string> {
    const req = buildGroupRequest({
        targetAgent,
        history,
        allAgents,
        participantLabel,
        identifyHuman,
        beforePrompt: targetAgent.beforeUserSentencePrompt,
        afterPrompt: targetAgent.afterUserSentencePrompt,
        scene,
        tailNote,
        memoryWindow,
    });

    // A stream that already emitted text is never retried, or the turn would be saved twice.
    const emission = trackStreamEmission(onStreamChunk);

    switch (provider) {
        case 'openai':
        case 'xai':
        case 'openrouter': {
            if (provider === 'openai' && isOpenAIResponsesOnly(targetAgent.model)) {
                return openAIResponsesCompletion(apiKey, toOpenAIResponsesPayload(req, targetAgent), stream, emission);
            }
            const params = provider === 'openrouter' ? toOpenRouterPayload(req, targetAgent) : toOpenAIPayload(req, targetAgent);
            const client = makeOpenAIClient(apiKey, provider);

            return runProvider(provider, () => withRetry(async () => {
                if (!stream) {
                    const response = await client.chat.completions.create(params);
                    return response.choices[0].message.content?.trim() || '';
                }

                // A stream that goes quiet fails as a timeout, not as a shorter finished turn.
                return watchStream(async (watch) => {
                    const responseStream = (await client.chat.completions.create({ ...params, stream: true }, { signal: watch.signal })) as any;
                    let full = '';
                    for await (const part of watch.parts<any>(responseStream, PART_CARRIES_TEXT.openai)) {
                        const chunk = part.choices[0]?.delta?.content || '';
                        await emission.forward(chunk);
                        full += chunk;
                    }
                    return full;
                });
            }, undefined, emission.canRetry));
        }
        case 'anthropic': {
            const params = toAnthropicPayload(req, targetAgent);
            const client = new Anthropic({ apiKey, ...COMPLETION_CLIENT_OPTIONS });

            return runProvider('anthropic', () => withRetry(async () => {
                if (!stream) {
                    const response = await client.messages.create(params);
                    const textBlock = response.content.find((b: any) => b.type === 'text') as any;
                    return textBlock?.text?.trim() || '';
                }

                return watchStream(async (watch) => {
                    const responseStream = client.messages.stream(params, { signal: watch.signal });
                    let full = '';
                    for await (const event of watch.parts(responseStream, PART_CARRIES_TEXT.anthropic)) {
                        if (event.type === 'content_block_delta' && (event.delta as any)?.text) {
                            const text = (event.delta as any).text;
                            await emission.forward(text);
                            full += text;
                        }
                    }
                    return full;
                });
            }, undefined, emission.canRetry));
        }
        case 'google': {
            const payload = toGooglePayload(req, targetAgent);
            // Streams are bounded by the watchdog, not a request deadline.
            return geminiCompletion(
                apiKey,
                {
                    model: payload.model,
                    systemInstruction: payload.systemInstruction,
                    history: payload.history,
                    message: payload.sendMessage,
                    generationConfig: payload.generationConfig,
                },
                stream,
                emission,
            );
        }
    }
}

// Moderator completion for the llm turn-taking policy. Gemini needs the output floor,
// or a thinking model spends the tiny budget on reasoning and returns empty.
export async function createModeratorCompletion(
    apiKey: string,
    provider: LLMProvider,
    model: string,
    system: string,
    transcript: string,
): Promise<string> {
    if (provider === 'google') {
        // Buffered, so the provider timeout applies.
        return geminiCompletion(
            apiKey,
            {
                model,
                systemInstruction: system,
                history: [],
                message: transcript,
                generationConfig: { temperature: 0, maxOutputTokens: geminiMaxOutputTokens(model, 64) },
            },
            false,
            trackStreamEmission(),
        );
    }

    // The shared bodies already apply the reasoning floor.
    return createChatCompletion(
        apiKey,
        provider,
        {
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: transcript },
            ],
            max_tokens: 64,
            temperature: 0,
        },
        false,
    );
}

// Turn-taking orchestration.

export type ModeratorFn = (system: string, transcriptText: string) => Promise<string>;

// The moderator's view: name-prefixed lines.
const renderTranscript = (working: StoredMsg[], participantLabel: string): string =>
    working
        .filter((m) => m.role !== 'system' && m.content && m.content.trim())
        .map((m) => `${m.role === 'user' ? participantLabel : m.speakerName || 'Unknown'}: ${m.content}`)
        .join('\n');

// The one other agent the last agent turn named, if it asked a question ('?' anywhere).
// Agents name each other constantly, so mention alone would override the policy every turn.
const findAddressedAgent = (
    lastMsg: StoredMsg | undefined,
    agents: IAgent[],
    lastSpeaker: string | null,
): IAgent | null => {
    if (!lastMsg || lastMsg.role !== 'assistant') return null;
    const text = lastMsg.content || '';
    if (!text.trim()) return null;
    if (!text.includes('?')) return null;
    const named = agents
        .filter((a) => String(a._id) !== lastSpeaker)
        .filter((a) => mentionsName(text, chatName(a)));
    return named.length === 1 ? named[0] : null;
};

// Mention overrides per round. Higher allows A->B->A->B ping-pong up to the turn cap.
export const MAX_MENTION_CHASES_PER_ROUND = 1;

// The last turn with its split segments joined, so mention detection sees all of it.
const lastLogicalTurn = (working: StoredMsg[]): StoredMsg | undefined => {
    const last = working[working.length - 1];
    if (!last || !last.segmentGroupId) return last;
    let i = working.length - 1;
    while (i > 0 && working[i - 1].segmentGroupId === last.segmentGroupId) i--;
    const run = working.slice(i);
    if (run.length < 2) return last;
    return { ...last, content: run.map((m) => m.content).join(' ') };
};

// Last `count` agent turns, oldest first, for the degeneration guard. Participant turns are
// skipped: in an exclusion study they would reset the guard where drift is worst.
const lastAgentLogicalTurns = (working: StoredMsg[], count: number): string[] => {
    const turns: string[] = [];
    let i = working.length - 1;
    while (i >= 0 && turns.length < count) {
        const msg = working[i];
        if (msg.role !== 'assistant') {
            i--;
            continue;
        }
        if (msg.segmentGroupId) {
            let start = i;
            while (start > 0 && working[start - 1].segmentGroupId === msg.segmentGroupId) start--;
            turns.push(
                working
                    .slice(start, i + 1)
                    .map((m) => m.content)
                    .join(' '),
            );
            i = start - 1;
        } else {
            turns.push(msg.content);
            i--;
        }
    }
    return turns.reverse();
};

// Next speaker, or null to end the round. turnIndex counts turns, not messages.
export const selectSpeaker = async (
    turnTaking: TurnTakingConfig,
    agents: IAgent[],
    working: StoredMsg[],
    lastSpeaker: string | null,
    turnIndex: number,
    moderatorFn?: ModeratorFn,
    participantLabel = 'the participant',
    // Seeded per-turn PRNG, so draws are reproducible.
    rng: () => number = Math.random,
    // Mention overrides this round has used. Per round, so the caller owns it.
    chasesUsed = 0,
    // Last agent to speak before this round. Only de-prioritised (see inConsiderationOrder).
    previousAgentSpeaker: string | null = null,
    // Policy must pick someone (first turn of a user round with silenceChance 0).
    mustSpeak = false,
): Promise<IAgent | null> => {
    // Alternation: nobody speaks twice in a row, so a lone agent yields after one turn.
    const notLastSpeaker = (a: IAgent) => String(a._id) !== lastSpeaker;

    // Puts the previous speaker last, so agents[0] doesn't always open user rounds. Not
    // excluded: that would cut the chance anyone replies from 91% to 70% at p=0.7.
    const inConsiderationOrder = (list: IAgent[]): IAgent[] => {
        if (!previousAgentSpeaker || list.length < 2) return list;
        const others = list.filter((a) => String(a._id) !== previousAgentSpeaker);
        if (!others.length || others.length === list.length) return list;
        return [...others, ...list.filter((a) => String(a._id) === previousAgentSpeaker)];
    };

    // A direct question routes to its addressee, above every policy, within the round budget.
    if (chasesUsed < MAX_MENTION_CHASES_PER_ROUND) {
        const addressed = findAddressedAgent(lastLogicalTurn(working), agents, lastSpeaker);
        if (addressed) return addressed;
    }

    switch (turnTaking.policy) {
        case 'rules': {
            // Round-robin. 'brief' adds a bonus turn (turnIndex 2) by a random agent.
            if ((turnTaking.autonomousLevel ?? 'off') === 'brief' && turnIndex >= 2) {
                return agents[Math.floor(rng() * agents.length)] ?? null;
            }
            const eligible = agents.filter(notLastSpeaker);
            if (eligible.length === 0) return null; // lone agent: yields after its one turn
            // Round opening: the most recent previous speaker goes last.
            if (lastSpeaker == null) return inConsiderationOrder(eligible)[0];
            const lastIdx = agents.findIndex((a) => String(a._id) === lastSpeaker);
            for (let step = 1; step <= agents.length; step++) {
                const cand = agents[(lastIdx + step) % agents.length];
                if (notLastSpeaker(cand)) return cand;
            }
            return eligible[0];
        }
        case 'probabilistic': {
            if (rng() < (turnTaking.silenceChance ?? 0)) return null;
            const candidates = inConsiderationOrder(agents.filter(notLastSpeaker));
            for (const candidate of candidates) {
                const p = turnTaking.perAgentProbability?.[String(candidate._id)] ?? 0.7;
                if (rng() < p) return candidate;
            }
            // All draws failed (~9% at two agents, p=0.7). mustSpeak falls back; no extra draw.
            return mustSpeak ? candidates[0] ?? null : null;
        }
        case 'llm': {
            if (!moderatorFn) return null;
            const candidates = agents.filter(notLastSpeaker);
            if (candidates.length === 0) return null;

            const names = candidates.map(chatName);
            const system = [
                turnTaking.moderatorPrompt,
                `You are moderating a conversation between ${participantLabel} and these participants: ` +
                    candidates.map((a) => `${chatName(a)} — ${a.summary || ''}`).join('; ') +
                    `. Decide who should speak next, or answer NONE to hand the conversation back to ${participantLabel}. ` +
                    `Return NONE when the agents have nothing further to add and it is time to return to ${participantLabel}. ` +
                    `Reply with EXACTLY one of: [${names.join(', ')}] or NONE.`,
            ]
                .filter(Boolean)
                .join('\n');
            const transcriptText = renderTranscript(working, participantLabel);

            // Requery up to 2x on an ambiguous or unmatched answer.
            for (let attempt = 0; attempt < 3; attempt++) {
                const reply = (await moderatorFn(system, transcriptText)).trim();
                if (/^none\b/i.test(reply)) return null;

                const exact = candidates.find((a) => chatName(a).toLowerCase() === reply.toLowerCase());
                if (exact) return exact;

                // Shared name rule: handles non-ASCII names and regex characters.
                const mentioned = candidates.filter((a) => mentionsName(reply, chatName(a)));
                if (mentioned.length === 1) return mentioned[0];
            }
            // Three unusable answers is a malfunction, not a decision like NONE, so the floor applies.
            return mustSpeak ? candidates[0] ?? null : null;
        }
        default:
            return null;
    }
};

// Replaces an opener that returned empty. Decides who, never whether. llm uses `rules`
// order, since no LLM may make a platform decision. Null only for a one-agent roster.
export const selectReplacementSpeaker = (
    turnTaking: TurnTakingConfig,
    agents: IAgent[],
    failedId: string,
    working: StoredMsg[],
    participantLabel: string,
    rng: () => number,
    previousAgentSpeaker: string | null,
): Promise<IAgent | null> => {
    const others = agents.filter((a) => String(a._id) !== failedId);
    if (!others.length) return Promise.resolve(null);
    const whoNotWhether: TurnTakingConfig =
        turnTaking.policy === 'probabilistic' ? { ...turnTaking, silenceChance: 0 } : { ...turnTaking, policy: 'rules' };
    return selectSpeaker(
        whoNotWhether,
        others,
        working,
        null,
        0,
        undefined,
        participantLabel,
        rng,
        MAX_MENTION_CHASES_PER_ROUND,
        previousAgentSpeaker,
        true,
    );
};

// Empty or whitespace-only reply.
const isBlankReply = (reply: string | null | undefined): boolean => !reply || !reply.trim();

export interface GroupRoundInput {
    agents: IAgent[];
    history: StoredMsg[];
    turnTaking: TurnTakingConfig;
    participantLabel: string;
    // With `onChunk`, must stream per delta; still resolves to the full reply.
    generate: (
        agent: IAgent,
        working: StoredMsg[],
        onChunk?: (chunk: string) => Promise<void>,
        // Per-turn context additions (the thread-control note).
        extras?: { tailNote?: string },
    ) => Promise<string>;
    moderatorFn?: ModeratorFn;
    // Token streaming, no round layout. Never set for a humanized roster. `interSegmentPauseMs`
    // rides the delta because the client picks the gap before the final frame arrives.
    onTurnChunk?: (
        meta: { turnId: string; speakerId: string; speakerName: string; interSegmentPauseMs?: number },
        chunk: string,
    ) => Promise<void>;
    // Called with each agent message as it is produced. Omitted = accumulate and return.
    onTurn?: (msg: StoredMsg) => Promise<void>;
    // Makes speaker selection and timing reproducible. Absent = Math.random.
    seed?: string;
    // Unique per round. Prefixed `u`/`a` since user and auto rounds number differently.
    // User batch and stream share an anchor on purpose: batch is the stream's fallback.
    roundAnchor?: string | number;
    // 'user': first replies are blind to same-round replies, so interleaving is honest.
    roundKind?: 'user' | 'autonomous';
    // Absent or disabled = no `dir:` draws at all.
    threadControl?: ResolvedThreadControl;
    // First round of a survey block: `close` becomes `return` so it never opens to silence.
    segmentJustOpened?: boolean;
    // Records an early close, which the transcript alone can't distinguish from running out of turns.
    onRoundEvent?: (event: { kind: 'close'; by: 'draw' | 'guard'; turnIndex: number }) => Promise<void>;
    // Every opener of a user round returned empty. Not called when a decision ended it.
    onSilentRound?: (event: { agentIds: string[] }) => Promise<void>;
}

// Turn cap per level. Two agents on `rules`: off = A,B; brief = A,B,random; extended = A,B,A,B.
const MAX_AGENT_TURNS = 4;
const levelToCap = (level: string): number => {
    switch (level) {
        case 'extended':
            return 4;
        case 'brief':
            return 3;
        case 'off':
        default:
            return 2;
    }
};

// Runs one round and returns the new agent messages in order, timing stamped; the caller persists.
export const runGroupRound = async (input: GroupRoundInput): Promise<StoredMsg[]> => {
    const { agents, history, turnTaking, participantLabel, generate, moderatorFn, onTurn, onTurnChunk, seed, roundAnchor = 0, roundKind = 'user', threadControl, segmentJustOpened, onRoundEvent, onSilentRound } = input;
    const control = threadControl ?? { enabled: false, ground: 0, shift: 0, return: 0, close: 0 };

    // Streaming skips round layout: a turn already on screen can't be reordered.
    const streaming = !!onTurnChunk;
    const speakerLabels = buildSpeakerLabels(agents, participantLabel);
    // Streaming only: turns already emitted, returned instead of the laid-out timeline.
    const emitted: StoredMsg[] = [];

    const working = [...history];
    const last = working[working.length - 1];
    let lastSpeaker = last && last.role === 'assistant' && last.speakerId ? String(last.speakerId) : null;

    // Last agent to speak, past the participant's turn. Only orders candidates.
    let previousAgentSpeaker: string | null = null;
    for (let i = working.length - 1; i >= 0; i--) {
        const m = working[i];
        if (m.role === 'assistant' && m.speakerId) {
            previousAgentSpeaker = String(m.speakerId);
            break;
        }
    }

    // The round can end earlier when the policy yields. maxAgentTurnsPerRound is unused.
    const maxTurns = Math.min(MAX_AGENT_TURNS, levelToCap(turnTaking.autonomousLevel ?? 'off'));

    // Per-segment index, shared by all stamp sites, so each segment has a unique timing stream.
    let msgIndex = 0;
    // Logical turns this round. Keys the split stream, which must stay separate from timing.
    let turnCounter = 0;

    // Turns in generation order; layoutRoundTimeline decides emit order after the round.
    const turns: StoredMsg[][] = [];
    // Blind turns see only the first roundBaseLen messages. blindFlags aligns 1:1 with `turns`.
    const roundBaseLen = working.length;
    const spokenThisRound = new Set<string>();
    const blindFlags: boolean[] = [];
    // Gates the round budget.
    let roundHasHumanized = false;
    let chasesUsed = 0;
    // Ended before the cap; only then does the courtesy turn apply.
    let roundYielded = false;

    // One turn with labels stripped; returns what the participant saw. `tokenStream` is per
    // turn: a splitting agent generates buffered, since a reply can't be cut until it exists.
    const generateTurn = async (
        agent: IAgent,
        context: StoredMsg[],
        turnId: string,
        tokenStream: boolean,
        // Not part of the transcript; goes in the tail block.
        extras?: { tailNote?: string },
    ): Promise<string> => {
        if (!tokenStream) {
            const raw = await generate(agent, context, undefined, extras);
            const cleaned = stripSpeakerPrefix(raw, speakerLabels);
            if (cleaned !== raw) warnLabelStripped(chatName(agent), raw);
            return cleaned;
        }
        const stripper = createPrefixStripper(speakerLabels);
        const meta = { turnId, speakerId: String(agent._id), speakerName: chatName(agent) };
        let shown = '';
        // Leading whitespace isn't forwarded, so a blank (never persisted) reply sends no delta;
        // otherwise the client would wait for a final frame that never comes.
        let visibleStarted = false;
        const emit = async (text: string) => {
            if (!text) return;
            shown += text;
            if (!visibleStarted) {
                const firstVisible = text.search(/\S/);
                if (firstVisible === -1) return;
                visibleStarted = true;
                text = text.slice(firstVisible);
            }
            await onTurnChunk!(meta, text);
        };
        await generate(agent, context, async (chunk) => emit(stripper.push(chunk)), extras);
        await emit(stripper.flush());
        if (stripper.didStrip()) warnLabelStripped(chatName(agent), shown);
        return shown;
    };

    // Timing zeroed: the client typewriter is the delivery. Done after the draws so seeded
    // streams stay aligned with the buffered path.
    const emitStreamedTurn = async (turnSegs: StoredMsg[]) => {
        for (const msg of turnSegs) {
            msg.preTypingDelayMs = 0;
            msg.typingDurationMs = 0;
            msg.interSegmentPauseMs = null;
            msg.revealAtMs = 0;
            emitted.push(msg);
            await onTurn?.(msg);
        }
    };

    // A buffered split turn sent as one short turn per segment: delta, then Message. The client
    // matches final frames by arrival, so the delta is always sent. The segment pause is kept.
    const emitBufferedSplitTurn = async (agent: IAgent, turnSegs: StoredMsg[], turnId: string) => {
        const speaker = { speakerId: String(agent._id), speakerName: chatName(agent) };
        for (let i = 0; i < turnSegs.length; i++) {
            const msg = turnSegs[i];
            msg.preTypingDelayMs = 0;
            msg.typingDurationMs = 0;
            msg.revealAtMs = 0;
            // The first bubble keeps the normal inter-turn gap. `?? undefined` keeps null off the frame.
            await onTurnChunk!(
                {
                    ...speaker,
                    turnId: `${turnId}#${i}`,
                    ...(i > 0 ? { interSegmentPauseMs: msg.interSegmentPauseMs ?? undefined } : {}),
                },
                msg.content,
            );
            emitted.push(msg);
            await onTurn?.(msg);
        }
    };

    // Streamed rounds need the explicit flag; isSplitEnabled's HD fallback doesn't apply.
    const turnSplits = (agent: IAgent): boolean =>
        streaming ? agent.pacing?.enabled?.split === true : isSplitEnabled(agent);

    // Non-humanized: NO_OP_PACING plus only the split fields, if splitting is enabled.
    const turnPacingFor = (agent: IAgent, humanized: boolean): IAgent['pacing'] => {
        if (humanized) return agent.pacing;
        if (!turnSplits(agent)) return NO_OP_PACING;
        return {
            ...NO_OP_PACING,
            splitProbability: agent.pacing?.splitProbability,
            maxSegments: agent.pacing?.maxSegments,
        };
    };

    for (let turnIndex = 0; turnIndex < maxTurns; turnIndex++) {
        const selRng = seed != null ? makeRng(seed, `sel:${roundAnchor}:${turnIndex}`) : Math.random;
        // With silenceChance 0 a participant message must get a reply; in exclusion studies an
        // empty round looks like the manipulation. First turn of user rounds only; no draw.
        const mustSpeak = roundKind === 'user' && turnIndex === 0 && (turnTaking.silenceChance ?? 0) === 0;
        // `let`: the re-floor below may hand this turn to another agent.
        let next = await selectSpeaker(
            turnTaking,
            agents,
            working,
            lastSpeaker,
            turnIndex,
            moderatorFn,
            participantLabel,
            selRng,
            chasesUsed,
            previousAgentSpeaker,
            mustSpeak,
        );
        if (!next) {
            roundYielded = true;
            break;
        }

        // First reply in a user round is blind, unless addressed by name.
        const addressedAgent = findAddressedAgent(lastLogicalTurn(working), agents, lastSpeaker);
        const isAddressed = !!addressedAgent && String(addressedAgent._id) === String(next._id);
        // Charge the budget only when the override actually applied.
        if (isAddressed && chasesUsed < MAX_MENTION_CHASES_PER_ROUND) chasesUsed++;
        const blind = roundKind === 'user' && !spokenThisRound.has(String(next._id)) && !isAddressed;

        // Thread control on agent-to-agent turns only, on its own `dir:` stream. The guard
        // runs first; if it fires the round ends, so nothing desyncs.
        let tailNote: string | undefined;
        let turnMove: Move | undefined;
        if (control.enabled && !blind) {
            const guarded = isDegenerate(lastAgentLogicalTurns(working, GUARD_WINDOW));
            const dirRng = seed != null ? makeRng(seed, `dir:${roundAnchor}:${turnIndex}`) : Math.random;
            let move: Move = guarded ? 'close' : drawMove(control, dirRng);
            // A survey block must not open to silence.
            if (move === 'close' && segmentJustOpened) move = 'return';
            if (move === 'close') {
                await onRoundEvent?.({ kind: 'close', by: guarded ? 'guard' : 'draw', turnIndex });
                // Like selectSpeaker returning null: the courtesy turn still runs.
                roundYielded = true;
                break;
            }
            if (move !== 'continue') {
                turnMove = move;
                tailNote = MOVE_NOTES[move];
            }
        }

        const genContext = blind ? working.slice(0, roundBaseLen) : working;
        const prevText = genContext.length ? genContext[genContext.length - 1].content : '';
        // A splitting agent generates buffered; a reply can't be cut until it exists.
        let turnStreams = streaming && !turnSplits(next);
        let turnId = `t${turnCounter}`;
        let reply = await generateTurn(next, genContext, turnId, turnStreams, { tailNote });

        // Re-floor: an empty opening reply is a malfunction, not a decision, so the floor passes
        // once to another agent (first turn of user rounds only). The replacement is still turn 0,
        // with its own `refloor:` stream and turnId `r<n>`. If it is empty too, onSilentRound fires.
        if (isBlankReply(reply) && roundKind === 'user' && turnIndex === 0) {
            const blankAgentIds = [String(next._id)];
            const refloorRng = seed != null ? makeRng(seed, `refloor:${roundAnchor}`) : Math.random;
            const replacement = await selectReplacementSpeaker(
                turnTaking,
                agents,
                String(next._id),
                working,
                participantLabel,
                refloorRng,
                previousAgentSpeaker,
            );
            if (replacement) {
                console.warn(
                    `[group] ${chatName(next)} returned an empty reply to the participant (round ${roundAnchor}); ` +
                        `the floor passes to ${chatName(replacement)}`,
                );
                next = replacement;
                turnStreams = streaming && !turnSplits(next);
                turnId = `r${turnCounter}`;
                reply = await generateTurn(next, genContext, turnId, turnStreams, { tailNote });
                if (isBlankReply(reply)) blankAgentIds.push(String(next._id));
            }
            if (isBlankReply(reply)) {
                await onSilentRound?.({ agentIds: blankAgentIds });
                roundYielded = true;
                break;
            }
        }

        if (isBlankReply(reply)) {
            // Silence ends the round, and counts as yielding for the courtesy turn.
            roundYielded = true;
            break;
        }
        spokenThisRound.add(String(next._id));

        // Split decision: its own stream keyed by logical turn, separate from timing.
        const splitRng = seed != null
            ? makeRng(seed, `split:${roundAnchor}:${turnCounter}`)
            : mulberry32(Math.floor(Math.random() * 2 ** 31));
        // splitReply always draws its roll, keeping the split stream aligned.
        // A streamed turn is never humanized: the client typewriter is the delivery.
        const turnHumanized = !streaming && isHumanized(next);
        const turnPacing = turnPacingFor(next, turnHumanized);
        if (turnHumanized) roundHasHumanized = true;
        // Timing is keyed per emitted segment (msgIndex).
        const startIdx = msgIndex;
        const segs = buildPacedSegments({
            reply,
            prevContent: prevText,
            pacing: turnPacing,
            // Typing speed lives outside the pacing object, so its toggle is applied here.
            timeDelay: streaming ? null : resolveTypingDelay(next),
            splitRng,
            timeRngFor: (i) =>
                seed != null
                    ? makeRng(seed, `time:${roundAnchor}:${startIdx + i}`)
                    : mulberry32(Math.floor(Math.random() * 2 ** 31)),
            segmentGroupId: `seg-${roundAnchor}-${turnCounter}`,
            humanized: turnHumanized,
        });
        const turnSegs: StoredMsg[] = [];
        for (const seg of segs) {
            const msg: StoredMsg = {
                role: 'assistant',
                content: seg.content,
                speakerId: String(next._id),
                speakerName: chatName(next),
                timeDelay: seg.timeDelay,
                prev_message: seg.prev_message,
                preTypingDelayMs: seg.preTypingDelayMs,
                typingDurationMs: seg.typingDurationMs,
                interSegmentPauseMs: seg.interSegmentPauseMs,
                segmentGroupId: seg.segmentGroupId,
                segmentIndex: seg.segmentIndex,
                segmentCount: seg.segmentCount,
                // On every segment, since together they are the steered utterance.
                ...(turnMove ? { move: turnMove } : {}),
            };
            turnSegs.push(msg);
            // Generation order; emit order is decided later by layoutRoundTimeline.
            working.push(msg);
            msgIndex++;
        }
        if (streaming) {
            // Already on screen, so emit now. A buffered split turn goes out as one delta per segment.
            if (turnStreams) await emitStreamedTurn(turnSegs);
            else await emitBufferedSplitTurn(next, turnSegs, turnId);
        } else {
            turns.push(turnSegs);
            // Interleaving is HD-only; a non-humanized turn is laid out sequentially even if blind.
            blindFlags.push(blind && turnHumanized);
        }
        turnCounter++;
        lastSpeaker = String(next._id);
    }

    // Courtesy turn: a round that ended early with a question to an agent who hasn't spoken
    // gives them one non-recursive reply. `tail` is the last segment, for prev_message.
    const tail = working[working.length - 1];
    const addressedAtEnd = findAddressedAgent(lastLogicalTurn(working), agents, lastSpeaker);
    const pending =
        roundYielded && addressedAtEnd && !spokenThisRound.has(String(addressedAtEnd._id))
            ? addressedAtEnd
            : null;
    if (pending) {
        // Same per-turn streaming decision as the main loop.
        const pendingStreams = streaming && !turnSplits(pending);
        const reply = await generateTurn(pending, working, `t${turnCounter}`, pendingStreams);
        if (reply && reply.trim()) {
            // Shares the loop's counters, so its stream keys stay unique.
            const splitRng = seed != null
                ? makeRng(seed, `split:${roundAnchor}:${turnCounter}`)
                : mulberry32(Math.floor(Math.random() * 2 ** 31));
            const pendingHumanized = !streaming && isHumanized(pending);
            const pendingPacing = turnPacingFor(pending, pendingHumanized);
            if (pendingHumanized) roundHasHumanized = true;
            const startIdx = msgIndex;
            const segs = buildPacedSegments({
                reply,
                prevContent: tail ? tail.content : '',
                pacing: pendingPacing,
                timeDelay: streaming ? null : resolveTypingDelay(pending),
                splitRng,
                timeRngFor: (i) =>
                    seed != null
                        ? makeRng(seed, `time:${roundAnchor}:${startIdx + i}`)
                        : mulberry32(Math.floor(Math.random() * 2 ** 31)),
                segmentGroupId: `seg-${roundAnchor}-${turnCounter}`,
                humanized: pendingHumanized,
            });
            const turnSegs: StoredMsg[] = [];
            for (const seg of segs) {
                const msg: StoredMsg = {
                    role: 'assistant',
                    content: seg.content,
                    speakerId: String(pending._id),
                    speakerName: chatName(pending),
                    timeDelay: seg.timeDelay,
                    prev_message: seg.prev_message,
                    preTypingDelayMs: seg.preTypingDelayMs,
                    typingDurationMs: seg.typingDurationMs,
                    interSegmentPauseMs: seg.interSegmentPauseMs,
                    segmentGroupId: seg.segmentGroupId,
                    segmentIndex: seg.segmentIndex,
                    segmentCount: seg.segmentCount,
                };
                turnSegs.push(msg);
                working.push(msg);
                msgIndex++;
            }
            if (streaming) {
                if (pendingStreams) await emitStreamedTurn(turnSegs);
                else await emitBufferedSplitTurn(pending, turnSegs, `t${turnCounter}`);
            } else {
                turns.push(turnSegs);
                // A direct answer: aware, laid out sequentially.
                blindFlags.push(false);
            }
            turnCounter++;
        }
    }

    // Streaming: already emitted in generation order.
    if (streaming) return emitted;

    // Interleave buffered turns. `mix:` is drawn last, so other draws keep their order.
    const mixRngFor = (t: number) =>
        seed != null
            ? makeRng(seed, `mix:${roundAnchor}:${t}`)
            : mulberry32(Math.floor(Math.random() * 2 ** 31));
    // The round budget applies only without HD turns; compressing HD would undo the simulation.
    const timeline = layoutRoundTimeline(
        turns,
        mixRngFor,
        blindFlags,
        roundHasHumanized ? undefined : DEFAULT_ROUND_BUDGET_MS,
    );
    for (const msg of timeline) {
        // Awaited in order: this order is messageNumber and display order.
        await onTurn?.(msg);
    }

    return timeline;
};

// Pure data-shaping helpers for the conversation service.

// Privileged users get the current roster; participants their registration snapshot.
export const resolveGroupAgents = (
    user: IUser,
    privilegedAgents: IAgent[],
    isPrivileged: boolean,
): IAgent[] => (isPrivileged ? privilegedAgents : user.agents) ?? [];

export interface FirstSentenceDoc {
    role: 'assistant';
    content: string;
    speakerId: string;
    speakerName: string;
    timeDelay: null;
    prev_message: null;
    messageNumber: number;
}

// One first-sentence doc per agent that has one, in roster order, numbered from 1.
export const buildFirstSentenceDocs = (agents: IAgent[]): FirstSentenceDoc[] =>
    agents
        .filter((a) => a && a.firstChatSentence)
        .map((a, i) => ({
            role: 'assistant' as const,
            content: a.firstChatSentence,
            speakerId: String(a._id),
            speakerName: chatName(a),
            timeDelay: null,
            prev_message: null,
            messageNumber: i + 1,
        }));

export interface RawConvDoc {
    role: string;
    content: string;
    speakerId?: string;
    speakerName?: string;
    timeDelay?: number | null;
    prev_message?: string | null;
    // Lets lastLogicalTurn() join a split turn from an earlier round.
    segmentGroupId?: string | null;
}

// Stored docs to StoredMsg[]. Name prefixes are added later, per target, by buildGroupRequest.
export const assembleHistory = (docs: RawConvDoc[]): StoredMsg[] =>
    docs
        .filter((d) => d.role !== 'system' && d.content && String(d.content).trim())
        .map((d) => ({
            role: d.role as StoredMsg['role'],
            content: d.content,
            speakerId: d.speakerId,
            speakerName: d.speakerName,
            timeDelay: d.timeDelay ?? null,
            prev_message: d.prev_message ?? null,
            segmentGroupId: d.segmentGroupId ?? null,
        }));

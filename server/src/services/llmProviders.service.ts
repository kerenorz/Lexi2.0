import {
    OpenAI,
    APIError as OpenAIAPIError,
    APIConnectionError as OpenAIConnectionError,
    APIConnectionTimeoutError as OpenAIConnectionTimeoutError,
    APIUserAbortError as OpenAIUserAbortError,
} from 'openai';
import Anthropic, {
    APIConnectionError as AnthropicConnectionError,
    APIConnectionTimeoutError as AnthropicConnectionTimeoutError,
    APIUserAbortError as AnthropicUserAbortError,
} from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { LLMProvider } from '../types';
import { AppError, isAppError } from '../utils/errors';
import { getCatalogueModel, OpenRouterParam, OpenRouterRoute } from '../constants/modelCatalogue';

export function getProviderFromModel(modelName: string): LLMProvider {
    // OpenRouter ids are "<maker>/<model>"; no direct id has a slash. Checked first so
    // "openai/gpt-4o" goes to OpenRouter.
    if (modelName.includes('/')) {
        return 'openrouter';
    }
    if (modelName.startsWith('gpt-')|| modelName.startsWith('o1') || modelName.startsWith('o3')) {
        return 'openai';
    }
    if (modelName.startsWith('claude-')) {
        return 'anthropic';
    }
    if (modelName.startsWith('gemini-')) {
        return 'google';
    }
    if (modelName.startsWith('grok-')) {
        return 'xai';
    }
    throw new AppError(`Unknown model: ${modelName}. Cannot determine provider.`, 400, 'UNKNOWN_MODEL');
}

// gpt-5 and o-series reject non-default sampling params and 'max_tokens'.
// Shared by every OpenAI param builder.
export const isOpenAIRestricted = (m: string): boolean =>
    m.startsWith('gpt-5') || m.startsWith('gpt-6') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');

// Served only by the Responses API (Chat Completions returns 404). An explicit list, since the API is
// OpenAI's per-model choice; a new -pro model must be added here. Each must also be isOpenAIRestricted.
// Direct OpenAI only.
export const OPENAI_RESPONSES_ONLY_MODELS: ReadonlySet<string> = new Set(['gpt-5.4-pro', 'gpt-5.2-pro']);

export const isOpenAIResponsesOnly = (m: string): boolean => OPENAI_RESPONSES_ONLY_MODELS.has(m);

// baseURLs for OpenAI-compatible providers. 'openai' is absent so the SDK uses its default host.
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<LLMProvider, string>> = {
    xai: 'https://api.x.ai/v1',
    openrouter: OPENROUTER_BASE_URL,
};

// SDK retries off: withRetry is the only retry layer, so attempts don't stack (up to 9), and only it
// knows whether a stream already sent text. Gemini retries only with retryOptions, which Lexi never sets.
export const NO_SDK_RETRIES = { maxRetries: 0 } as const;

// Provider timeouts. The OpenAI/Anthropic SDK timeout stops at the response headers, so it never ends
// a stream that stalls mid-reply; Gemini's is a whole-request deadline that would cut a healthy stream.
// So every stream runs under watchStream, which bounds silence, not total length.
// Calls are not aborted when the participant leaves: a finished, saved round beats a half-saved one.

// Max wait for a buffered reply, or for a stream's first text (reasoning models think silently first).
export const PROVIDER_TIMEOUT_MS = 120_000;

// Max silence once a stream's text has begun.
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

// PROVIDER_TIMEOUT_MS for responses-only (-pro) models, which reason for minutes before replying.
// Kept under the 300 s load balancer, nginx and conversation-lock limits so the call ends first.
export const RESPONSES_ONLY_TIMEOUT_MS = 240_000;

// Watchdog limits, on a mutable object so they can be shortened without waiting on the clock.
// responsesOnlyBeforeTextMs replaces beforeTextMs for a responses-only model's stream.
export const streamTiming = {
    beforeTextMs: PROVIDER_TIMEOUT_MS,
    idleMs: STREAM_IDLE_TIMEOUT_MS,
    responsesOnlyBeforeTextMs: RESPONSES_ONLY_TIMEOUT_MS,
};

// For every completion client: no SDK retries, Lexi's timeout.
export const COMPLETION_CLIENT_OPTIONS = { ...NO_SDK_RETRIES, timeout: PROVIDER_TIMEOUT_MS } as const;

// Gemini's timeout is a whole-request deadline: right for buffered, but it would cut a healthy stream,
// so streams get none and rely on watchStream. No retryOptions, so the SDK makes one attempt.
export const makeGeminiClient = (apiKey: string, stream: boolean): GoogleGenAI =>
    new GoogleGenAI(stream ? { apiKey } : { apiKey, httpOptions: { timeout: PROVIDER_TIMEOUT_MS } });

// `history` is the turns before `message`, which is always a user turn.
export interface GeminiRequest {
    model: string;
    systemInstruction?: string;
    history: { role: 'user' | 'model'; parts: { text: string }[] }[];
    message: string;
    generationConfig: Record<string, unknown>;
}

// The Gemini call for 1-1, group and moderator. Stateless: history + message in one request.
export async function geminiCompletion(
    apiKey: string,
    req: GeminiRequest,
    stream: boolean,
    emission: ReturnType<typeof trackStreamEmission>,
): Promise<string> {
    const ai = makeGeminiClient(apiKey, stream);
    const contents = [...req.history, { role: 'user' as const, parts: [{ text: req.message }] }];
    const config: Record<string, unknown> = { ...req.generationConfig };
    if (req.systemInstruction) config.systemInstruction = req.systemInstruction;

    return runProvider('google', () => withRetry(async () => {
        if (!stream) {
            const response = await ai.models.generateContent({ model: req.model, contents, config });
            return response.text?.trim() || '';
        }

        return watchStream(async (watch) => {
            const responseStream = await ai.models.generateContentStream({
                model: req.model,
                contents,
                config: { ...config, abortSignal: watch.signal },
            });
            let full = '';
            for await (const chunk of watch.parts(responseStream, PART_CARRIES_TEXT.google)) {
                const text = chunk.text ?? '';
                await emission.forward(text);
                full += text;
            }
            return full;
        });
    }, undefined, emission.canRetry));
}

// Every OpenAI-SDK client (OpenAI, xAI, OpenRouter): no SDK retries, Lexi's timeout. `sdkRetries`
// keeps the SDK defaults; only key validation uses it, since withRetry doesn't wrap that call.
export const makeOpenAIClient = (
    apiKey: string,
    provider: LLMProvider,
    { sdkRetries = false, timeout = PROVIDER_TIMEOUT_MS }: { sdkRetries?: boolean; timeout?: number } = {},
): OpenAI => {
    const baseURL = OPENAI_COMPATIBLE_BASE_URLS[provider];
    return new OpenAI({
        apiKey,
        organization: null,
        ...(baseURL ? { baseURL } : {}),
        ...(sdkRetries ? {} : { ...COMPLETION_CLIENT_OPTIONS, timeout }),
    });
};

// Grok-4 reasoning: needs max_completion_tokens and rejects penalties/stop, but accepts temperature/top_p.
export const isGrokReasoning = (m: string): boolean => m.startsWith('grok-4');

// Reasoning models spend output tokens on hidden reasoning, so a low cap gives an empty reply; they get
// this instead. Within every model's output limit and under Anthropic's 21,333 non-streaming limit.
export const REASONING_OUTPUT_FLOOR = 16384;

// Gemini 2.5/3/4 think. thinkingConfig is deliberately not sent: it would change how running studies' agents answer.
const isGeminiThinkingModel = (model: string): boolean => /^gemini-(2\.5|3|4)/.test(model);
export const geminiMaxOutputTokens = (model: string, base: number): number =>
    isGeminiThinkingModel(model) ? REASONING_OUTPUT_FLOOR : base;

// Anthropic models that reason by default (Claude 5 adaptively). Must not match Sonnet 4.5 or Haiku 4.5.
export const isAnthropicDefaultThinking = (m: string): boolean =>
    m.startsWith('claude-opus-4-6') ||
    m.startsWith('claude-opus-4-7') ||
    m.startsWith('claude-opus-4-8') ||
    m.startsWith('claude-sonnet-4-6') ||
    /^claude-(opus|sonnet|haiku)-5-/.test(m);

// Claude 4.7+ and 5 reject any non-default temperature or top_p, so neither is sent.
export const isAnthropicNoSampling = (m: string): boolean => /^claude-(opus|sonnet|haiku)-(4-[7-9]|5-)/.test(m);

// Claude 4.x rejects temperature and top_p together. Send temperature (clamped to Anthropic's [0, 1];
// the form allows 2), else top_p. 0 counts as set.
export const anthropicSampling = (
    temperature: number | null | undefined,
    topP: number | null | undefined,
): { temperature?: number; top_p?: number } => {
    if (temperature != null) return { temperature: Math.min(1, Math.max(0, temperature)) };
    if (topP != null) return { top_p: topP };
    return {};
};

// Direct Anthropic sampling: none if the model refuses it, else anthropicSampling.
export const anthropicSamplingFor = (
    model: string,
    temperature: number | null | undefined,
    topP: number | null | undefined,
): { temperature?: number; top_p?: number } =>
    isAnthropicNoSampling(model) ? {} : anthropicSampling(temperature, topP);

// Agent-form settings a model ignores (the picker's "!"). Uses the payload builders' own predicates.
// `max_tokens` means it is replaced by REASONING_OUTPUT_FLOOR.
export const AGENT_SETTINGS: readonly OpenRouterParam[] = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'max_tokens'];

export const ignoredSettings = (model: string): OpenRouterParam[] => {
    const ignored = new Set<OpenRouterParam>();
    switch (getProviderFromModel(model)) {
        case 'openrouter': {
            const route = openRouterRoute(model);
            AGENT_SETTINGS.forEach((p) => {
                if (!route.params.includes(p)) ignored.add(p);
            });
            if (route.reasonsByDefault) ignored.add('max_tokens');
            break;
        }
        case 'openai':
        case 'xai':
            if (isOpenAIRestricted(model)) AGENT_SETTINGS.forEach((p) => ignored.add(p));
            else if (isGrokReasoning(model)) ['frequency_penalty', 'presence_penalty', 'stop', 'max_tokens'].forEach((p) => ignored.add(p as OpenRouterParam));
            break;
        case 'anthropic':
            ignored.add('frequency_penalty').add('presence_penalty');
            if (isAnthropicNoSampling(model)) ignored.add('temperature').add('top_p');
            if (isAnthropicDefaultThinking(model)) ignored.add('max_tokens');
            break;
        case 'google':
            ignored.add('frequency_penalty').add('presence_penalty').add('stop');
            if (isGeminiThinkingModel(model)) ignored.add('max_tokens');
            break;
    }
    return AGENT_SETTINGS.filter((p) => ignored.has(p));
};

const providerLabel = (provider: LLMProvider): string => {
    switch (provider) {
        case 'openai': return 'OpenAI';
        case 'anthropic': return 'Anthropic';
        case 'google': return 'Google';
        case 'xai': return 'xAI';
        case 'openrouter': return 'OpenRouter';
    }
};

// OpenRouter would otherwise pick the host and silently drop unsupported params. So every request pins
// the catalogue's host with no fallback, requires all sent params (safe because only route.params are
// sent) and denies data collection.

// Requested sampling, named as in the 1-1 chatRequest.
export interface RequestedSampling {
    temperature?: number | null;
    top_p?: number | null;
    frequency_penalty?: number | null;
    presence_penalty?: number | null;
    stop?: string[] | null;
    max_tokens?: number | null;
}

export const openRouterRoute = (model: string): OpenRouterRoute => {
    const route = getCatalogueModel(model)?.openrouter;
    if (!route) {
        throw new AppError(`Model ${model} is not in Lexi's OpenRouter list.`, 400, 'UNKNOWN_MODEL');
    }
    return route;
};

// Makers that keep system turns in place like OpenAI. Others get Anthropic-style shaping, so a
// model's prompt is the same direct or through OpenRouter.
export const openRouterKeepsSystemInPlace = (model: string): boolean =>
    model.startsWith('openai/') || model.startsWith('x-ai/');

export const openRouterBody = (model: string, sampling: RequestedSampling): Record<string, any> => {
    const route = openRouterRoute(model);
    const honours = (param: OpenRouterParam) => route.params.includes(param);
    const body: Record<string, any> = {};

    const temperature = honours('temperature') ? sampling.temperature : null;
    const topP = honours('top_p') ? sampling.top_p : null;
    if (model.startsWith('anthropic/')) {
        // Same one-of-two rule as the direct Anthropic path.
        Object.assign(body, anthropicSampling(temperature, topP));
    } else {
        if (temperature != null) body.temperature = temperature;
        if (topP != null) body.top_p = topP;
    }
    if (honours('frequency_penalty') && sampling.frequency_penalty != null) body.frequency_penalty = sampling.frequency_penalty;
    if (honours('presence_penalty') && sampling.presence_penalty != null) body.presence_penalty = sampling.presence_penalty;
    // An empty list would still count as requiring `stop` under require_parameters.
    if (honours('stop') && sampling.stop?.length) body.stop = sampling.stop;
    if (honours('max_tokens')) {
        if (route.reasonsByDefault) body.max_tokens = REASONING_OUTPUT_FLOOR;
        else if (sampling.max_tokens) body.max_tokens = sampling.max_tokens;
    }

    body.provider = {
        only: [route.host],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: 'deny',
    };
    return body;
};

// Only {role, content} is sent; Lexi's own message fields stay local.
export const openRouterMessages = (model: string, messages: any[]): { role: string; content: string }[] => {
    const plain = messages.map((m: any) => ({ role: m.role, content: m.content }));
    // As openAIChatCompletion sends them, trailing empty assistant prime and all.
    if (openRouterKeepsSystemInPlace(model)) return plain;

    // As anthropicChatCompletion shapes them.
    const system = plain.filter((m) => m.role === 'system').map((m) => m.content).filter(Boolean).join('\n');
    const merged = mergeConsecutiveMessages(plain.filter((m) => m.role !== 'system'));
    while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();
    const turns = merged
        .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        .filter((m: any) => m.content);
    return system ? [{ role: 'system', content: system }, ...turns] : turns;
};

function translateProviderError(err: any, provider: LLMProvider): AppError {
    if (isAppError(err)) return err;

    const label = providerLabel(provider);

    // Lexi aborts only on timeout, so every abort lands here. Not terminal: a Resend usually works.
    if (isTimeoutOrAbort(err)) {
        return new AppError(
            `${label} did not respond in time. Please try again in a moment.`,
            504,
            'PROVIDER_TIMEOUT',
        );
    }

    const status = err?.status ?? err?.response?.status;
    const rawMessage: string = String(err?.message ?? '');
    const lower = rawMessage.toLowerCase();

    const isInvalidKey = status === 401
        || err?.code === 'invalid_api_key'
        || lower.includes('incorrect api key')
        || lower.includes('invalid api key')
        || lower.includes('api key not valid');
    if (isInvalidKey) {
        return new AppError(
            `The stored API key was rejected by ${label}. Please update it in Settings.`,
            400,
            'INVALID_API_KEY',
        );
    }

    // OpenAI reports no credit as a 429 'insufficient_quota'; check before the rate-limit branch.
    const errCode = err?.code ?? err?.error?.code;
    if (provider === 'openai' && errCode === 'insufficient_quota') {
        return new AppError(
            `${label} API key has no remaining credits/quota — check provider billing.`,
            402,
            'PROVIDER_NO_CREDITS',
        );
    }

    // OpenRouter 402: empty balance or the key's spending limit.
    if (provider === 'openrouter' && status === 402) {
        return new AppError(
            `${label} has no credit left for this key — the lab's balance is empty or the key reached its spending limit.`,
            402,
            'PROVIDER_NO_CREDITS',
        );
    }

    // Pinned host down or excluded by privacy settings. Checked before the generic 404 (unknown model).
    if (provider === 'openrouter' && status === 404 && lower.includes('no endpoints')) {
        return new AppError(
            `${label} could not reach the one host Lexi uses for this model. Please try again in a moment; if it keeps failing, check the OpenRouter account's privacy settings.`,
            503,
            'PROVIDER_OVERLOADED',
        );
    }

    if (status === 429 || lower.includes('rate limit')) {
        return new AppError(
            `${label} rate limit hit — please wait a moment and try again.`,
            429,
            'PROVIDER_RATE_LIMITED',
        );
    }

    if (status === 503 || status === 529 || lower.includes('overloaded')) {
        return new AppError(
            `${label} is temporarily overloaded. Please try again in a moment.`,
            503,
            'PROVIDER_OVERLOADED',
        );
    }

    const isUnknownModel = status === 404
        || lower.includes('model not found')
        || lower.includes('does not exist')
        || lower.includes('unknown model');
    if (isUnknownModel) {
        return new AppError(
            `Model is not available on ${label}.`,
            400,
            'UNKNOWN_MODEL',
        );
    }

    if (err?.code === 'context_length_exceeded' || lower.includes('context length') || lower.includes('maximum context')) {
        return new AppError(
            rawMessage || `Message is too long for this model's context window.`,
            400,
            'CONTEXT_LENGTH_EXCEEDED',
        );
    }

    return new AppError(
        `${label}: ${rawMessage || 'request failed'}`,
        502,
        'LLM_PROVIDER_ERROR',
    );
}

export async function runProvider<T>(provider: LLMProvider, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        throw translateProviderError(err, provider);
    }
}

// What withRetry retries, including what the SDKs retried before their retries were turned off.

// Same set for every provider, Gemini included.
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

// Socket failures mid-body bypass the SDKs' APIConnectionError and often arrive wrapped as `cause`,
// hence the cause-chain walk. ETIMEDOUT is the OS's socket timeout, not our request timeout.
const SOCKET_ERROR_CODES: ReadonlySet<string> = new Set([
    'ECONNRESET', // "socket hang up", "read ECONNRESET"
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EAI_AGAIN', // a DNS lookup that failed transiently
    'UND_ERR_SOCKET', // undici "other side closed", the cause behind "terminated"
    'ERR_STREAM_PREMATURE_CLOSE', // node-fetch 2: "Premature close", the body cut short
]);

const hasSocketErrorCode = (err: any): boolean => {
    for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
        if (typeof e.code === 'string' && SOCKET_ERROR_CODES.has(e.code)) return true;
    }
    return false;
};

// Timeouts and aborts are never retried: three 120 s attempts would outlast the conversation lock's
// 5-minute backstop.
const isTimeoutOrAbort = (err: any): boolean =>
    err instanceof ProviderStreamStalledError
    || err instanceof OpenAIConnectionTimeoutError
    || err instanceof AnthropicConnectionTimeoutError
    || err instanceof OpenAIUserAbortError
    || err instanceof AnthropicUserAbortError
    // Gemini has no abort class; its aborts surface as the platform's AbortError.
    || err?.name === 'AbortError'
    || err?.name === 'TimeoutError';

// Gemini doesn't wrap fetch errors, so its raw "fetch failed" counts like the SDKs' APIConnectionError.
const isConnectionFailure = (err: any): boolean => {
    if (err instanceof OpenAIConnectionError || err instanceof AnthropicConnectionError) return true;
    if (err instanceof TypeError && err.message === 'fetch failed') return true;
    return hasSocketErrorCode(err);
};

export const isRetryableProviderError = (err: any): boolean => {
    if (isTimeoutOrAbort(err)) return false;
    const status = err?.status ?? err?.response?.status;
    return RETRYABLE_STATUSES.has(status)
        // An Anthropic overload mid-stream is thrown with no status.
        || String(err?.message).toLowerCase().includes('overloaded')
        || isConnectionFailure(err);
};

// Cap on a provider's retry-after: the backoff holds the conversation lock while the participant waits.
export const RETRY_AFTER_CAP_MS = 10_000;

// Headers may be a fetch Headers or a plain object (older OpenAI SDK). Gemini errors have none.
const headerOf = (err: any, name: string): string | undefined => {
    const headers = err?.headers;
    if (!headers) return undefined;
    const value = typeof headers.get === 'function' ? headers.get(name) : headers[name];
    return value == null ? undefined : String(value);
};

// retry-after-ms first, then retry-after as seconds or an HTTP date. undefined if absent or not positive.
export const retryAfterMs = (err: any): number | undefined => {
    const ms = parseFloat(headerOf(err, 'retry-after-ms') ?? '');
    if (Number.isFinite(ms) && ms > 0) return ms;
    const raw = headerOf(err, 'retry-after');
    if (raw === undefined) return undefined;
    const seconds = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : undefined;
    const until = Date.parse(raw) - Date.now();
    return Number.isFinite(until) && until > 0 ? until : undefined;
};

// On a mutable object so the wait can be replaced without sleeping.
export const retryTiming = {
    sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

// `canRetry` is checked before each retry. Streams say no once text was sent: a retry restarts the
// reply from its first token, so it would be shown or saved twice. Wait: retry-after (capped), else 1 s, 2 s.
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, canRetry?: () => boolean): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            if (!isRetryableProviderError(err) || attempt === maxAttempts || (canRetry && !canRetry())) throw err;
            const status = err?.status ?? err?.response?.status;
            const asked = retryAfterMs(err);
            const delay = asked !== undefined ? Math.min(asked, RETRY_AFTER_CAP_MS) : 1000 * Math.pow(2, attempt - 1);
            console.warn(`LLM request failed (attempt ${attempt}/${maxAttempts}, status ${status}). Retrying in ${delay}ms...`);
            await retryTiming.sleep(delay);
        }
    }
    throw lastError;
}

// Tracks whether a stream has sent text. Create once per completion, outside withRetry, so it outlives
// attempts. Empty chunks are forwarded but don't block a retry. Marked before the callback runs.
export const trackStreamEmission = (onStreamChunk?: (chunk: string) => Promise<void>) => {
    let emitted = false;
    return {
        forward: async (chunk: string): Promise<void> => {
            if (!onStreamChunk) return;
            if (chunk) emitted = true;
            await onStreamChunk(chunk);
        },
        canRetry: (): boolean => !emitted,
    };
};

// Per SDK, whether a stream part carries reply text. Other parts (role-only, thinking, finish-only)
// mean the model is still working.
export const PART_CARRIES_TEXT = {
    openai: (part: any): boolean => !!part?.choices?.[0]?.delta?.content,
    // Responses API: only output_text deltas are reply text.
    openaiResponses: (event: any): boolean => event?.type === 'response.output_text.delta' && !!event?.delta,
    anthropic: (event: any): boolean => event?.type === 'content_block_delta' && !!event?.delta?.text,
    google: (chunk: any): boolean => !!chunk?.text,
};

// Thrown only by watchStream. Its own class so it is never retried and maps to a timeout.
export class ProviderStreamStalledError extends Error {
    constructor(silentMs: number, textBegun: boolean) {
        super(
            textBegun
                ? `the stream stopped: nothing for ${silentMs} ms mid-reply`
                : `no reply text: nothing for ${silentMs} ms`,
        );
        this.name = 'ProviderStreamStalledError';
    }
}

export interface StreamWatch {
    // Pass to the SDK request; the watchdog aborts through it.
    signal: AbortSignal;
    // Wraps the SDK stream. The clock runs only while waiting on the provider: the before-text limit
    // until a part carries text, then the idle limit.
    parts<P>(source: AsyncIterable<P>, carriesText: (part: P) => boolean): AsyncIterable<P>;
}

// Runs one streamed attempt under the watchdog; `beforeTextMs` overrides the before-text limit.
// On timeout it aborts and throws its own error, because the OpenAI SDK (and sometimes Anthropic's)
// just ends an aborted stream, which would return a partial reply as complete.
export async function watchStream<T>(run: (watch: StreamWatch) => Promise<T>, beforeTextMs?: number): Promise<T> {
    const controller = new AbortController();
    let stalled: ProviderStreamStalledError | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let textBegun = false;

    const disarm = () => clearTimeout(timer);
    // Start the clock at the limit for this stage of the reply.
    const arm = () => {
        disarm();
        const ms = textBegun ? streamTiming.idleMs : (beforeTextMs ?? streamTiming.beforeTextMs);
        timer = setTimeout(() => {
            stalled = new ProviderStreamStalledError(ms, textBegun);
            console.warn(`[provider] ${stalled.message} — aborting the request (REVIEW B5)`);
            controller.abort();
        }, ms);
    };

    async function* parts<P>(source: AsyncIterable<P>, carriesText: (part: P) => boolean): AsyncGenerator<P> {
        for await (const part of source) {
            // Clock stays stopped while the caller handles the part.
            disarm();
            // Abort raced a part: the attempt fails anyway, so show nothing more.
            if (stalled) return;
            if (carriesText(part)) textBegun = true;
            yield part;
            arm();
        }
    }

    arm();
    try {
        const result = await run({ signal: controller.signal, parts });
        // OpenAI ends an aborted stream quietly; only the flag marks it as cut.
        if (stalled) throw stalled;
        return result;
    } catch (err) {
        // Whatever the SDK made of the abort, it was ours.
        throw stalled ?? err;
    } finally {
        disarm();
    }
}

export async function createChatCompletion(
    apiKey: string,
    provider: LLMProvider,
    chatRequest: any,
    stream: boolean,
    onStreamChunk?: (chunk: string) => Promise<void>,
): Promise<string> {
    switch (provider) {
        case 'openai':
            // Responses-only models.
            if (isOpenAIResponsesOnly(chatRequest.model)) {
                return openAIResponsesCompletion(apiKey, responsesParamsFromChat(openAIParams(chatRequest)), stream, trackStreamEmission(onStreamChunk));
            }
            return openAIChatCompletion(apiKey, 'openai', chatRequest, stream, onStreamChunk);
        case 'xai':
            return openAIChatCompletion(apiKey, 'xai', chatRequest, stream, onStreamChunk);
        case 'openrouter':
            return openAIChatCompletion(apiKey, 'openrouter', chatRequest, stream, onStreamChunk);
        case 'anthropic':
            return anthropicChatCompletion(apiKey, chatRequest, stream, onStreamChunk);
        case 'google':
            return googleChatCompletion(apiKey, chatRequest, stream, onStreamChunk);
    }
}

async function openAIChatCompletion(
    apiKey: string,
    provider: LLMProvider,
    chatRequest: any,
    stream: boolean,
    onStreamChunk?: (chunk: string) => Promise<void>,
): Promise<string> {
    const client = makeOpenAIClient(apiKey, provider);
    const params = provider === 'openrouter' ? openRouterParams(chatRequest) : openAIParams(chatRequest);

    const emission = trackStreamEmission(onStreamChunk);
    return runProvider(provider, () => withRetry(async () => {
        if (!stream) {
            const response = await client.chat.completions.create(params);
            return response.choices[0].message.content?.trim() || '';
        }

        return watchStream(async (watch) => {
            const responseStream = await client.chat.completions.create({ ...params, stream: true }, { signal: watch.signal }) as any;
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

// Responses API body, built from the chat body so -pro agents get the same context. System turns stay
// in place in `input` (not `instructions`), empty turns are dropped, and store: false stops OpenAI
// keeping responses for 30 days.
export const responsesParamsFromChat = (chatParams: any): any => {
    const params: any = {
        model: chatParams.model,
        input: (chatParams.messages as any[])
            .filter((m) => typeof m.content === 'string' && m.content !== '')
            .map((m) => ({ role: m.role, content: m.content })),
    };
    if (chatParams.max_completion_tokens != null) params.max_output_tokens = chatParams.max_completion_tokens;
    params.store = false;
    return params;
};

// The SDK doesn't throw for a failed response (a 200 with status 'failed', or a `response.failed`
// event). Raised as a statusless APIError so it's handled like an in-band stream error.
const responsesFailure = (response: any): Error => {
    const error = response?.error ?? {};
    return new OpenAIAPIError(undefined, { code: error.code, message: error.message || 'the response failed' }, undefined, undefined);
};

// Responses call for 1-1 and group. Wrapped like the chat path, with RESPONSES_ONLY_TIMEOUT_MS.
export async function openAIResponsesCompletion(
    apiKey: string,
    params: any,
    stream: boolean,
    emission: ReturnType<typeof trackStreamEmission>,
): Promise<string> {
    const client = makeOpenAIClient(apiKey, 'openai', { timeout: RESPONSES_ONLY_TIMEOUT_MS });

    return runProvider('openai', () => withRetry(async () => {
        if (!stream) {
            const response: any = await client.responses.create(params);
            if (response.status === 'failed') throw responsesFailure(response);
            return response.output_text?.trim() || '';
        }

        return watchStream(async (watch) => {
            const responseStream = await client.responses.create({ ...params, stream: true }, { signal: watch.signal }) as any;
            let full = '';
            for await (const event of watch.parts<any>(responseStream, PART_CARRIES_TEXT.openaiResponses)) {
                if (event.type === 'response.failed') throw responsesFailure(event.response);
                // Forward only reply text, not the many lifecycle events.
                if (event.type !== 'response.output_text.delta' || !event.delta) continue;
                await emission.forward(event.delta);
                full += event.delta;
            }
            return full;
        }, streamTiming.responsesOnlyBeforeTextMs);
    }, undefined, emission.canRetry));
}

const openRouterParams = (chatRequest: any): any => ({
    model: chatRequest.model,
    messages: openRouterMessages(chatRequest.model, chatRequest.messages),
    ...openRouterBody(chatRequest.model, chatRequest),
});

const openAIParams = (chatRequest: any): any => {
    const restricted = isOpenAIRestricted(chatRequest.model);
    const grok = isGrokReasoning(chatRequest.model);

    // Only OpenAI-supported parameters.
    const params: any = {
        model: chatRequest.model,
        messages: chatRequest.messages,
    };

    // Always max_completion_tokens: gpt-5 and o-series reject max_tokens. Reasoning models get the floor.
    if (restricted || grok) {
        params.max_completion_tokens = REASONING_OUTPUT_FLOOR;
    } else if (chatRequest.max_tokens != null) {
        params.max_completion_tokens = chatRequest.max_tokens;
    }

    // Restricted models accept only default sampling. Grok-4 rejects penalties and stop.
    if (!restricted) {
        if (chatRequest.temperature != null) params.temperature = chatRequest.temperature;
        if (chatRequest.top_p != null) params.top_p = chatRequest.top_p;
        if (!grok) {
            if (chatRequest.frequency_penalty != null) params.frequency_penalty = chatRequest.frequency_penalty;
            if (chatRequest.presence_penalty != null) params.presence_penalty = chatRequest.presence_penalty;
            if (chatRequest.stop) params.stop = chatRequest.stop;
        }
    }

    return params;
};

async function anthropicChatCompletion(
    apiKey: string,
    chatRequest: any,
    stream: boolean,
    onStreamChunk?: (chunk: string) => Promise<void>,
): Promise<string> {
    const client = new Anthropic({ apiKey, ...COMPLETION_CLIENT_OPTIONS });

    const systemMessages = chatRequest.messages.filter((m: any) => m.role === 'system');
    const nonSystemMessages = chatRequest.messages.filter((m: any) => m.role !== 'system');
    const systemPrompt = systemMessages.map((m: any) => m.content).filter(Boolean).join('\n');

    const mergedMessages = mergeConsecutiveMessages(nonSystemMessages);

    // Anthropic requires the first message to be 'user'.
    while (mergedMessages.length > 0 && mergedMessages[0].role === 'assistant') {
        mergedMessages.shift();
    }

    const mappedMessages = mergedMessages
        .map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        }))
        .filter((m: any) => m.content);

    const params: any = {
        model: chatRequest.model,
        // Default-thinking models get the floor so reasoning doesn't starve the reply.
        max_tokens: isAnthropicDefaultThinking(chatRequest.model)
            ? REASONING_OUTPUT_FLOOR
            : (chatRequest.max_tokens || 1024),
        messages: mappedMessages,
    };

    if (systemPrompt) params.system = systemPrompt;
    // Temperature or top_p, never both; neither if the model refuses them.
    Object.assign(params, anthropicSamplingFor(chatRequest.model, chatRequest.temperature, chatRequest.top_p));
    if (chatRequest.stop) params.stop_sequences = chatRequest.stop;

    const emission = trackStreamEmission(onStreamChunk);
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

async function googleChatCompletion(
    apiKey: string,
    chatRequest: any,
    stream: boolean,
    onStreamChunk?: (chunk: string) => Promise<void>,
): Promise<string> {
    const systemMessages = chatRequest.messages.filter((m: any) => m.role === 'system');
    const nonSystemMessages = chatRequest.messages.filter((m: any) => m.role !== 'system');
    const systemInstruction = systemMessages.map((m: any) => m.content).filter(Boolean).join('\n');

    // Send the last non-empty user message; the array ends with an empty assistant prime.
    let sendMessageIndex = -1;
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
        if (nonSystemMessages[i].role === 'user' && nonSystemMessages[i].content) {
            sendMessageIndex = i;
            break;
        }
    }

    if (sendMessageIndex === -1) {
        return '';
    }

    const userMessageToSend = nonSystemMessages[sendMessageIndex];

    // Everything before it, in Gemini format.
    const history = nonSystemMessages.slice(0, sendMessageIndex)
        .map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content || '' }],
        }))
        .filter((m: any) => m.parts[0].text);

    // Gemini requires the first message to be 'user'.
    while (history.length > 0 && history[0].role === 'model') {
        history.shift();
    }

    const generationConfig: any = {};
    if (chatRequest.temperature != null) generationConfig.temperature = chatRequest.temperature;
    if (chatRequest.top_p != null) generationConfig.topP = chatRequest.top_p;
    // Thinking models get the floor; otherwise the agent's value, else 2048.
    generationConfig.maxOutputTokens = geminiMaxOutputTokens(
        chatRequest.model,
        chatRequest.max_tokens != null ? chatRequest.max_tokens : 2048,
    );

    return geminiCompletion(
        apiKey,
        {
            model: chatRequest.model,
            systemInstruction: systemInstruction || undefined,
            history,
            message: userMessageToSend.content,
            generationConfig,
        },
        stream,
        trackStreamEmission(onStreamChunk),
    );
}

export function mergeConsecutiveMessages(messages: any[]): any[] {
    const merged: any[] = [];
    for (const msg of messages) {
        if (!msg.content) continue;
        const last = merged[merged.length - 1];
        if (last && last.role === msg.role) {
            last.content += '\n' + msg.content;
        } else {
            merged.push({ ...msg });
        }
    }
    return merged;
}

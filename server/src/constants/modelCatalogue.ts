import { LLMProvider } from '../types';

// The models a researcher may pick, validated server-side on save.
// `provider` is explicit and must agree with getProviderFromModel's prefix rule: the picker
// filters on this, but the prefix picks the SDK at chat time.
export interface CatalogueModel {
    id: string;
    provider: LLMProvider;
    // OpenRouter models only.
    openrouter?: OpenRouterRoute;
}

// The sampling settings Lexi can send, in OpenRouter's own names.
export type OpenRouterParam = 'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty' | 'stop' | 'max_tokens';

// Each OpenRouter model is pinned to one host with no fallbacks, since hosts serve different
// builds (fp4, fp8, full) and participants must all get the same model.
// `params`: what that host honours. Requests set require_parameters, so sending anything else
// fails the turn; only these are sent.
// `reasonsByDefault`: max_tokens is raised to REASONING_OUTPUT_FLOOR, or a small cap returns empty.
export interface OpenRouterRoute {
    host: string;
    params: readonly OpenRouterParam[];
    reasonsByDefault: boolean;
}

const ALL_SAMPLING: readonly OpenRouterParam[] = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'max_tokens'];

// Order is the picker's order, newest first within each family. A model stays listed until it
// is shut down or about to be; agents already on a removed model keep it (add it to REMOVED_MODELS).
// Upcoming shutdowns: gpt-5/-mini/-nano 2026-12-11; claude-sonnet-4-5-20250929 2026-11-30;
// gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini 2027-01-14.
export const MODEL_CATALOGUE: readonly CatalogueModel[] = [
    // OpenAI - GPT-6 class. Reasoning models: no sampling setting is sent (isOpenAIRestricted).
    { id: 'gpt-6-astra', provider: 'openai' },
    { id: 'gpt-6.1-sol', provider: 'openai' },
    { id: 'gpt-6-sol', provider: 'openai' },
    { id: 'gpt-6-luna', provider: 'openai' },
    // OpenAI - GPT-5 class
    { id: 'gpt-5.5', provider: 'openai' },
    { id: 'gpt-5.4-pro', provider: 'openai' },
    { id: 'gpt-5.4', provider: 'openai' },
    { id: 'gpt-5.4-mini', provider: 'openai' },
    { id: 'gpt-5.4-nano', provider: 'openai' },
    { id: 'gpt-5.2', provider: 'openai' },
    { id: 'gpt-5.2-pro', provider: 'openai' },
    { id: 'gpt-5.1', provider: 'openai' },
    { id: 'gpt-5', provider: 'openai' },
    { id: 'gpt-5-mini', provider: 'openai' },
    { id: 'gpt-5-nano', provider: 'openai' },
    // OpenAI - GPT-4 class
    { id: 'gpt-4.1', provider: 'openai' },
    { id: 'gpt-4.1-mini', provider: 'openai' },
    { id: 'gpt-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', provider: 'openai' },
    // Anthropic - Claude 5. Reason by default, and refuse temperature and top_p
    // (isAnthropicDefaultThinking, isAnthropicNoSampling).
    { id: 'claude-opus-5-5', provider: 'anthropic' },
    { id: 'claude-sonnet-5-5', provider: 'anthropic' },
    { id: 'claude-haiku-5-5', provider: 'anthropic' },
    // Anthropic - Claude 4
    { id: 'claude-opus-4-6', provider: 'anthropic' },
    { id: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    { id: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
    // Google - Gemini 4 and 3 series (all thinking models — geminiMaxOutputTokens)
    { id: 'gemini-4-argon', provider: 'google' },
    { id: 'gemini-3.8-flash', provider: 'google' },
    { id: 'gemini-3.6-flash', provider: 'google' },
    { id: 'gemini-3.5-flash-lite', provider: 'google' },
    { id: 'gemini-3.1-flash-lite', provider: 'google' },
    { id: 'gemini-3.1-pro-preview', provider: 'google' },
    { id: 'gemini-3-flash-preview', provider: 'google' },
    // xAI
    { id: 'grok-4.7', provider: 'xai' },
    { id: 'grok-4.3', provider: 'xai' },

    // OpenRouter: the slash in the id routes it here. Each is pinned to its maker's host except
    // Llama and DeepSeek. The newest OpenAI and Anthropic models take no temperature or top_p.
    //
    // OpenRouter - older models (temperature works on all of these)
    { id: 'openai/gpt-4o-mini', provider: 'openrouter', openrouter: { host: 'openai', params: ALL_SAMPLING, reasonsByDefault: false } },
    { id: 'openai/gpt-4o', provider: 'openrouter', openrouter: { host: 'openai', params: ALL_SAMPLING, reasonsByDefault: false } },
    { id: 'openai/gpt-4.1', provider: 'openrouter', openrouter: { host: 'openai', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: false } },
    { id: 'openai/gpt-4.1-mini', provider: 'openrouter', openrouter: { host: 'openai', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: false } },
    { id: 'anthropic/claude-sonnet-4.5', provider: 'openrouter', openrouter: { host: 'anthropic', params: ['temperature', 'top_p', 'stop', 'max_tokens'], reasonsByDefault: false } },
    { id: 'anthropic/claude-haiku-4.5', provider: 'openrouter', openrouter: { host: 'anthropic', params: ['temperature', 'top_p', 'stop', 'max_tokens'], reasonsByDefault: false } },
    { id: 'x-ai/grok-4.3', provider: 'openrouter', openrouter: { host: 'xai', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: true } },
    // OpenRouter - current models
    { id: 'openai/gpt-6.1-sol', provider: 'openrouter', openrouter: { host: 'openai', params: ['max_tokens'], reasonsByDefault: true } },
    { id: 'openai/gpt-6-luna', provider: 'openrouter', openrouter: { host: 'openai', params: ['max_tokens'], reasonsByDefault: true } },
    { id: 'anthropic/claude-opus-5.5', provider: 'openrouter', openrouter: { host: 'anthropic', params: ['stop', 'max_tokens'], reasonsByDefault: true } },
    { id: 'anthropic/claude-sonnet-5.5', provider: 'openrouter', openrouter: { host: 'anthropic', params: ['stop', 'max_tokens'], reasonsByDefault: true } },
    { id: 'anthropic/claude-haiku-5.5', provider: 'openrouter', openrouter: { host: 'anthropic', params: ['stop', 'max_tokens'], reasonsByDefault: true } },
    { id: 'google/gemini-4-argon', provider: 'openrouter', openrouter: { host: 'google-ai-studio', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: true } },
    { id: 'google/gemini-3.8-flash', provider: 'openrouter', openrouter: { host: 'google-ai-studio', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: true } },
    { id: 'google/gemini-3.6-flash', provider: 'openrouter', openrouter: { host: 'google-ai-studio', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: true } },
    { id: 'google/gemini-3.5-flash-lite', provider: 'openrouter', openrouter: { host: 'google-ai-studio', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: false } },
    { id: 'x-ai/grok-4.7', provider: 'openrouter', openrouter: { host: 'xai', params: ['temperature', 'top_p', 'max_tokens'], reasonsByDefault: true } },
    // Rejected: mistral-small-2603 (shared pool rate-limited) and qwen3.7-flash (~2000 hidden
    // reasoning tokens a reply).
    // OpenRouter - open-weight models.
    // - Llama: Meta hosts nothing; Parasail is the only host honouring every setting (fp8).
    // - DeepSeek: its own host may train on prompts, so data_collection 'deny' excludes it.
    // reasonsByDefault on these four was measured.
    { id: 'meta-llama/llama-4-maverick', provider: 'openrouter', openrouter: { host: 'parasail', params: ALL_SAMPLING, reasonsByDefault: false } },
    { id: 'deepseek/deepseek-v4.1-flash', provider: 'openrouter', openrouter: { host: 'together', params: ALL_SAMPLING, reasonsByDefault: true } },
    { id: 'mistralai/mistral-large-4-0', provider: 'openrouter', openrouter: { host: 'mistral', params: ALL_SAMPLING, reasonsByDefault: true } },
    { id: 'qwen/qwen3.8-flash', provider: 'openrouter', openrouter: { host: 'alibaba', params: ALL_SAMPLING, reasonsByDefault: true } },
];

// Why a model left MODEL_CATALOGUE, shown in the login alert for agents still using it.
// Add an entry whenever a model is removed; unlisted ones get REMOVED_FALLBACK_REASON.
export interface RemovedModel {
    removedOn: string;
    reason: string;
}

export const REMOVED_MODELS: Readonly<Record<string, RemovedModel>> = {
    'gpt-4.1-nano': { removedOn: '2026-10-15', reason: 'OpenAI shut this model down on 2026-10-23.' },
    'gemini-2.5-pro': { removedOn: '2026-10-15', reason: 'Google closed the Gemini 2.5 models to new projects and is retiring them.' },
    'gemini-2.5-flash': { removedOn: '2026-10-15', reason: 'Google closed the Gemini 2.5 models to new projects and is retiring them.' },
    'gemini-2.5-flash-lite': { removedOn: '2026-10-15', reason: 'Google closed the Gemini 2.5 models to new projects and is retiring them.' },
    'gemini-3.1-flash-lite-preview': { removedOn: '2026-10-15', reason: 'Google shut this preview model down on 2026-05-25.' },
    'openai/gpt-4.1-nano': { removedOn: '2026-10-15', reason: 'OpenAI shut this model down on 2026-10-23, so OpenRouter can no longer serve it.' },
    'google/gemini-2.5-flash': { removedOn: '2026-10-15', reason: 'OpenRouter stopped serving the Gemini 2.5 models on 2026-10-20.' },
    'google/gemini-2.5-flash-lite': { removedOn: '2026-10-15', reason: 'OpenRouter stopped serving the Gemini 2.5 models on 2026-10-20.' },
};

export const REMOVED_FALLBACK_REASON = "This model is no longer in Lexi's model list.";

export const MODEL_BY_ID: ReadonlyMap<string, CatalogueModel> = new Map(
    MODEL_CATALOGUE.map((entry) => [entry.id, entry]),
);

export const MODEL_IDS: ReadonlySet<string> = new Set(MODEL_CATALOGUE.map((entry) => entry.id));

export const getCatalogueModel = (modelId: unknown): CatalogueModel | undefined =>
    typeof modelId === 'string' ? MODEL_BY_ID.get(modelId) : undefined;

// Takes `unknown`: callers pass raw request-body values.
export const isKnownModel = (modelId: unknown): boolean => typeof modelId === 'string' && MODEL_IDS.has(modelId);

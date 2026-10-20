// Wording for settings a model ignores (the server's ignoredSettings), shared by the model
// picker "!" and the notice under the sliders. React-free so it can be tested without a DOM.
import { CatalogueModel } from '@models/AppModels';

// Form labels for the server's setting names, in form order.
export const SETTING_LABELS: [string, string][] = [
    ['temperature', 'Temperature'],
    ['max_tokens', 'Max tokens'],
    ['top_p', 'Top p'],
    ['frequency_penalty', 'Frequency penalty'],
    ['presence_penalty', 'Presence penalty'],
    ['stop', 'Stop sequences'],
];

export const ignoredSettingLabels = (entry: CatalogueModel | undefined): string[] => {
    const ignored = (entry && entry.ignoredSettings) || [];
    return SETTING_LABELS.filter(([setting]) => ignored.indexOf(setting) !== -1).map(([, label]) => label);
};

/** Reasoning models: Max tokens is replaced by a fixed budget. */
export const replacesMaxTokens = (entry: CatalogueModel | undefined): boolean =>
    !!entry && (entry.ignoredSettings || []).indexOf('max_tokens') !== -1;

/** Hover text for the picker "!"; undefined when nothing is ignored. */
export const ignoredSettingsHint = (entry: CatalogueModel | undefined): string | undefined => {
    const labels = ignoredSettingLabels(entry);
    if (labels.length === 0) return undefined;
    return `Lexi can't apply every setting to this model: ${labels.join(', ')}. You can still choose it.`;
};

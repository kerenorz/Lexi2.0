// Model picker for the agent form, fed by the server catalogue. Unusable models stay listed,
// greyed, with the reason. Order: allowedModels filters what is visible; valid keys decide what
// is selectable; a provider step appears only when more than one provider is usable.
// Same Autocomplete setup as AgentPicker.
import { getModelCatalogue } from '@DAL/server-requests/agents';
import { getApiKeys } from '@DAL/server-requests/apiKeys';
import { CatalogueModel, ModelProvider } from '@models/AppModels';
import SearchIcon from '@mui/icons-material/Search';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Autocomplete, Box, TextField, Tooltip, Typography } from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';
import { ignoredSettingsHint } from './modelSettings';

// A row in either dropdown.
interface PickerOption {
    id: string;
    // Caption after the id (the provider, for a model).
    subtitle?: string;
    // Why the row can't be chosen. Present: greyed, tooltip, click rejected.
    reason?: string;
    // Settings this model ignores, shown on a "!". Row stays selectable.
    hint?: string;
}

const noKeyReason = (provider: string): string => `No API key for ${provider} - add one in Settings`;

interface ModelPickerProps {
    // The saved model id; '' when nothing is picked yet.
    value: string;
    onChange: (modelId: string) => void;
    // The account's limits.allowedModels. Absent/empty => unrestricted.
    allowedModels?: string[];
    error?: boolean;
    disabled?: boolean;
    minWidth?: number;
    placeholder?: string;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
    value,
    onChange,
    allowedModels,
    error = false,
    disabled = false,
    minWidth = 280,
    placeholder = 'Type a model name…',
}) => {
    const [catalogue, setCatalogue] = useState<CatalogueModel[]>([]);
    const [keyedProviders, setKeyedProviders] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    // null until the effect below seeds it.
    const [provider, setProvider] = useState<ModelProvider | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [models, keys] = await Promise.all([getModelCatalogue(), getApiKeys()]);
                if (cancelled) return;
                setCatalogue(models);
                // Only valid keys count; an invalid one would fail in front of a participant.
                setKeyedProviders(keys.filter((key) => key.isValid).map((key) => key.provider));
            } catch (e) {
                if (!cancelled) setLoadFailed(true);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    // Step 1: the account restriction.
    const allowed = useMemo(() => {
        if (!Array.isArray(allowedModels) || allowedModels.length === 0) return catalogue;
        return catalogue.filter((model) => allowedModels.indexOf(model.id) !== -1);
    }, [catalogue, allowedModels]);

    const hasKey = (p: string): boolean => keyedProviders.indexOf(p) !== -1;

    // Providers that still own at least one offerable model, in catalogue order.
    const providersInAllowed = useMemo(() => {
        const seen: ModelProvider[] = [];
        allowed.forEach((model) => {
            if (seen.indexOf(model.provider) === -1) seen.push(model.provider);
        });
        return seen;
    }, [allowed]);

    // Steps 2 and 3.
    const usableProviders = providersInAllowed.filter(hasKey);
    const showProviderStep = usableProviders.length > 1;

    // Start on the saved model's provider so it stays visible.
    useEffect(() => {
        if (!showProviderStep || provider) return;
        const current = catalogue.filter((model) => model.id === value)[0] || null;
        const seed =
            current && providersInAllowed.indexOf(current.provider) !== -1 ? current.provider : usableProviders[0];
        if (seed) setProvider(seed);
    }, [showProviderStep, provider, catalogue, value, providersInAllowed, usableProviders]);

    // A saved model missing from the list stays visible with the reason. Dropping it would leave
    // the field blank and the next save could silently change the model.
    const orphanOption = (id: string): PickerOption => {
        const known = catalogue.filter((model) => model.id === id)[0] || null;
        if (!known) return { id, reason: 'This model is no longer offered' };
        const hint = ignoredSettingsHint(known);
        if (!allowed.some((model) => model.id === id))
            return { id, subtitle: known.provider, reason: 'Not permitted for this account', hint };
        if (!hasKey(known.provider)) return { id, subtitle: known.provider, reason: noKeyReason(known.provider), hint };
        // Only hidden by the provider step; still selectable.
        return { id, subtitle: known.provider, hint };
    };

    const modelOptions: PickerOption[] = useMemo(() => {
        // Until loaded, show the saved id plainly rather than a false "no longer offered".
        if (isLoading || loadFailed) return value ? [{ id: value }] : [];
        const visible =
            showProviderStep && provider ? allowed.filter((model) => model.provider === provider) : allowed;
        const list: PickerOption[] = visible.map((model) => ({
            id: model.id,
            subtitle: model.provider,
            reason: hasKey(model.provider) ? undefined : noKeyReason(model.provider),
            hint: ignoredSettingsHint(model),
        }));
        if (value && !list.some((option) => option.id === value)) list.unshift(orphanOption(value));
        return list;
    }, [isLoading, loadFailed, allowed, showProviderStep, provider, keyedProviders, value]);

    const providerOptions: PickerOption[] = providersInAllowed.map((p) => ({
        id: p,
        reason: hasKey(p) ? undefined : noKeyReason(p),
    }));

    // Explains an empty or all-greyed list.
    const helperText = (() => {
        if (loadFailed) return 'Could not load the model list — reopen the form to retry.';
        if (isLoading) return undefined;
        if (keyedProviders.length === 0) return 'Add an API key in Settings to use a model.';
        if (usableProviders.length === 0)
            return 'None of the models allowed for this account has a valid API key — add one in Settings.';
        return undefined;
    })();

    const renderPickerOption = (props: React.HTMLAttributes<HTMLLIElement>, option: PickerOption) => {
        // MUI's disabled style kills pointer events and so the tooltip. Keep hover, drop the click.
        const liProps = option.reason
            ? { ...props, onClick: undefined, style: { pointerEvents: 'auto' as const } }
            : props;
        const row = (
            <span>
                {option.reason && (
                    <WarningAmberIcon
                        sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'text-bottom', color: 'warning.main' }}
                    />
                )}
                {option.id}
                {(option.subtitle || option.reason) && (
                    <Typography component="span" variant="caption" color="text.secondary">
                        {` — ${option.reason || option.subtitle}`}
                    </Typography>
                )}
            </span>
        );
        return (
            <li {...liProps} key={option.id}>
                {option.reason ? (
                    <Tooltip title={option.reason} arrow placement="left">
                        {row}
                    </Tooltip>
                ) : (
                    row
                )}
                {option.hint && (
                    // Separate tooltip: a model can be both unusable and partly configurable.
                    <Tooltip title={option.hint} arrow placement="right">
                        <Box
                            component="span"
                            aria-label={option.hint}
                            sx={{
                                ml: 0.75,
                                width: 15,
                                height: 15,
                                flexShrink: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '50%',
                                border: 1,
                                borderColor: 'info.main',
                                color: 'info.main',
                                fontSize: 11,
                                fontWeight: 700,
                                lineHeight: 1,
                            }}
                        >
                            !
                        </Box>
                    </Tooltip>
                )}
            </li>
        );
    };

    // Enter must not submit a surrounding <form> (see AgentPicker).
    const blockEnter = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') e.preventDefault();
    };

    const selectedModel = modelOptions.filter((option) => option.id === value)[0] || null;
    const selectedProvider = providerOptions.filter((option) => option.id === provider)[0] || null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth, width: '100%' }}>
            {showProviderStep ? (
                <Autocomplete
                    options={providerOptions}
                    value={selectedProvider}
                    disabled={disabled}
                    // A keyless provider is listed but can't be chosen.
                    onChange={(_, option: PickerOption | null) => {
                        if (!option || option.reason) return;
                        setProvider(option.id as ModelProvider);
                    }}
                    getOptionLabel={(option) => option.id}
                    isOptionEqualToValue={(option, val) => option.id === (val && val.id)}
                    getOptionDisabled={(option) => !!option.reason}
                    disableClearable
                    autoHighlight
                    onKeyDown={blockEnter}
                    size="small"
                    noOptionsText="No providers available"
                    selectOnFocus
                    handleHomeEndKeys
                    renderOption={renderPickerOption}
                    renderInput={(params) => <TextField {...params} label="Provider" />}
                />
            ) : (
                usableProviders.length === 1 && (
                    <Typography variant="caption" color="text.secondary">
                        {`Provider: ${usableProviders[0]}`}
                    </Typography>
                )
            )}
            <Autocomplete
                options={modelOptions}
                value={selectedModel}
                disabled={disabled}
                loading={isLoading}
                // Rows keep pointer events for the tooltip, so refuse unusable picks here too.
                onChange={(_, option: PickerOption | null) => {
                    if (!option || option.reason) return;
                    onChange(option.id);
                }}
                getOptionLabel={(option) => option.id}
                isOptionEqualToValue={(option, val) => option.id === (val && val.id)}
                getOptionDisabled={(option) => !!option.reason}
                // Ids are the labels, so a substring match on the id.
                filterOptions={(opts, state) => {
                    const query = state.inputValue.trim().toLowerCase();
                    if (!query) return opts;
                    return opts.filter((option) => option.id.toLowerCase().indexOf(query) !== -1);
                }}
                // Not freeSolo: the server rejects unknown model ids.
                disableClearable
                autoHighlight
                onKeyDown={blockEnter}
                size="small"
                noOptionsText="No matching models"
                selectOnFocus
                handleHomeEndKeys
                renderOption={renderPickerOption}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label="Model"
                        required
                        placeholder={placeholder}
                        error={error}
                        helperText={helperText}
                        InputProps={{
                            ...params.InputProps,
                            startAdornment: (
                                <>
                                    <SearchIcon fontSize="small" color="disabled" sx={{ ml: 1, mr: 0 }} />
                                    {params.InputProps.startAdornment}
                                </>
                            ),
                        }}
                    />
                )}
            />
        </Box>
    );
};

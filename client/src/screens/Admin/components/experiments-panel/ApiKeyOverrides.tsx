// Per-study choice of which of the account's keys is billed, per provider (Settings sets the
// default). One row per provider since rosters can mix providers; shown only when there is more
// than one key. A saved override whose key is gone stays visible. Hidden for someone else's study,
// since the listed keys would be the admin's.
import { ApiKeyPublic, getApiKeys } from '@DAL/server-requests/apiKeys';
import FieldInfo from '@components/common/FieldInfo';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';

const providerLabels: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    xai: 'xAI',
    openrouter: 'OpenRouter',
};

// Mirrors the server's fallback: the Settings default, else the oldest valid owned key, else a
// shared one. Owned before shared, so the named key is the one actually billed.
const activeKeyFor = (group: ApiKeyPublic[]): ApiKeyPublic | undefined => {
    const byAge = (a: ApiKeyPublic, b: ApiKeyPublic) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    const valid = group.filter((key) => key.isValid);
    const owned = valid.filter((key) => !key.granted).sort(byAge);
    const shared = valid.filter((key) => key.granted).sort(byAge);
    return owned.filter((key) => key.isDefault)[0] || owned[0] || shared[0];
};

/** Drop blanks; an empty map is the same thing as no map. Returns null for "none". */
export const normalizeApiKeyOverrides = (overrides: any): Record<string, string> | null => {
    if (!overrides || typeof overrides !== 'object') return null;
    const cleaned: Record<string, string> = {};
    Object.keys(overrides).forEach((provider) => {
        const keyId = overrides[provider];
        if (keyId) cleaned[provider] = String(keyId);
    });
    return Object.keys(cleaned).length ? cleaned : null;
};

interface ApiKeyOverridesProps {
    control: any;
    // False when an admin is editing someone else's study.
    ownedByCurrentUser: boolean;
}

export const ApiKeyOverrides = ({ control, ownedByCurrentUser }: ApiKeyOverridesProps) => {
    const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await getApiKeys();
                if (!cancelled) setKeys(data);
            } catch {
                // On failure, just hide the section; the active key still applies.
            } finally {
                if (!cancelled) setLoaded(true);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    // Selectable keys only: ended grants are excluded.
    const groups = useMemo(() => {
        const byProvider: Record<string, ApiKeyPublic[]> = {};
        keys.filter((key) => !key.grantExpired).forEach((key) => {
            (byProvider[key.provider] = byProvider[key.provider] || []).push(key);
        });
        return byProvider;
    }, [keys]);

    // All keys, ended grants included, to explain a dangling override.
    const keyById = useMemo(() => new Map(keys.map((key) => [key._id, key])), [keys]);

    if (!ownedByCurrentUser || !loaded) return null;

    return (
        <Controller
            name="apiKeyOverrides"
            control={control}
            render={({ field }) => {
                const value = field.value || {};
                // Providers with a choice, plus any the study already overrides, so a stale
                // override can still be cleared. Array.from, not spread: the compile target
                // can't spread a Set.
                const providers = Array.from(
                    new Set(Object.keys(groups).concat(Object.keys(value))),
                ).filter((provider) => (groups[provider]?.length ?? 0) > 1 || value[provider]);
                if (!providers.length) return <></>;

                return (
                    <>
                        <Typography
                            style={{
                                color: 'grey',
                                marginBottom: '4px',
                                marginTop: '8px',
                                borderBottom: '1px solid grey',
                            }}
                        >
                            API Key:
                        </Typography>
                        <Typography style={{ fontSize: '0.75rem', color: 'rgba(0, 0, 0, 0.6)', padding: '8px' }}>
                            * Which API key this study is charged to — your own, or one shared with you.
                            Leave it on the active key unless this study is funded separately.
                        </Typography>
                        {providers.map((provider) => {
                            const group = groups[provider] ?? [];
                            const fallback = activeKeyFor(group);
                            const selected = value[provider] || '';
                            const isDangling = !!selected && !group.some((key) => key._id === selected);
                            // Dangling: either deleted, or access ended (the owner can restore it).
                            const lapsed = isDangling ? keyById.get(selected) : undefined;
                            return (
                                <Box
                                    key={provider}
                                    sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, pl: 1 }}
                                >
                                    <Typography sx={{ minWidth: 110 }}>
                                        {providerLabels[provider] || provider}
                                    </Typography>
                                    <Select
                                        size="small"
                                        value={selected}
                                        displayEmpty
                                        sx={{ minWidth: 320 }}
                                        onChange={(event) => {
                                            const next = { ...value };
                                            if (event.target.value) next[provider] = event.target.value;
                                            else delete next[provider];
                                            field.onChange(next);
                                        }}
                                    >
                                        <MenuItem value="">
                                            {fallback
                                                ? `Active key (${fallback.name})`
                                                : 'Active key'}
                                        </MenuItem>
                                        {group.map((key) => (
                                            <MenuItem key={key._id} value={key._id} disabled={!key.isValid}>
                                                {`${key.name} — ${key.maskedKey}`}
                                                {/* Name who shared it. */}
                                                {key.granted
                                                    ? ` (shared by ${key.grantedByUsername || 'another account'})`
                                                    : ''}
                                                {key.isValid ? '' : ' (invalid)'}
                                            </MenuItem>
                                        ))}
                                        {isDangling && (
                                            <MenuItem value={selected} disabled>
                                                {lapsed?.grantExpired
                                                    ? `${lapsed.name} — access ended`
                                                    : 'Key no longer available'}
                                            </MenuItem>
                                        )}
                                    </Select>
                                    <FieldInfo
                                        text={`Charge this study's ${providerLabels[provider] || provider} usage to a specific key instead of the provider's active key. Changing it takes effect on the next message, including in sessions already running.`}
                                    />
                                    {isDangling && (
                                        <Typography variant="caption" style={{ color: '#b26a00' }}>
                                            {lapsed?.grantExpired
                                                ? `${lapsed.grantedByUsername || 'The owner'} ${
                                                      lapsed.grantEndedReason === 'revoked'
                                                          ? 'ended your access to'
                                                          : 'let your access run out on'
                                                  } this key. ${
                                                      fallback
                                                          ? `The study is billing to ${fallback.name} instead.`
                                                          : 'This study cannot send messages until you pick a key you can use, or are given access again.'
                                                  }`
                                                : fallback
                                                  ? 'This key is gone — the study is billing to the active key. Pick one to fix it.'
                                                  : 'This key is gone, and there is no other key to fall back to. This study cannot send messages until you add one.'}
                                        </Typography>
                                    )}
                                </Box>
                            );
                        })}
                    </>
                );
            }}
        />
    );
};

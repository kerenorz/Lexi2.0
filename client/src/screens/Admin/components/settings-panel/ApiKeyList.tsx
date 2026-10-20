// The API key list. "In use" shows which key is billed:
//   Active           the provider's key for every study that doesn't name its own.
//   Active (not set) nothing chosen, so the oldest key is used.
//   "N studies"      studies that name this key, whether or not it is active.
// Agents aren't shown: an agent picks a model (hence provider), never a key.
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    IconButton,
    Chip,
    Typography,
    Tooltip,
    CircularProgress,
    Box,
} from '@mui/material';
import Button from '@mui/material/Button';
import DeleteIcon from '@mui/icons-material/Delete';
import { ApiKeyPublic } from '@DAL/server-requests/apiKeys';
import { describeGrantExpiry } from '@root/utils/grantExpiry';

const providerLabels: Record<string, { label: string; color: 'primary' | 'secondary' | 'success' | 'warning' | 'info' }> = {
    openai: { label: 'OpenAI', color: 'primary' },
    anthropic: { label: 'Anthropic', color: 'secondary' },
    google: { label: 'Google', color: 'success' },
    xai: { label: 'xAI', color: 'warning' },
    openrouter: { label: 'OpenRouter', color: 'info' },
};

// Active key per provider, mirroring the server's resolveDecryptedKey: the chosen default,
// else the oldest owned valid key, else a granted one. A grant never overrides an owned key.
export const effectiveDefaults = (keys: ApiKeyPublic[]): Record<string, string> => {
    const byProvider: Record<string, ApiKeyPublic[]> = {};
    // Ended grants are listed but can never be billed.
    keys.filter((key) => key.isValid && !key.grantExpired).forEach((key) => {
        (byProvider[key.provider] = byProvider[key.provider] || []).push(key);
    });
    const chosen: Record<string, string> = {};
    Object.keys(byProvider).forEach((provider) => {
        const group = byProvider[provider];
        const byAge = (a: ApiKeyPublic, b: ApiKeyPublic) =>
            new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        const owned = group.filter((key) => !key.granted).sort(byAge);
        const granted = group.filter((key) => key.granted).sort(byAge);
        const winner = owned.filter((key) => key.isDefault)[0] || owned[0] || granted[0];
        if (winner) chosen[provider] = winner._id;
    });
    return chosen;
};

interface ApiKeyListProps {
    keys: ApiKeyPublic[];
    loading: boolean;
    onDelete: (keyId: string) => void;
    onSetDefault: (keyId: string) => void;
    // Opens the grant list for one of the account's own keys.
    onShowGrants?: (keyId: string) => void;
}

// Keys lent to this account. Read-only: the grantee can only spend them.
const GrantedKeys = ({ keys }: { keys: ApiKeyPublic[] }) => {
    const now = new Date();
    const anyEnded = keys.some((key) => key.grantExpired);
    return (
    <Box mt={3}>
        <Typography variant="subtitle2" gutterBottom>
            Shared with you
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Studies you run can bill to these keys until their access ends. You cannot view, change or
            share them.
            {anyEnded && ' Access that has ended stays listed, so a study that stops working says why.'}
        </Typography>
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell><b>Provider</b></TableCell>
                        <TableCell><b>Name</b></TableCell>
                        <TableCell><b>Key</b></TableCell>
                        <TableCell><b>Shared by</b></TableCell>
                        <TableCell><b>In use</b></TableCell>
                        <TableCell><b>Access</b></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {keys.map((key) => {
                        const prov = providerLabels[key.provider] || { label: key.provider, color: 'primary' as const };
                        const studies = key.usedByStudies || [];
                        const expiry = describeGrantExpiry(key.grantExpiresAt, now);
                        const ended = !!key.grantExpired;
                        return (
                            // Grey the whole row when access has ended.
                            <TableRow key={key._id} sx={ended ? { opacity: 0.6 } : undefined}>
                                <TableCell>
                                    <Chip label={prov.label} color={prov.color} size="small" variant="outlined" />
                                </TableCell>
                                <TableCell>{key.name}</TableCell>
                                <TableCell>
                                    <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                                        {key.maskedKey}
                                    </Typography>
                                </TableCell>
                                <TableCell>{key.grantedByUsername || '-'}</TableCell>
                                <TableCell>
                                    {studies.length > 0 && (
                                        <Tooltip title={studies.join(', ')}>
                                            <Chip
                                                label={`${studies.length} ${studies.length === 1 ? 'study' : 'studies'}`}
                                                size="small"
                                                variant="outlined"
                                            />
                                        </Tooltip>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {ended ? (
                                        <Tooltip
                                            title={
                                                key.grantEndedReason === 'revoked'
                                                    ? `${key.grantedByUsername || 'The owner'} ended this access. Studies billing to it have stopped.`
                                                    : 'This access ran out. Studies billing to it have stopped.'
                                            }
                                        >
                                            <Chip
                                                label={key.grantEndedReason === 'revoked' ? 'Revoked' : 'Expired'}
                                                size="small"
                                                color="error"
                                                variant="outlined"
                                            />
                                        </Tooltip>
                                    ) : (
                                        <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
                                            <Typography variant="body2">
                                                {key.grantExpiresAt
                                                    ? new Date(key.grantExpiresAt).toLocaleDateString()
                                                    : '-'}
                                            </Typography>
                                            {/* Only when the end is close. */}
                                            {expiry.soon && (
                                                <Tooltip title="Ask whoever shared this key to extend it before it runs out.">
                                                    <Chip
                                                        label={`ends ${expiry.label}`}
                                                        size="small"
                                                        color="warning"
                                                    />
                                                </Tooltip>
                                            )}
                                        </Box>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    </Box>
    );
};

export const ApiKeyList = ({ keys, loading, onDelete, onSetDefault, onShowGrants }: ApiKeyListProps) => {
    if (loading) {
        return (
            <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
            </Box>
        );
    }

    if (!keys.length) {
        return (
            <Box display="flex" justifyContent="center" py={4}>
                <Typography variant="body1" color="text.secondary">
                    No API keys added yet. Add a key to get started.
                </Typography>
            </Box>
        );
    }

    const billed = effectiveDefaults(keys);
    const owned = keys.filter((key) => !key.granted);
    const granted = keys.filter((key) => key.granted);

    // Own keys only: "Set active" is a choice among the account's own keys.
    const providerCounts: Record<string, number> = {};
    owned.forEach((key) => {
        providerCounts[key.provider] = (providerCounts[key.provider] || 0) + 1;
    });

    if (!owned.length) {
        return (
            <>
                <Box display="flex" justifyContent="center" py={4}>
                    <Typography variant="body1" color="text.secondary">
                        You have not added a key of your own. Studies you run bill to the keys shared with
                        you below.
                    </Typography>
                </Box>
                <GrantedKeys keys={granted} />
            </>
        );
    }

    return (
        <>
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell><b>Provider</b></TableCell>
                        <TableCell><b>Name</b></TableCell>
                        <TableCell><b>Key</b></TableCell>
                        <TableCell><b>Note</b></TableCell>
                        <TableCell><b>Status</b></TableCell>
                        <TableCell><b>In use</b></TableCell>
                        <TableCell><b>Created</b></TableCell>
                        <TableCell align="right"><b>Actions</b></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {owned.map((key) => {
                        const prov = providerLabels[key.provider] || { label: key.provider, color: 'primary' as const };
                        const isActive = billed[key.provider] === key._id;
                        const isOnlyKey = providerCounts[key.provider] === 1;
                        const studies = key.usedByStudies || [];
                        const sharedWith = key.grantedTo || [];
                        return (
                            <TableRow key={key._id}>
                                <TableCell>
                                    <Chip label={prov.label} color={prov.color} size="small" variant="outlined" />
                                </TableCell>
                                <TableCell>{key.name}</TableCell>
                                <TableCell>
                                    <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                                        {key.maskedKey}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {key.note || '-'}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={key.isValid ? 'Valid' : 'Invalid'}
                                        color={key.isValid ? 'success' : 'error'}
                                        size="small"
                                    />
                                </TableCell>
                                <TableCell>
                                    <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
                                        {isActive ? (
                                            <Tooltip
                                                title={
                                                    key.isDefault
                                                        ? `Every study uses this ${prov.label} key unless the study names another one.`
                                                        : `No ${prov.label} key has been chosen, so the oldest one is used. Choose one to make it explicit.`
                                                }
                                            >
                                                <Chip
                                                    label={key.isDefault ? 'Active' : 'Active (not set)'}
                                                    size="small"
                                                    color={key.isDefault ? 'primary' : 'warning'}
                                                    variant={key.isDefault ? 'filled' : 'outlined'}
                                                    // Clicking "not set" makes the choice explicit.
                                                    onClick={key.isDefault ? undefined : () => onSetDefault(key._id)}
                                                />
                                            </Tooltip>
                                        ) : (
                                            !isOnlyKey && (
                                                <Tooltip
                                                    title={
                                                        key.isValid
                                                            ? `Make this the active ${prov.label} key for every study that does not name its own.`
                                                            : 'A key that failed validation cannot be made active'
                                                    }
                                                >
                                                    <span>
                                                        <Button
                                                            size="small"
                                                            disabled={!key.isValid}
                                                            onClick={() => onSetDefault(key._id)}
                                                            sx={{ textTransform: 'none', minWidth: 0, px: 0.5 }}
                                                        >
                                                            Set active
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                            )
                                        )}
                                        {/* Independent of Active; both can show on one row. */}
                                        {studies.length > 0 && (
                                            <Tooltip title={studies.join(', ')}>
                                                <Chip
                                                    label={`${studies.length} ${studies.length === 1 ? 'study' : 'studies'}`}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            </Tooltip>
                                        )}
                                        {/* Who else can spend this key. */}
                                        {sharedWith.length > 0 && (
                                            <Tooltip title={`Shared with ${sharedWith.join(', ')} — click to manage`}>
                                                <Chip
                                                    label={`Shared with ${sharedWith.length}`}
                                                    size="small"
                                                    color="info"
                                                    variant="outlined"
                                                    onClick={onShowGrants ? () => onShowGrants(key._id) : undefined}
                                                />
                                            </Tooltip>
                                        )}
                                    </Box>
                                </TableCell>
                                <TableCell>
                                    {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : '-'}
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="Delete key">
                                        <IconButton size="small" color="error" onClick={() => onDelete(key._id)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
        {granted.length > 0 && <GrantedKeys keys={granted} />}
        </>
    );
};

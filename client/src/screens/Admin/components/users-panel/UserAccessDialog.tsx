// A researcher account's access: which shared keys it may spend, and which models it may use.
// allowedModels belongs to the agent's owner with no admin bypass (enforced in agentsController).
// The parent loads all lists before opening, so the first paint never shows stale "no access".
import {
    Alert,
    Autocomplete,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { ApiKeyGrant, ApiKeyPublic } from '@DAL/server-requests/apiKeys';
import { CatalogueModel } from '@models/AppModels';
import { describeGrantExpiry } from '@root/utils/grantExpiry';

// Shortcuts only; the date field still takes any date.
const DURATIONS = [
    { label: '1 week', days: 7 },
    { label: '1 month', days: 30 },
    { label: '3 months', days: 90 },
    { label: '6 months', days: 180 },
];

/** `YYYY-MM-DDTHH:mm` in LOCAL time, which is what a datetime-local input expects. */
const toInputValue = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
        date.getHours(),
    )}:${pad(date.getMinutes())}`;
};

const inDays = (days: number): string => toInputValue(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

interface UserAccessDialogProps {
    open: boolean;
    username: string;
    /** The granter's own keys. A granted key cannot be lent onward, so these are owned only. */
    keys: ApiKeyPublic[];
    /** Includes lapsed and revoked grants. */
    grants: ApiKeyGrant[];
    /** allowedModels: [] means unrestricted. */
    catalogue: CatalogueModel[];
    allowedModels: string[];
    onGrant: (keyId: string, expiresAt: string) => Promise<void>;
    onRevoke: (grantId: string) => void;
    onSaveModels: (allowedModels: string[]) => Promise<void>;
    onClose: () => void;
}

export const UserAccessDialog = ({
    open,
    username,
    keys,
    grants,
    catalogue,
    allowedModels,
    onGrant,
    onRevoke,
    onSaveModels,
    onClose,
}: UserAccessDialogProps) => {
    const [keyId, setKeyId] = useState('');
    const [expiresAt, setExpiresAt] = useState(inDays(30));
    const [saving, setSaving] = useState(false);
    const [models, setModels] = useState<string[]>(allowedModels);
    const [savingModels, setSavingModels] = useState(false);
    const now = new Date();

    // The dialog is reused across users without unmounting, so resync.
    useEffect(() => {
        setModels(allowedModels);
    }, [allowedModels, username]);

    const modelsDirty =
        models.length !== allowedModels.length || models.some((id) => !allowedModels.includes(id));

    const saveModels = async () => {
        setSavingModels(true);
        try {
            await onSaveModels(models);
        } finally {
            setSavingModels(false);
        }
    };

    // The server refuses a second live grant on a key, so don't offer it.
    const alreadyLent = useMemo(
        () => new Set(grants.filter((grant) => grant.isLive).map((grant) => grant.keyId)),
        [grants],
    );
    const available = useMemo(() => keys.filter((key) => !alreadyLent.has(key._id)), [keys, alreadyLent]);

    const submit = async () => {
        if (!keyId || !expiresAt) return;
        setSaving(true);
        try {
            // datetime-local has no zone; send an absolute ISO time.
            await onGrant(keyId, new Date(expiresAt).toISOString());
            setKeyId('');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Access for {username}</DialogTitle>
            <DialogContent>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Models this account may use
                </Typography>
                <DialogContentText sx={{ mb: 2 }}>
                    Leave this empty to allow every model. Otherwise their agents can only run the models
                    you list here — including when <strong>you</strong> edit their agents. To use another
                    model on one of their agents, add it here first.
                </DialogContentText>

                <Autocomplete
                    multiple
                    size="small"
                    options={catalogue.map((model) => model.id)}
                    groupBy={(id) => catalogue.find((model) => model.id === id)?.provider ?? ''}
                    value={models}
                    onChange={(_event, next) => setModels(next as string[])}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label={models.length ? 'Allowed models' : 'Allowed models — empty means all'}
                            placeholder="Add a model…"
                        />
                    )}
                />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    <Button
                        size="small"
                        variant="contained"
                        disabled={!modelsDirty || savingModels}
                        onClick={saveModels}
                    >
                        Save models
                    </Button>
                    {models.length === 0 && (
                        <Typography variant="caption" color="text.secondary">
                            Unrestricted — every model in the catalogue.
                        </Typography>
                    )}
                    {/* Narrowing the list doesn't change existing agents. */}
                    {modelsDirty && (
                        <Typography variant="caption" color="warning.main">
                            Applies when an agent is next saved; agents already built keep their model.
                        </Typography>
                    )}
                </Stack>

                <Divider sx={{ my: 3 }} />

                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Keys shared with this account
                </Typography>
                <DialogContentText sx={{ mb: 2 }}>
                    Their studies will bill to the key you choose, until the date you set. They never see
                    the key itself, and cannot change or share it.
                </DialogContentText>

                {keys.length === 0 ? (
                    <Alert severity="info">You have no keys to share. Add one in Settings first.</Alert>
                ) : (
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth size="small" disabled={available.length === 0}>
                            <InputLabel id="grant-key-label">Key</InputLabel>
                            <Select
                                labelId="grant-key-label"
                                label="Key"
                                value={keyId}
                                onChange={(event) => setKeyId(String(event.target.value))}
                            >
                                {available.map((key) => (
                                    <MenuItem key={key._id} value={key._id}>
                                        {key.provider} — {key.name} — {key.maskedKey}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {available.length === 0 && (
                            <Alert severity="info">
                                {username} already has access to every key you hold. Revoke one below to
                                change its expiry.
                            </Alert>
                        )}

                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {DURATIONS.map((duration) => (
                                <Chip
                                    key={duration.days}
                                    label={duration.label}
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setExpiresAt(inDays(duration.days))}
                                />
                            ))}
                        </Stack>

                        <TextField
                            label="Access until"
                            type="datetime-local"
                            size="small"
                            fullWidth
                            value={expiresAt}
                            onChange={(event) => setExpiresAt(event.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Stack>
                )}

                <Typography variant="subtitle2" sx={{ mt: 3 }}>
                    Access {username} has
                </Typography>
                {grants.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        You have not shared any key with this account.
                    </Typography>
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><b>Key</b></TableCell>
                                <TableCell><b>Access until</b></TableCell>
                                <TableCell><b>Status</b></TableCell>
                                <TableCell align="right" />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {grants.map((grant) => {
                                const expiry = describeGrantExpiry(grant.expiresAt, now);
                                return (
                                <TableRow key={grant._id}>
                                    <TableCell>{grant.keyName || grant.maskedKey || grant.keyId}</TableCell>
                                    <TableCell>
                                        {new Date(grant.expiresAt).toLocaleString()}
                                        {/* Shown here since extending means revoke and re-share. */}
                                        {grant.isLive && expiry.soon && (
                                            <Typography variant="caption" display="block" color="warning.main">
                                                ends {expiry.label}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            variant={grant.isLive ? 'filled' : 'outlined'}
                                            color={grant.isLive ? 'success' : 'default'}
                                            label={
                                                grant.isLive ? 'Active' : grant.revokedAt ? 'Revoked' : 'Expired'
                                            }
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        {grant.isLive && (
                                            <Button size="small" color="error" onClick={() => onRevoke(grant._id)}>
                                                Revoke
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                <Button
                    variant="contained"
                    disabled={!keyId || !expiresAt || saving}
                    onClick={submit}
                >
                    Share key
                </Button>
            </DialogActions>
        </Dialog>
    );
};

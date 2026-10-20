import { useState, useCallback } from 'react';
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import {
    getApiKeys,
    deleteApiKey,
    getExperimentsByApiKey,
    getKeyGrants,
    revokeKeyGrant,
    setDefaultApiKey,
    ApiKeyGrant,
    ApiKeyPublic,
} from '@DAL/server-requests/apiKeys';
import { extractError } from '@DAL/extractError';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import useEffectAsync from '@hooks/useEffectAsync';
import useActiveUser from '@hooks/useActiveUser';
import { PASSWORD_LOCKED_MESSAGE } from '@root/utils/password';
import { ApiKeyList } from './ApiKeyList';
import { AddApiKeyDialog } from './AddApiKeyDialog';
import { KeyGrantsDialog } from './KeyGrantsDialog';
import { ChangePasswordDialog } from './ChangePasswordDialog';

export const SettingsPanel = () => {
    const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
    const [loading, setLoading] = useState(true);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    // Studies billing to the key being deleted. Non-empty: name them and force the delete.
    const [attachedExperiments, setAttachedExperiments] = useState<{ _id: string; title: string }[]>([]);
    const [grantsKeyId, setGrantsKeyId] = useState<string | null>(null);
    const [grants, setGrants] = useState<ApiKeyGrant[]>([]);
    const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
    const { openSnackbar } = useSnackbar();
    // Locked accounts get a message instead of the form. Read at login; the server enforces later locks.
    const { activeUser } = useActiveUser();
    const passwordLocked = !!activeUser?.passwordLocked;

    const loadKeys = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getApiKeys();
            setKeys(data);
        } catch (error) {
            const { message } = extractError(error, 'Failed to load API keys');
            openSnackbar(message, SnackbarStatus.ERROR);
        } finally {
            setLoading(false);
        }
    }, [openSnackbar]);

    useEffectAsync(async () => {
        await loadKeys();
    }, []);

    // Fetch the attached studies before opening the dialog, or Delete can be clicked before
    // the warning renders and fail with a 409.
    const requestDelete = async (keyId: string) => {
        let attached: { _id: string; title: string }[] = [];
        try {
            attached = await getExperimentsByApiKey(keyId);
        } catch {
            // Don't block the delete; the server still refuses with 409 if the key is in use.
        }
        setAttachedExperiments(attached);
        setDeleteConfirmId(keyId);
    };

    const handleDelete = async () => {
        if (!deleteConfirmId) return;
        try {
            // Forced only after the attached studies were shown.
            await deleteApiKey(deleteConfirmId, attachedExperiments.length > 0);
            openSnackbar('API key deleted', SnackbarStatus.SUCCESS);
            // Reload: deleting a default promotes another key of the same provider.
            await loadKeys();
        } catch (error) {
            const { message } = extractError(error, 'Failed to delete API key');
            openSnackbar(message, SnackbarStatus.ERROR);
        } finally {
            setDeleteConfirmId(null);
            setAttachedExperiments([]);
        }
    };

    // Fetch before opening, as in requestDelete.
    const requestGrants = async (keyId: string) => {
        let loaded: ApiKeyGrant[] = [];
        try {
            loaded = await getKeyGrants(keyId);
        } catch (error) {
            const { message } = extractError(error, 'Failed to load shared access');
            openSnackbar(message, SnackbarStatus.ERROR);
            return;
        }
        setGrants(loaded);
        setGrantsKeyId(keyId);
    };

    const handleRevoke = async (grantId: string) => {
        try {
            await revokeKeyGrant(grantId);
            openSnackbar('Access revoked', SnackbarStatus.SUCCESS);
            // Refresh both the dialog and the row's "Shared with" chip.
            if (grantsKeyId) setGrants(await getKeyGrants(grantsKeyId));
            await loadKeys();
        } catch (error) {
            const { message } = extractError(error, 'Failed to revoke access');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    const handleSetDefault = async (keyId: string) => {
        try {
            await setDefaultApiKey(keyId);
            // Reload: the flag also moves off a sibling key.
            await loadKeys();
            openSnackbar('Default key updated', SnackbarStatus.SUCCESS);
        } catch (error) {
            const { message } = extractError(error, 'Failed to set the default key');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    return (
        <Box sx={{ maxWidth: 900, width: '100%', p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h5">API Keys</Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setAddDialogOpen(true)}
                    size="small"
                >
                    Add Key
                </Button>
            </Box>

            <ApiKeyList
                keys={keys}
                loading={loading}
                onDelete={requestDelete}
                onSetDefault={handleSetDefault}
                onShowGrants={requestGrants}
            />

            <AddApiKeyDialog
                open={addDialogOpen}
                onClose={() => setAddDialogOpen(false)}
                onKeyAdded={loadKeys}
            />

            <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}>
                <DialogTitle>Delete API Key</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to delete this API key? Any experiments using this provider will stop working until a new key is added.
                    </DialogContentText>
                    {attachedExperiments.length > 0 && (
                        <DialogContentText sx={{ mt: 2, color: 'warning.main' }}>
                            {attachedExperiments.length === 1
                                ? 'This study bills to this key specifically:'
                                : `These ${attachedExperiments.length} studies bill to this key specifically:`}
                            <br />
                            {attachedExperiments.map((exp) => exp.title).join(', ')}
                            <br />
                            Deleting it removes that choice, and they fall back to the account&apos;s default
                            key for the provider.
                        </DialogContentText>
                    )}
                    {/* Deleting a shared key also ends the grantees' access. */}
                    {(keys.find((key) => key._id === deleteConfirmId)?.grantedTo || []).length > 0 && (
                        <DialogContentText sx={{ mt: 2, color: 'warning.main' }}>
                            {keys.find((key) => key._id === deleteConfirmId)?.grantedTo?.join(', ')} can
                            currently run studies on this key. Deleting it ends that access immediately.
                        </DialogContentText>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                    <Button onClick={handleDelete} color="error" variant="contained">
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>

            <KeyGrantsDialog
                open={!!grantsKeyId}
                keyName={keys.find((key) => key._id === grantsKeyId)?.name}
                grants={grants}
                onRevoke={handleRevoke}
                onClose={() => {
                    setGrantsKeyId(null);
                    setGrants([]);
                }}
            />

            <Box mt={5}>
                <Typography variant="h5" mb={2}>
                    Account
                </Typography>
                {passwordLocked ? (
                    <Typography variant="body2" color="text.secondary">
                        {PASSWORD_LOCKED_MESSAGE}
                    </Typography>
                ) : (
                    <Button variant="outlined" size="small" onClick={() => setPasswordDialogOpen(true)}>
                        Change password
                    </Button>
                )}
            </Box>

            <ChangePasswordDialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} />
        </Box>
    );
};

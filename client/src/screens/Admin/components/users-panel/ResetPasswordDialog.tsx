// Admin sets a researcher's password (shown once after save, never stored here) and the
// `passwordLocked` flag, which stops a shared account's users changing it. Admins can still reset.
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useEffect, useState } from 'react';
import { generatePassword, MIN_PASSWORD_LENGTH } from '@root/utils/password';

interface ResetPasswordDialogProps {
    open: boolean;
    username: string;
    passwordLocked: boolean;
    /** Rejects with the server's error, which the dialog shows. */
    onSave: (changes: { newPassword?: string; passwordLocked?: boolean }) => Promise<void>;
    onCopyFailed: () => void;
    onClose: () => void;
}

export const ResetPasswordDialog = ({
    open,
    username,
    passwordLocked,
    onSave,
    onCopyFailed,
    onClose,
}: ResetPasswordDialogProps) => {
    const [password, setPassword] = useState('');
    const [locked, setLocked] = useState(passwordLocked);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Non-null switches to the one-time "copy it" view.
    const [savedPassword, setSavedPassword] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Reset to the stored flag on each open, not the last ticked value.
    useEffect(() => {
        if (open) setLocked(passwordLocked);
    }, [open, passwordLocked]);

    const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
    const lockChanged = locked !== passwordLocked;
    const canSave = !saving && !tooShort && (password.length > 0 || lockChanged);

    // Clear on close so a password never reappears on the next open.
    const close = () => {
        setPassword('');
        setSavedPassword(null);
        setError(null);
        setCopied(false);
        onClose();
    };

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            await onSave({
                ...(password ? { newPassword: password } : {}),
                ...(lockChanged ? { passwordLocked: locked } : {}),
            });
            if (password) {
                setSavedPassword(password);
                setPassword('');
            } else {
                close();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const copy = async () => {
        if (!savedPassword) return;
        try {
            await navigator.clipboard.writeText(savedPassword);
            setCopied(true);
        } catch {
            // No clipboard access; the password is still selectable on screen.
            onCopyFailed();
        }
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
            <DialogTitle>Password for {username}</DialogTitle>
            {savedPassword ? (
                <>
                    <DialogContent>
                        <DialogContentText sx={{ mb: 2 }}>
                            The new password is saved. Copy it now — it will not be shown again.
                        </DialogContentText>
                        <Box
                            display="flex"
                            alignItems="center"
                            gap={1}
                            sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}
                        >
                            <Typography
                                sx={{ fontFamily: 'monospace', fontSize: '1.1rem', flexGrow: 1, wordBreak: 'break-all' }}
                            >
                                {savedPassword}
                            </Typography>
                            <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button variant="contained" onClick={close}>
                            Done
                        </Button>
                    </DialogActions>
                </>
            ) : (
                <>
                    <DialogContent>
                        <DialogContentText sx={{ mb: 2 }}>
                            Nobody can see the current password. Set a new one here and give it to {username}.
                            Leave it empty to change only the setting below.
                        </DialogContentText>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                            {/* Unmasked: the admin has to read it to hand it over. */}
                            <TextField
                                label="New password"
                                size="small"
                                autoComplete="off"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                error={tooShort}
                                helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                                inputProps={{ spellCheck: false, style: { fontFamily: 'monospace' } }}
                                fullWidth
                            />
                            <Button sx={{ mt: 0.5, flexShrink: 0 }} onClick={() => setPassword(generatePassword())}>
                                Generate
                            </Button>
                        </Stack>
                        <FormControlLabel
                            sx={{ mt: 1 }}
                            control={<Checkbox checked={locked} onChange={(event) => setLocked(event.target.checked)} />}
                            label="User can't change their own password"
                        />
                        <Typography variant="caption" color="text.secondary" display="block">
                            For a shared account: nobody logged into it can change the password, so one person
                            cannot lock the others out. You can still reset it here.
                        </Typography>
                        {error && (
                            <Alert severity="error" sx={{ mt: 2 }}>
                                {error}
                            </Alert>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={close}>Cancel</Button>
                        <Button variant="contained" disabled={!canSave} onClick={save}>
                            Save
                        </Button>
                    </DialogActions>
                </>
            )}
        </Dialog>
    );
};

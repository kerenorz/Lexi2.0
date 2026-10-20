// Change your own password. Errors show inside the dialog so the fields stay filled for a retry.
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
} from '@mui/material';
import { useState } from 'react';
import { changeOwnPassword } from '@DAL/server-requests/users';
import { extractError } from '@DAL/extractError';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { MIN_PASSWORD_LENGTH } from '@root/utils/password';

interface ChangePasswordDialogProps {
    open: boolean;
    onClose: () => void;
}

export const ChangePasswordDialog = ({ open, onClose }: ChangePasswordDialogProps) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const { openSnackbar } = useSnackbar();

    // Shown only once something has been typed, so an empty form does not open in red.
    const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
    const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
    const canSubmit =
        !!currentPassword && newPassword.length >= MIN_PASSWORD_LENGTH && confirmPassword === newPassword && !saving;

    // Clear all fields on close so no password reappears next time.
    const close = () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
        onClose();
    };

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        setError(null);
        try {
            await changeOwnPassword(currentPassword, newPassword);
            openSnackbar('Password changed', SnackbarStatus.SUCCESS);
            close();
        } catch (err) {
            setError(extractError(err, 'Failed to change the password').message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
            <DialogTitle>Change password</DialogTitle>
            <DialogContent>
                <Stack
                    component="form"
                    spacing={2}
                    sx={{ mt: 1 }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <TextField
                        label="Current password"
                        type="password"
                        size="small"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        autoFocus
                        fullWidth
                    />
                    <TextField
                        label="New password"
                        type="password"
                        size="small"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        error={tooShort}
                        helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                        fullWidth
                    />
                    <TextField
                        label="Confirm new password"
                        type="password"
                        size="small"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        error={mismatch}
                        helperText={mismatch ? 'Does not match the new password.' : ' '}
                        fullWidth
                    />
                    {error && <Alert severity="error">{error}</Alert>}
                    {/* Lets Enter submit from any field. */}
                    <button type="submit" hidden />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                <Button variant="contained" disabled={!canSubmit} onClick={submit}>
                    Change password
                </Button>
            </DialogActions>
        </Dialog>
    );
};

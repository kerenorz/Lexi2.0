import { UserType } from '@models/AppModels';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyIcon from '@mui/icons-material/VpnKey';
import LockResetIcon from '@mui/icons-material/LockReset';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    IconButton,
    ListItem,
    ListItemText,
    Paper,
    Tooltip,
    Typography,
} from '@mui/material';
import { useState } from 'react';
import {
    getApiKeys,
    getIssuedGrants,
    grantKeyAccess,
    revokeKeyGrant,
    ApiKeyGrant,
    ApiKeyPublic,
} from '@DAL/server-requests/apiKeys';
import { getModelCatalogue } from '@DAL/server-requests/agents';
import { setResearcherPassword, updateResearcherLimits } from '@DAL/server-requests/users';
import { CatalogueModel } from '@models/AppModels';
import { extractError } from '@DAL/extractError';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { UserAccessDialog } from './UserAccessDialog';
import { UserResourceDetails } from './UserResourceDetails';
import { ResetPasswordDialog } from './ResetPasswordDialog';

interface UserRowProps {
    researcher: UserType;
    onDelete: (userId: string) => void;
}

export const UserRow = ({ researcher, onDelete }: UserRowProps) => {
    const [hasLoaded, setHasLoaded] = useState(false);
    const [grantOpen, setGrantOpen] = useState(false);
    const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
    const [grants, setGrants] = useState<ApiKeyGrant[]>([]);
    const [catalogue, setCatalogue] = useState<CatalogueModel[]>([]);
    // Local so a save updates it without refetching the researcher list.
    const [allowedModels, setAllowedModels] = useState<string[]>(
        researcher.limits?.allowedModels ?? [],
    );
    const [passwordOpen, setPasswordOpen] = useState(false);
    // Local for the same reason as allowedModels.
    const [passwordLocked, setPasswordLocked] = useState(!!researcher.passwordLocked);
    const { openSnackbar } = useSnackbar();

    // Rejects with the server's message so the dialog shows it and keeps the typed password.
    const handleSavePassword = async (changes: { newPassword?: string; passwordLocked?: boolean }) => {
        try {
            const updated = await setResearcherPassword(researcher._id, changes);
            setPasswordLocked(!!updated.passwordLocked);
            openSnackbar(
                changes.newPassword
                    ? `New password set for ${researcher.username}`
                    : `${researcher.username} ${updated.passwordLocked ? "can't" : 'can'} change their own password`,
                SnackbarStatus.SUCCESS,
            );
        } catch (error) {
            throw new Error(extractError(error, 'Failed to save the password').message);
        }
    };

    const handleAccordionChange = (_event: React.SyntheticEvent, isExpanded: boolean) => {
        if (isExpanded && !hasLoaded) {
            setHasLoaded(true);
        }
    };

    const loadGrants = async () => setGrants(await getIssuedGrants(researcher._id));

    // Fetch before opening, so the dialog never shows (or acts on) empty state.
    const openGrantDialog = async () => {
        try {
            const [ownKeys, models] = await Promise.all([getApiKeys(), getModelCatalogue(), loadGrants()]);
            // Keys shared with me can't be lent onward.
            setKeys(ownKeys.filter((key) => !key.granted));
            setCatalogue(models);
            setGrantOpen(true);
        } catch (error) {
            const { message } = extractError(error, 'Failed to load this account');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    const handleSaveModels = async (models: string[]) => {
        try {
            const updated = await updateResearcherLimits(researcher._id, models);
            setAllowedModels(updated.limits?.allowedModels ?? []);
            openSnackbar(
                models.length
                    ? `${researcher.username} can use ${models.length} model${models.length === 1 ? '' : 's'}`
                    : `${researcher.username} can use any model`,
                SnackbarStatus.SUCCESS,
            );
        } catch (error) {
            const { message } = extractError(error, 'Failed to update the allowed models');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    const handleGrant = async (keyId: string, expiresAt: string) => {
        try {
            await grantKeyAccess(keyId, researcher._id, expiresAt);
            openSnackbar(`${researcher.username} can now run studies on this key`, SnackbarStatus.SUCCESS);
            await loadGrants();
        } catch (error) {
            const { message } = extractError(error, 'Failed to share the key');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    const handleRevoke = async (grantId: string) => {
        try {
            await revokeKeyGrant(grantId);
            openSnackbar('Access revoked', SnackbarStatus.SUCCESS);
            await loadGrants();
        } catch (error) {
            const { message } = extractError(error, 'Failed to revoke access');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    return (
        <Paper elevation={2} sx={{ margin: '8px 0' }}>
            <ListItem
                secondaryAction={
                    <Box display="flex" alignItems="center">
                        <Tooltip title="Share a key with this researcher, and set which models they may use">
                            <IconButton edge="end" onClick={openGrantDialog} sx={{ mr: 1 }}>
                                <KeyIcon />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Set a new password, or stop this account changing its own">
                            <IconButton edge="end" onClick={() => setPasswordOpen(true)} sx={{ mr: 1 }}>
                                <LockResetIcon />
                            </IconButton>
                        </Tooltip>
                        <IconButton edge="end" onClick={() => onDelete(researcher._id)} color="error">
                            <DeleteIcon />
                        </IconButton>
                    </Box>
                }
            >
                <ListItemText
                    primary={researcher.username}
                    secondary={`Created: ${new Date(researcher.createdAt).toLocaleDateString()}${
                        passwordLocked ? ' · Password changes: admin only' : ''
                    }`}
                />
            </ListItem>
            <Accordion elevation={0} disableGutters onChange={handleAccordionChange}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
                    <Typography variant="subtitle2" color="textSecondary">
                        View Resources
                    </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 2, pt: 0 }}>
                    {hasLoaded && <UserResourceDetails userId={researcher._id} />}
                </AccordionDetails>
            </Accordion>

            <UserAccessDialog
                open={grantOpen}
                username={researcher.username}
                keys={keys}
                grants={grants}
                catalogue={catalogue}
                allowedModels={allowedModels}
                onGrant={handleGrant}
                onRevoke={handleRevoke}
                onSaveModels={handleSaveModels}
                onClose={() => setGrantOpen(false)}
            />

            <ResetPasswordDialog
                open={passwordOpen}
                username={researcher.username}
                passwordLocked={passwordLocked}
                onSave={handleSavePassword}
                onCopyFailed={() =>
                    openSnackbar('Could not copy — select the password and copy it by hand', SnackbarStatus.ERROR)
                }
                onClose={() => setPasswordOpen(false)}
            />
        </Paper>
    );
};

// Every grant ever made on a key, live or ended. The parent fetches grants before opening,
// so the first paint is never empty.
import {
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import { ApiKeyGrant } from '@DAL/server-requests/apiKeys';
import { describeGrantExpiry } from '@root/utils/grantExpiry';

interface KeyGrantsDialogProps {
    open: boolean;
    keyName?: string;
    grants: ApiKeyGrant[];
    onRevoke: (grantId: string) => void;
    onClose: () => void;
}

export const KeyGrantsDialog = ({ open, keyName, grants, onRevoke, onClose }: KeyGrantsDialogProps) => {
    const now = new Date();
    return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Shared access{keyName ? ` — ${keyName}` : ''}</DialogTitle>
        <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
                These accounts can bill their studies to this key until their access ends. They cannot
                view, change or share the key itself.
            </DialogContentText>
            {grants.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                    This key has never been shared.
                </Typography>
            ) : (
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Account</b></TableCell>
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
                                <TableCell>{grant.granteeUsername || grant.granteeUserId}</TableCell>
                                <TableCell>
                                    {new Date(grant.expiresAt).toLocaleString()}
                                    {/* Only for live grants ending soon. */}
                                    {grant.isLive && expiry.soon && (
                                        <Typography variant="caption" display="block" color="warning.main">
                                            ends {expiry.label}
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {/* Revoked and Expired stay distinct labels. */}
                                    <Chip
                                        size="small"
                                        variant={grant.isLive ? 'filled' : 'outlined'}
                                        color={grant.isLive ? 'success' : 'default'}
                                        label={grant.isLive ? 'Active' : grant.revokedAt ? 'Revoked' : 'Expired'}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    {grant.isLive && (
                                        <Tooltip title="End this access now">
                                            <Button size="small" color="error" onClick={() => onRevoke(grant._id)}>
                                                Revoke
                                            </Button>
                                        </Tooltip>
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
        </DialogActions>
    </Dialog>
    );
};

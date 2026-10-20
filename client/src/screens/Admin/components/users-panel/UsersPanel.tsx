import { extractError } from '@DAL/extractError';
import { createResearcherUser, deleteResearcherUser, getResearcherUsers } from '@DAL/server-requests/users';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import useEffectAsync from '@hooks/useEffectAsync';
import { UserType } from '@models/AppModels';
import AddIcon from '@mui/icons-material/Add';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    TextField,
    Typography,
} from '@mui/material';
import { useState } from 'react';
import { UserRow } from './UserRow';

export const UsersPanel = () => {
    const { openSnackbar } = useSnackbar();
    const [researchers, setResearchers] = useState<UserType[]>([]);
    const [openDialog, setOpenDialog] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    useEffectAsync(async () => {
        try {
            const users = await getResearcherUsers();
            setResearchers(users);
        } catch (error) {
            const { message } = extractError(error, 'Failed to load researchers');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    }, []);

    const handleCreate = async () => {
        if (!username.trim() || !password.trim()) {
            openSnackbar('Username and password are required', SnackbarStatus.WARNING);
            return;
        }
        try {
            const newUser = await createResearcherUser(username.trim(), password);
            setResearchers([...researchers, newUser]);
            setOpenDialog(false);
            setUsername('');
            setPassword('');
            openSnackbar('Researcher created successfully', SnackbarStatus.SUCCESS);
        } catch (error) {
            if (error?.response?.status === 409) {
                const { message } = extractError(error, 'Username already exists');
                openSnackbar(message, SnackbarStatus.ERROR);
            } else {
                const { message } = extractError(error, 'Failed to create researcher');
                openSnackbar(message, SnackbarStatus.ERROR);
            }
        }
    };

    const handleDelete = async (userId: string) => {
        try {
            await deleteResearcherUser(userId);
            setResearchers(researchers.filter((r) => r._id !== userId));
            openSnackbar('Researcher deleted', SnackbarStatus.SUCCESS);
        } catch (error) {
            const { message } = extractError(error, 'Failed to delete researcher');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    return (
        <Box style={{ maxWidth: 'lg', width: '100%', padding: '2%' }}>
            <Typography variant="h6" gutterBottom style={{ borderBottom: '1px solid gray', marginBottom: '24px' }}>
                Users
            </Typography>
            <Typography variant="h5" gutterBottom fontWeight={500}>
                Manage Researchers
            </Typography>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="body2" fontWeight={500}>
                    Create and manage researcher accounts. Researchers can create their own agents, experiments, and
                    forms.
                </Typography>
                <Button
                    variant="contained"
                    size="small"
                    onClick={() => setOpenDialog(true)}
                    startIcon={<AddIcon />}
                >
                    Add Researcher
                </Button>
            </Box>
            <List>
                {researchers.length ? (
                    researchers.map((researcher) => (
                        <UserRow key={researcher._id} researcher={researcher} onDelete={handleDelete} />
                    ))
                ) : (
                    <Typography variant="body1" textAlign="center" width="100%" margin={2}>
                        <b>No researchers found</b>
                    </Typography>
                )}
            </List>
            <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Create Researcher</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Username"
                        fullWidth
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                    <TextField
                        margin="dense"
                        label="Password"
                        type="password"
                        fullWidth
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
                    <Button onClick={handleCreate} variant="contained">
                        Create
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

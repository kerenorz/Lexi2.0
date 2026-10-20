import { extractError } from '@DAL/extractError';
import { getResearcherResources } from '@DAL/server-requests/users';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import useEffectAsync from '@hooks/useEffectAsync';
import { UserResourcesType } from '@models/AppModels';
import {
    Box,
    Chip,
    CircularProgress,
    List,
    ListItem,
    ListItemText,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import { useState } from 'react';

interface UserResourceDetailsProps {
    userId: string;
}

export const UserResourceDetails = ({ userId }: UserResourceDetailsProps) => {
    const { openSnackbar } = useSnackbar();
    const [resources, setResources] = useState<UserResourcesType | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(0);

    useEffectAsync(async () => {
        try {
            const data = await getResearcherResources(userId);
            setResources(data);
        } catch (error) {
            const { message } = extractError(error, 'Failed to load researcher resources');
            openSnackbar(message, SnackbarStatus.ERROR);
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    if (isLoading) {
        return (
            <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress size={28} />
            </Box>
        );
    }

    if (!resources) {
        return (
            <Typography variant="body2" color="textSecondary" textAlign="center" py={2}>
                Failed to load resources
            </Typography>
        );
    }

    const { agents, experiments, forms } = resources;

    return (
        <Box>
            <Tabs
                value={activeTab}
                onChange={(_, newValue) => setActiveTab(newValue)}
                variant="fullWidth"
                sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab label={`Agents (${agents.length})`} />
                <Tab label={`Experiments (${experiments.length})`} />
                <Tab label={`Forms (${forms.length})`} />
            </Tabs>

            {/* Agents Tab */}
            {activeTab === 0 && (
                <Box>
                    {agents.length ? (
                        <List dense>
                            {agents.map((agent) => (
                                <ListItem key={agent._id} divider>
                                    <ListItemText
                                        primary={agent.title}
                                        secondary={`Model: ${agent.model} · Created: ${new Date(agent.createdAt).toLocaleDateString()}`}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    ) : (
                        <Typography variant="body2" color="textSecondary" textAlign="center" py={2}>
                            No agents created
                        </Typography>
                    )}
                </Box>
            )}

            {/* Experiments Tab */}
            {activeTab === 1 && (
                <Box>
                    {experiments.length ? (
                        <List dense>
                            {experiments.map((experiment) => (
                                <ListItem key={experiment._id} divider>
                                    <ListItemText
                                        primary={
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <span>{experiment.title}</span>
                                                <Chip
                                                    label={experiment.isActive ? 'Active' : 'Inactive'}
                                                    size="small"
                                                    color={experiment.isActive ? 'success' : 'default'}
                                                    variant="outlined"
                                                />
                                            </Box>
                                        }
                                        secondary={`${experiment.agentsMode} · ${experiment.numberOfParticipants} participants · Created: ${new Date(experiment.createdAt).toLocaleDateString()}`}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    ) : (
                        <Typography variant="body2" color="textSecondary" textAlign="center" py={2}>
                            No experiments created
                        </Typography>
                    )}
                </Box>
            )}

            {/* Forms Tab */}
            {activeTab === 2 && (
                <Box>
                    {forms.length ? (
                        <List dense>
                            {forms.map((form) => (
                                <ListItem key={form._id} divider>
                                    <ListItemText
                                        primary={form.name}
                                        secondary={form.title ? `Title: ${form.title}` : undefined}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    ) : (
                        <Typography variant="body2" color="textSecondary" textAlign="center" py={2}>
                            No forms created
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
};

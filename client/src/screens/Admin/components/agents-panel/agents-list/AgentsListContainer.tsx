import { AgentType, ExperimentLeanType } from '@models/AppModels';
import { useAppSelector } from '@DAL/redux/store';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    IconButton,
    List,
    Menu,
    MenuItem,
    Paper,
} from '@mui/material';
import Typography from '@mui/material/Typography';
import React, { useState } from 'react';
import { deleteAgent } from '../../../../../DAL/server-requests/agents';
import { getExperimentsByAgent } from '../../../../../DAL/server-requests/experiments';
import { extractError } from '../../../../../DAL/extractError';
import { SnackbarStatus, useSnackbar } from '../../../../../contexts/SnackbarProvider';
import { AddButton, MainContainerStyled } from '../../experiments-panel/experiments/Experiments.s';
import AgentForm from '../agent-form/AgentForm';
import {
    ListSearchControl,
    ListSortControl,
    SortMode,
    filterByText,
    groupByOwner,
    ownerColor,
    sortItems,
} from '../../shared/listSortGroup';
import { AgentDetails } from './AgentDetails';
import { AgentHeader } from './AgentHeader';

export interface AgentsListContainerProps {
    agents: AgentType[];
    setAgents: (any) => void;
}

export const AgentsListContainer: React.FC<AgentsListContainerProps> = ({ agents, setAgents }) => {
    const { openSnackbar } = useSnackbar();
    const activeUser = useAppSelector((state) => state.activeUser);
    const showUsers = activeUser?.role === 'admin';
    const [sortMode, setSortMode] = useState<SortMode>('newest');
    const [search, setSearch] = useState('');
    const [isEditMode, setIsEditMode] = useState(false);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [openAgentFormDialog, setOpenAgentFormDialog] = useState(false);
    const [selectedAgent, setSelectedAgent] = useState<AgentType | undefined>(undefined);
    const [editAgent, setEditAgent] = useState<AgentType | undefined>(null);
    // An attached agent awaiting delete confirmation. Not selectedAgent: the menu clears that on close.
    const [pendingDelete, setPendingDelete] = useState<{
        agent: AgentType;
        experiments: ExperimentLeanType[];
    } | null>(null);

    const handleClose = () => {
        setAnchorEl(null);
        setSelectedAgent(undefined);
    };

    const closeDialog = () => {
        setOpenAgentFormDialog(false);
        if (editAgent) {
            setEditAgent(null);
            setIsEditMode(false);
        }
    };

    const handleMenuAction = async (action: string) => {
        if (action === 'edit') {
            setEditAgent(selectedAgent);
            setIsEditMode(true);
            setOpenAgentFormDialog(true);
        } else if (action === 'duplicate') {
            setEditAgent(selectedAgent);
            setOpenAgentFormDialog(true);
        } else if (action === 'delete') {
            handleDeleteAgent();
        }
        handleClose();
    };

    // An agent still used by experiments can be deleted after a confirmation naming them.
    const handleDeleteAgent = async () => {
        const agent = selectedAgent;
        try {
            const agentExperiments = await getExperimentsByAgent(agent._id);
            if (agentExperiments.length) {
                setPendingDelete({ agent, experiments: agentExperiments });
                return;
            }
            await removeAgent(agent);
        } catch (error) {
            const { message } = extractError(error, 'Failed Deleting Agent');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    // Without `force` the server answers 409 when experiments still use the agent.
    const removeAgent = async (agent: AgentType, force = false) => {
        openSnackbar('Deleting Agent...', SnackbarStatus.INFO);
        await deleteAgent(agent._id, force);
        setAgents(agents.filter((a) => a._id !== agent._id));
        openSnackbar('Delete Agent Success !', SnackbarStatus.SUCCESS);
    };

    const confirmForcedDelete = async () => {
        const { agent } = pendingDelete;
        setPendingDelete(null);
        try {
            await removeAgent(agent, true);
        } catch (error) {
            const { message } = extractError(error, 'Failed Deleting Agent');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    // Usage = referenceCount; newest = createdAt/timestamp; owner = creator username.
    const getUsage = (a: AgentType) => a.referenceCount ?? 0;
    const getTime = (a: AgentType) => a.timestamp || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const getOwner = (a: AgentType) => a.creatorUsername || 'Unknown';

    const renderAgentCard = (agent: AgentType, index: number) => (
        <Paper elevation={3} key={agent._id?.toString() || index} sx={{ margin: '10px' }}>
            <AgentHeader agent={agent} setSelectedAgent={setSelectedAgent} setAnchorEl={setAnchorEl} />
            <Divider />
            <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">Detailed Settings</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <AgentDetails agent={agent} />
                </AccordionDetails>
            </Accordion>
        </Paper>
    );

    // Filter before grouping so empty owner groups don't show.
    const visibleAgents = filterByText(agents, search, (a) => [
        a.displayName,
        a.title,
        a.summary,
        a.model,
        a.creatorUsername,
    ]);

    const renderAgents = () => {
        if (sortMode === 'users' && showUsers) {
            return groupByOwner(visibleAgents, getOwner, getTime).map((group) => {
                const color = ownerColor(group.owner);
                return (
                    <Box key={`group-${group.owner}`} sx={{ borderLeft: `4px solid ${color}`, pl: 1, mb: 2 }}>
                        <Typography variant="subtitle2" fontWeight={600} sx={{ ml: '10px', mt: 1 }}>
                            {group.owner}
                        </Typography>
                        {group.items.map((agent, i) => renderAgentCard(agent, i))}
                    </Box>
                );
            });
        }
        return sortItems(visibleAgents, sortMode, getUsage, getTime).map((agent, i) => renderAgentCard(agent, i));
    };

    return (
        <MainContainerStyled>
            <Typography variant="h6" gutterBottom style={{ borderBottom: '1px solid gray', marginBottom: '24px' }}>
                Agents
            </Typography>
            <Typography variant="h5" gutterBottom fontWeight={500}>
                Manage Your Agents
            </Typography>
            <Box display={'flex'} justifyContent={'space-between'} alignItems={'center'}>
                <Typography variant="body2" gutterBottom fontWeight={500} marginBottom={2}>
                    Manage your agents, create a unique agent by prompt engineering, revisite your prompts and
                    more.
                </Typography>
                <Box display={'flex'} justifyContent={'end'} alignItems={'center'} gap={2}>
                    <ListSearchControl value={search} onChange={setSearch} placeholder="Search agents by name…" />
                    <ListSortControl value={sortMode} onChange={setSortMode} showUsers={showUsers} />
                    <AddButton onClick={() => setOpenAgentFormDialog(true)} size="small">
                        <AddIcon style={{ color: 'floralwhite' }} />
                        <Typography variant="body2" fontWeight={500} color={'floralwhite'}>
                            Add Agent
                        </Typography>
                    </AddButton>
                </Box>
            </Box>
            <List>
                {visibleAgents.length ? (
                    renderAgents()
                ) : (
                    <Typography variant="body1" textAlign={'center'} width={'100%'} margin={2}>
                        <b>{search ? `No agents match "${search}"` : 'No agents found'}</b>
                    </Typography>
                )}
                <Menu
                    id="long-menu"
                    anchorEl={anchorEl}
                    keepMounted
                    open={Boolean(anchorEl)}
                    onClose={handleClose}
                >
                    <MenuItem onClick={() => handleMenuAction('edit')}>Edit</MenuItem>
                    <MenuItem onClick={() => handleMenuAction('duplicate')}>Duplicate</MenuItem>
                    <MenuItem onClick={() => handleMenuAction('delete')} sx={{ color: 'red' }}>
                        Delete
                    </MenuItem>
                </Menu>
            </List>
            <Dialog open={openAgentFormDialog} maxWidth={'lg'}>
                <IconButton
                    aria-label="close"
                    onClick={closeDialog}
                    sx={{
                        position: 'absolute',
                        right: 8,
                        top: 8,
                        color: (theme) => theme.palette.grey[500],
                    }}
                >
                    <CloseIcon />
                </IconButton>
                <AgentForm
                    editAgent={editAgent}
                    setAgents={setAgents}
                    agents={agents}
                    closeDialog={closeDialog}
                    isEditMode={isEditMode}
                />
            </Dialog>
            <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} maxWidth="xs">
                <DialogTitle>Delete this agent?</DialogTitle>
                <DialogContent>
                    <DialogContentText component="div">
                        <b>{pendingDelete?.agent?.displayName || pendingDelete?.agent?.title}</b> is still used by{' '}
                        {pendingDelete?.experiments.length === 1 ? 'this experiment' : 'these experiments'}:
                        <ul style={{ marginTop: 8, marginBottom: 8 }}>
                            {pendingDelete?.experiments.map((exp) => (
                                <li key={String(exp._id)}>{exp.title}</li>
                            ))}
                        </ul>
                        Deleting it does not change{' '}
                        {pendingDelete?.experiments.length === 1 ? 'that experiment' : 'those experiments'}, so{' '}
                        {pendingDelete?.experiments.length === 1 ? 'it' : 'they'} will still ask for an agent that no
                        longer exists and no new participant will be able to join. Already-collected data is
                        untouched. The experiments list will show a warning until you assign another agent.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
                    <Button onClick={confirmForcedDelete} color="error">
                        Delete anyway
                    </Button>
                </DialogActions>
            </Dialog>
        </MainContainerStyled>
    );
};

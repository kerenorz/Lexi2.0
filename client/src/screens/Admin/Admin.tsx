import { AdminSections } from '@DAL/constants';
import { extractError } from '@DAL/extractError';
import { getAgents } from '@DAL/server-requests/agents';
import { checkHasApiKeys } from '@DAL/server-requests/apiKeys';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import useEffectAsync from '@hooks/useEffectAsync';
import { AgentType } from '@models/AppModels';
import { Grid, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';
import theme from '@root/Theme';
import { useState } from 'react';
import { getForms } from '../../DAL/server-requests/forms';
import { MainContainer, SectionContainer, SectionInnerContainer } from './Admin.s';
import { AgentsListContainer } from './components/agents-panel/agents-list/AgentsListContainer';
import { Experiments } from './components/experiments-panel/experiments/Experiments';
import FormsPanel from './components/forms-panel/FormsPanel';
import { RemovedModelsDialog } from './components/RemovedModelsDialog';
import { SidebarAdmin } from './components/sidebar-admin/SideBarAdmin';

interface Form {
    _id: string;
    name: string;
}

import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { DataPanel } from './components/data-panel/DataPanel';
import { SettingsPanel } from './components/settings-panel/SettingsPanel';
import { UsersPanel } from './components/users-panel/UsersPanel';

const Admin = () => {
    const [agents, setAgents] = useState<AgentType[]>([]);
    const [forms, setForms] = useState<Form[]>([]);
    const [showKeyPrompt, setShowKeyPrompt] = useState(false);
    const { openSnackbar } = useSnackbar();
    const navigate = useNavigate();

    useEffectAsync(async () => {
        try {
            const [agentsRes, formsRes, hasKeys] = await Promise.all([getAgents(), getForms(), checkHasApiKeys()]);
            setAgents(agentsRes);
            setForms(formsRes);
            if (!hasKeys) {
                setShowKeyPrompt(true);
            }
        } catch (error) {
            const { message } = extractError(error, 'Failed to load agents');
            openSnackbar(message, SnackbarStatus.ERROR);
            setAgents([]);
        }
    }, []);

    return (
        <MainContainer container>
            <Grid item xs={2} sm={2} md={2} lg={2} style={{ backgroundColor: theme.palette.primary.main }}>
                <SidebarAdmin />
            </Grid>
            <Grid item xs={10} sm={10} md={10} lg={10}>
                <SectionContainer
                    sx={{
                        '&.MuiContainer-root': { maxWidth: 'none', padding: 0 },
                        marginLeft: 0,
                        marginRight: 0,
                        padding: 0,
                    }}
                >
                    <SectionInnerContainer container>
                        <Routes>
                            <Route path="/" element={<Navigate to={AdminSections.EXPERIMENTS} replace />} />
                            <Route
                                path={AdminSections.EXPERIMENTS}
                                element={<Experiments agents={agents} forms={forms} />}
                            />
                            <Route
                                path={AdminSections.AGENTS}
                                element={<AgentsListContainer agents={agents} setAgents={setAgents} />}
                            />
                            <Route
                                path={AdminSections.FORMS}
                                element={<FormsPanel forms={forms} setForms={setForms} />}
                            />
                            <Route path={AdminSections.DATA} element={<DataPanel />} />
                            <Route path={AdminSections.SETTINGS} element={<SettingsPanel />} />
                            <Route path={AdminSections.USERS} element={<UsersPanel />} />
                        </Routes>
                    </SectionInnerContainer>
                </SectionContainer>
            </Grid>

            <Dialog open={showKeyPrompt} maxWidth="sm" fullWidth>
                <DialogTitle>API Key Required</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Please add at least one API key to get started. You can add keys for OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini), xAI (Grok) or OpenRouter in the Settings panel.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="contained"
                        onClick={() => {
                            setShowKeyPrompt(false);
                            navigate(AdminSections.SETTINGS);
                        }}
                    >
                        Go to Settings
                    </Button>
                </DialogActions>
            </Dialog>
            <RemovedModelsDialog />
        </MainContainer>
    );
};

export default Admin;

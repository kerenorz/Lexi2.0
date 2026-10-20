import { AdminSections } from '@DAL/constants';
import { getRemovedModelAgents } from '@DAL/server-requests/agents';
import useEffectAsync from '@hooks/useEffectAsync';
import { RemovedModelAgent } from '@models/AppModels';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { markRemovedModelsAlertShown, removedModelsAlertShown } from '@utils/removedModelsAlert';

// Lists the researcher's agents on removed models, with the reason. Shown once per login.
export const RemovedModelsDialog = () => {
    const [items, setItems] = useState<RemovedModelAgent[]>([]);
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    useEffectAsync(async () => {
        if (removedModelsAlertShown()) return;
        try {
            const found = await getRemovedModelAgents();
            if (found.length) {
                setItems(found);
                setOpen(true);
                markRemovedModelsAlertShown();
            }
        } catch {
            // A failed load must not block the admin page.
        }
    }, []);

    return (
        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>A model your agents use has been removed</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                    {items.length === 1 ? 'This agent runs' : 'These agents run'} on a model Lexi no longer offers. Its
                    replies may fail in front of participants. Open the agent and pick another model before the
                    experiment runs again.
                </DialogContentText>
                {items.map((item) => (
                    <div key={item.agentId} style={{ marginBottom: 16 }}>
                        <Typography variant="subtitle2">
                            {item.agentTitle} — {item.model}
                        </Typography>
                        <Typography variant="body2">{item.reason}</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Used in:{' '}
                            {item.experiments
                                .map((experiment) => `${experiment.title}${experiment.isActive ? '' : ' (inactive)'}`)
                                .join(', ')}
                        </Typography>
                    </div>
                ))}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setOpen(false)}>Dismiss</Button>
                <Button
                    variant="contained"
                    onClick={() => {
                        setOpen(false);
                        navigate(AdminSections.AGENTS);
                    }}
                >
                    Go to Agents
                </Button>
            </DialogActions>
        </Dialog>
    );
};

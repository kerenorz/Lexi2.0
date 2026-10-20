import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    CircularProgress,
    Alert,
    IconButton,
    InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { createApiKey, LLMProvider } from '@DAL/server-requests/apiKeys';

const providers: { value: LLMProvider; label: string }[] = [
    { value: 'openai', label: 'OpenAI (ChatGPT)' },
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'google', label: 'Google (Gemini)' },
    { value: 'xai', label: 'xAI (Grok)' },
    { value: 'openrouter', label: 'OpenRouter (many models, one key)' },
];

interface AddApiKeyDialogProps {
    open: boolean;
    onClose: () => void;
    onKeyAdded: () => void;
}

export const AddApiKeyDialog = ({ open, onClose, onKeyAdded }: AddApiKeyDialogProps) => {
    const [provider, setProvider] = useState<LLMProvider>('openai');
    const [name, setName] = useState('');
    const [note, setNote] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const resetForm = () => {
        setProvider('openai');
        setName('');
        setNote('');
        setApiKey('');
        setShowKey(false);
        setError('');
    };

    const handleClose = () => {
        if (loading) return;
        resetForm();
        onClose();
    };

    const handleSubmit = async () => {
        if (!name.trim() || !apiKey.trim()) {
            setError('Name and API key are required.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            await createApiKey({
                provider,
                name: name.trim(),
                note: note.trim() || undefined,
                apiKey: apiKey.trim(),
            });
            resetForm();
            onKeyAdded();
            onClose();
        } catch (err: any) {
            const message = err?.response?.data?.message || 'Failed to add API key. Please check the key and try again.';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
            <DialogTitle>Add API Key</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}

                <TextField
                    select
                    label="Provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as LLMProvider)}
                    fullWidth
                    margin="dense"
                >
                    {providers.map((p) => (
                        <MenuItem key={p.value} value={p.value}>
                            {p.label}
                        </MenuItem>
                    ))}
                </TextField>

                <TextField
                    label="Key Name"
                    placeholder="e.g., My Research Key"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    fullWidth
                    required
                    margin="dense"
                />

                <TextField
                    label="Note (optional)"
                    placeholder="Any extra details about this key"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    fullWidth
                    multiline
                    rows={2}
                    margin="dense"
                />

                <TextField
                    label="API Key"
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    fullWidth
                    required
                    margin="dense"
                    type={showKey ? 'text' : 'password'}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton onClick={() => setShowKey(!showKey)} edge="end" size="small">
                                    {showKey ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={handleClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={loading || !name.trim() || !apiKey.trim()}
                    startIcon={loading ? <CircularProgress size={18} /> : undefined}
                >
                    {loading ? 'Validating...' : 'Add Key'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

import { previewCloseSegment, previewSurveyAnswers } from '@DAL/server-requests/conversations';
import type { SegmentView } from '@DAL/server-requests/conversations';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { Box, Button, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';

// Researcher preview controls for a segmented conversation, so blocks and survey answers
// can be tested without a real survey. Uses the same endpoints as the real flow.
// Rendered only for a privileged preview conversation.
export const SegmentPreviewPanel: React.FC<{
    experimentId: string;
    conversationId: string;
    segment: SegmentView | null;
    onChanged: () => void;
}> = ({ experimentId, conversationId, segment, onChanged }) => {
    const { openSnackbar } = useSnackbar();
    const [answers, setAnswers] = useState('{ "mood": "low" }');
    const [busy, setBusy] = useState(false);

    const close = async () => {
        setBusy(true);
        try {
            await previewCloseSegment(conversationId);
            openSnackbar('Block closed — re-enter to continue the arc.', SnackbarStatus.SUCCESS);
            onChanged();
        } catch {
            openSnackbar('Could not close the block', SnackbarStatus.ERROR);
        }
        setBusy(false);
    };

    const sendAnswers = async () => {
        // The gap after block N is gap N, matching the embed kit's numbering.
        const gap = segment?.number ?? 1;
        setBusy(true);
        try {
            const parsed = JSON.parse(answers);
            await previewSurveyAnswers(experimentId, conversationId, gap, parsed);
            openSnackbar(`Answers filed against gap ${gap}.`, SnackbarStatus.SUCCESS);
            onChanged();
        } catch (err: any) {
            openSnackbar(
                err instanceof SyntaxError ? 'That is not valid JSON' : 'Could not send the answers',
                SnackbarStatus.ERROR,
            );
        }
        setBusy(false);
    };

    return (
        <Box
            style={{
                border: '2px dashed #b26a00',
                background: '#fff8e1',
                borderRadius: 6,
                padding: 10,
                margin: '0 8px 8px',
            }}
        >
            {/* Prominent so a pilot is never mistaken for a live run. */}
            <Typography variant="subtitle2" style={{ color: '#b26a00' }}>
                PREVIEW — not a participant run. This conversation is excluded from the study&apos;s data.
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 6 }}>
                {segment
                    ? `Chat block ${segment.number} of ${segment.totalSegments || '?'}${segment.isOpen ? '' : ' — closed'}`
                    : 'No block'}
            </Typography>

            <Box display="flex" gap={1} alignItems="flex-start" flexWrap="wrap">
                <Button size="small" variant="outlined" disabled={busy || !segment?.isOpen} onClick={close}>
                    Close this block
                </Button>
                <TextField
                    size="small"
                    label="Mock survey answers (JSON)"
                    value={answers}
                    onChange={(e) => setAnswers(e.target.value)}
                    style={{ minWidth: 260 }}
                />
                <Button size="small" variant="outlined" disabled={busy} onClick={sendAnswers}>
                    Send answers
                </Button>
            </Box>
        </Box>
    );
};

export default SegmentPreviewPanel;

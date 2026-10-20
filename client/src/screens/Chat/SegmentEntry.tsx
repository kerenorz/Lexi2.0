import { enterSegment } from '@DAL/server-requests/conversations';
import type { SegmentView } from '@DAL/server-requests/conversations';
import LoadingPage from '@components/common/LoadingPage';
import { RegisterForm } from '@components/forms/RegisterForm';
import { useExperimentId } from '@hooks/useExperimentId';
import { Box, Typography } from '@mui/material';
import { postToHost } from '@root/utils/hostBridge';
import React, { lazy, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const ChatPage = lazy(() => import('./ChatPage'));

// A block can't close mid-round, so the server answers pendingSegment and we re-enter until the
// round ends. Generous bound (a slow group round can take ~30s); past it we mount the returned
// block and ChatPage's segment poll moves the participant on.
const PENDING_RETRY_MS = 1200;
const PENDING_RETRY_LIMIT = 30;

// Survey-embedded (iframe) entry: resolves the participant's block, mints a session, renders
// the chat. Runs on every mount since entry is idempotent and the in-memory token doesn't
// survive a reload. Renders in place rather than navigating, to keep ids out of the URL.
const SegmentEntry: React.FC<{
    isFinishDialogOpen: boolean;
    setIsFinishDialogOpen: (open: boolean) => void;
}> = ({ isFinishDialogOpen, setIsFinishDialogOpen }) => {
    const experimentId = useExperimentId();
    const [searchParams] = useSearchParams();
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [initialSegment, setInitialSegment] = useState<SegmentView | null>(null);
    const [isPreview, setIsPreview] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    // First touch only: the participant doesn't exist yet.
    const [needsRegistration, setNeedsRegistration] = useState(false);
    // Bumped after registration to re-run the entry effect.
    const [entryEpoch, setEntryEpoch] = useState(0);

    const pid = searchParams.get('pid');
    const requested = searchParams.get('segment');

    useEffect(() => {
        let cancelled = false;
        let retry: ReturnType<typeof setTimeout> | undefined;
        const attempt = async (attemptsSoFar: number) => {
            try {
                const result = await enterSegment(experimentId, pid, requested ? Number(requested) : null);
                if (cancelled) return;
                // Requested block not open yet: don't mount or announce the block being left.
                if (result.pendingSegment && attemptsSoFar < PENDING_RETRY_LIMIT) {
                    retry = setTimeout(() => attempt(attemptsSoFar + 1), PENDING_RETRY_MS);
                    return;
                }
                // Tell the host we're alive: its watchdog reveals Next after 20s of silence,
                // which would let the participant skip the chat during registration.
                if (result.needsRegistration) {
                    setNeedsRegistration(true);
                    postToHost({ type: 'segment-state', experimentId, canProceed: false });
                    return;
                }
                setNeedsRegistration(false);
                setConversationId(result.conversationId ?? null);
                setInitialSegment(result.segment);
                setIsPreview(!!result.isPreview);
                postToHost({
                    type: 'segment-state',
                    experimentId,
                    conversationId: result.conversationId,
                    segment: result.segment?.number,
                    isOpen: result.segment?.isOpen,
                    isFinal: result.segment?.isFinal,
                    canProceed: result.segment?.canProceed,
                    totalSegments: result.segment?.totalSegments,
                });
            } catch (err: any) {
                if (cancelled) return;
                const reason = err?.response?.data?.reason || 'ENTRY_FAILED';
                setFailure(reason);
                // Report it so the host can release the participant (its Next is hidden) and
                // branch past the remaining chat blocks.
                postToHost({ type: 'error', experimentId, reason });
            }
        };
        attempt(0);
        return () => {
            cancelled = true;
            clearTimeout(retry);
        };
        // Re-runs on a new block and after registration.
    }, [experimentId, pid, requested, entryEpoch]);

    if (failure) {
        return (
            <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                height="100%"
                padding={3}
                textAlign="center"
            >
                <Typography variant="body1" color="textSecondary">
                    This conversation is not available right now. Please continue with the survey.
                </Typography>
            </Box>
        );
    }

    // Shown once, on the first block.
    if (needsRegistration) {
        return (
            <RegisterForm
                experimentId={experimentId}
                // No register/sign-in chooser inside a survey.
                setShowFormTypeButtons={() => undefined}
                externalPid={pid ?? undefined}
                onRegistered={() => setEntryEpoch((epoch) => epoch + 1)}
            />
        );
    }

    if (!conversationId) return <LoadingPage />;

    return (
        <ChatPage
            isFinishDialogOpen={isFinishDialogOpen}
            setIsFinishDialogOpen={setIsFinishDialogOpen}
            conversationId={conversationId}
            initialSegment={initialSegment}
            isPreview={isPreview}
        />
    );
};

export default SegmentEntry;

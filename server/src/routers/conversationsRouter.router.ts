import { Router } from 'express';
import { conversationsController } from '../controllers/conversationsController.controller';
import { attachUserIfPresent, authenticate, requireRole } from '../middleware/authMiddleware';

export const conversationsRouter = () => {
    const router = Router();

    // Public: authenticated by the survey's participant id, since browsers block Lexi's cookie
    // in the survey iframe. attachUserIfPresent lets a researcher preview without a participant.
    router.post('/segments/enter', attachUserIfPresent, conversationsController.enterSegment);
    router.get('/segments/state', authenticate, conversationsController.getSegmentState);
    // Public: the survey posts these server-side with no session. The controller guards the preview path.
    router.post('/segments/answers', attachUserIfPresent, conversationsController.postSurveyAnswers);
    router.post('/segments/finish', attachUserIfPresent, conversationsController.finishSegments);
    // Researcher preview only.
    router.post(
        '/segments/preview-close',
        authenticate,
        requireRole('admin', 'user'),
        conversationsController.previewCloseSegment,
    );

    router.get('/conversation', authenticate, conversationsController.getConversation);
    router.post('/message', authenticate, conversationsController.message);
    router.post('/audio', authenticate, ...conversationsController.audio);
    // GET kept for older client bundles still open in a tab.
    router.post('/message/stream', authenticate, conversationsController.streamMessage);
    router.get('/message/stream', authenticate, conversationsController.streamMessage);
    router.post('/message/group-stream', authenticate, conversationsController.streamGroupMessage);
    router.post('/round/continue', authenticate, conversationsController.streamAutonomousGroupRound);
    router.post('/message/displayed', authenticate, conversationsController.reportDisplayedAt);
    router.post('/create', authenticate, conversationsController.createConversation);
    router.put('/metadata', authenticate, conversationsController.updateConversationMetadata);
    router.put('/annotation', authenticate, conversationsController.updateUserAnnotation);
    router.post('/finish', authenticate, conversationsController.finishConversation);
    router.post('/sendSnap', authenticate, conversationsController.sendSnap);

    return router;
};

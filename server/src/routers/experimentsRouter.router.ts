import { Router } from 'express';
import { experimentsController } from '../controllers/experimentsController.controller';
import { authenticate, requireRole } from '../middleware/authMiddleware';

export const experimentsRouter = () => {
    const router = Router();
    const auth = [authenticate, requireRole('admin', 'user')];

    // Admin/User routes (protected)
    router.get('/', ...auth, experimentsController.getExperiments);
    router.get('/agent', ...auth, experimentsController.getAllExperimentsByAgentId);
    router.post('/create', ...auth, experimentsController.createExperiment);
    router.put('/', ...auth, experimentsController.updateExperiment);
    router.put('/status', ...auth, experimentsController.updateExperimentsStatus);
    router.put('/content', ...auth, experimentsController.updateExperimentDisplaySetting);
    router.delete('/:id', ...auth, experimentsController.deleteExperiment);

    // Public routes (used by participant registration/login)
    router.get('/:id', experimentsController.getExperiment);
    router.get('/:id/features', experimentsController.getExperimentFeatures);
    router.get('/:id/content', experimentsController.getExperimentContent);
    router.get('/:id/registrationForm', experimentsController.getRegistrationForm);
    router.get('/:id/conversationForms', experimentsController.getConversationForms);

    return router;
};

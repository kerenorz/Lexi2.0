import { Router } from 'express';
import { agentsController } from '../controllers/agentsController.controller';
import { authenticate, requireRole } from '../middleware/authMiddleware';

export const agentsRouter = () => {
    const router = Router();
    const auth = [authenticate, requireRole('admin', 'user')];

    router.post('/', ...auth, agentsController.saveAgent);
    router.get('/', ...auth, agentsController.getAgents);
    router.put('/', ...auth, agentsController.updateAgent);
    router.get('/download-sample', ...auth, agentsController.downloadSample);
    router.post('/upload-rulesheet', ...auth, agentsController.uploadRuleSheet);
    // Static routes must stay above '/:id', or ':id' matches them and returns 200 null.
    router.get('/models', ...auth, agentsController.getModelCatalogue);
    router.get('/removed-models', ...auth, agentsController.getRemovedModelAgents);
    router.delete('/:id', ...auth, agentsController.deleteAgent);
    router.get('/:id', agentsController.getAgentLean); // public: participant flow

    return router;
};

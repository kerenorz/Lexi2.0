import { Router } from 'express';
import { apiKeysController } from '../controllers/apiKeysController.controller';
import { authenticate, requireRole } from '../middleware/authMiddleware';

export const apiKeysRouter = () => {
    const router = Router();

    router.use(authenticate, requireRole('admin', 'user'));

    router.get('/', apiKeysController.getKeys);
    router.post('/', apiKeysController.createKey);
    router.delete('/:id', apiKeysController.deleteKey);
    router.get('/check', apiKeysController.checkHasKeys);

    // Literal '/grants/...' routes before '/:id/...' ones, so a future route can't be shadowed.
    router.get('/grants/mine', apiKeysController.getMyGrants);
    router.get('/grants/issued', apiKeysController.getIssuedGrants);
    router.patch('/grants/:grantId/revoke', apiKeysController.revokeGrant);

    router.patch('/:id/default', apiKeysController.setDefault);
    router.get('/:id/experiments', apiKeysController.getKeyExperiments);
    router.get('/:id/grants', apiKeysController.getKeyGrants);
    router.post('/:id/grants', apiKeysController.createGrant);

    return router;
};

import { Router } from 'express';
import { dataAggregationController } from '../controllers/dataAggregationController.controller';
import { authenticate, requireRole } from '../middleware/authMiddleware';

export const dataAggregationRouter = () => {
    const router = Router();
    const auth = [authenticate, requireRole('admin', 'user')];

    router.get('/', ...auth, dataAggregationController.getExperimentData);
    router.get('/excel', ...auth, dataAggregationController.getExperimentExcel);
    // The caller's own pilot runs. Same auth as the participant export (admin | user); the
    // OWNER is taken from the session inside the controller, never from the request.
    router.get('/pilots/excel', ...auth, dataAggregationController.getPilotExcel);
    return router;
};

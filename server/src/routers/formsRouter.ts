import { Router } from 'express';
import { formsController } from '../controllers/formsController';
import { authenticate, requireRole } from '../middleware/authMiddleware';

export const formsRouter = () => {
    const router = Router();
    const auth = [authenticate, requireRole('admin', 'user')];

    router.post('/', ...auth, formsController.saveForm);
    router.get('/', ...auth, formsController.getForms);
    router.put('/', ...auth, formsController.updateForm);
    router.delete('/:id', ...auth, formsController.deleteForm);
    router.get('/:id', formsController.getForm); // public - used by participant registration

    return router;
};

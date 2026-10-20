import { Router } from 'express';
import { usersController } from '../controllers/usersController.controller';
import { authenticate, requireRole } from '../middleware/authMiddleware';

export const usersRouter = () => {
    const router = Router();

    // Public routes
    router.post('/create', usersController.createUser);
    router.post('/login', usersController.login);
    router.post('/logout', usersController.logout);
    router.get('/user', usersController.getActiveUser);
    router.get('/validate', usersController.validateUserName);

    // Protected routes
    router.put('/agent', authenticate, requireRole('admin', 'user'), usersController.updateUsersAgent);
    // Change own password. Accounts with `passwordLocked` are refused in the service.
    router.patch('/me/password', authenticate, requireRole('admin', 'user'), usersController.changeOwnPassword);

    // Admin-only routes (researcher management)
    router.post('/create-researcher', authenticate, requireRole('admin'), usersController.createResearcherUser);
    router.get('/researchers', authenticate, requireRole('admin'), usersController.getResearcherUsers);
    router.delete('/researcher/:id', authenticate, requireRole('admin'), usersController.deleteResearcherUser);
    router.get('/researcher/:id/resources', authenticate, requireRole('admin'), usersController.getResearcherResources);
    // Allowed models for the account. Enforced against an agent's owner, so an admin
    // widens it here before moving someone else's agent to a new model.
    router.patch('/researcher/:id/limits', authenticate, requireRole('admin'), usersController.updateResearcherLimits);
    // Reset a researcher's password and/or set passwordLocked (for shared logins).
    router.patch('/researcher/:id/password', authenticate, requireRole('admin'), usersController.setResearcherPassword);

    return router;
};

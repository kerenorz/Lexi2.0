import { UserRole } from './users.type';

declare global {
    namespace Express {
        interface Request {
            user?: {
                _id: string;
                role: UserRole;
                experimentId?: string;
                limits?: { allowedModels?: string[] };
            };
        }
    }
}

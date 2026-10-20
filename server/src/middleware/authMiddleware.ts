import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UsersModel } from '../models/UsersModel';
import { UserRole } from '../types/users.type';

// Cookie first; Bearer fallback for the survey iframe, where Safari and Firefox block the
// third-party cookie. Same JWT and verification either way.
const readToken = (req: Request): string | undefined => {
    const cookieToken = req.cookies?.token;
    if (cookieToken) return cookieToken;
    const header = req.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
        return header.slice('Bearer '.length).trim() || undefined;
    }
    return undefined;
};

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) {
        return res.status(401).json({ message: 'Authentication required', reason: 'AUTH_REQUIRED' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY) as { id: string };
        const user = await UsersModel.findById(decoded.id, {
            _id: 1,
            role: 1,
            experimentId: 1,
            limits: 1,
        }).lean();

        if (!user) {
            return res.status(401).json({ message: 'User not found', reason: 'USER_NOT_FOUND' });
        }

        req.user = {
            _id: user._id.toString(),
            role: user.role as UserRole,
            experimentId: user.experimentId,
            // Pass through; undefined when the account has no restrictions.
            limits: user.limits,
        };

        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token', reason: 'INVALID_TOKEN' });
    }
};

// Sets req.user if a valid session exists; never rejects. For the segmented entry route, so a
// rehearsing researcher isn't counted as a participant. A bad token counts as no session, so a
// stale cookie can't lock out a participant mid-study.
export const attachUserIfPresent = async (req: Request, _res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) return next();
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY) as { id: string };
        const user = await UsersModel.findById(decoded.id, { _id: 1, role: 1, experimentId: 1, limits: 1 }).lean();
        if (user) {
            req.user = {
                _id: user._id.toString(),
                role: user.role as UserRole,
                experimentId: user.experimentId,
                limits: user.limits,
            };
        }
    } catch {
        // No session. Not an error here.
    }
    next();
};

export const requireRole = (...roles: UserRole[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required', reason: 'AUTH_REQUIRED' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Insufficient permissions', reason: 'INSUFFICIENT_PERMISSIONS' });
        }

        next();
    };
};

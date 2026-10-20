import { httpStatusOf } from './errors';

// Default error response. A numeric code that isn't an HTTP status (e.g. Mongo's 11000)
// becomes a 500; driver details such as the colliding key are never sent.
export const sendErrorResponse = (res, error): void => {
    if (error && typeof error.message === 'string' && (typeof error.code === 'number' || typeof error.status === 'number')) {
        const status = httpStatusOf(error);
        if (status === error.code || status === error.status) {
            res.status(status).json({ message: error.message, reason: error.reason });
            return;
        }
        res.status(500).json({
            message: error.message,
            reason: typeof error.reason === 'string' ? error.reason : 'UNEXPECTED',
        });
        return;
    }

    res.status(500).json({
        message: error?.message || 'Unexpected server error',
        reason: 'UNEXPECTED',
    });
};

// Last resort when the error answer failed. Reset to a bare 500 (the status set may be the one
// Node rejected) and drop the Content-Length set for a body never written.
const endUnanswered = (res): void => {
    try {
        if (!res.headersSent) {
            res.statusCode = 500;
            res.removeHeader('Content-Length');
        }
        res.end();
    } catch {}
};

export const requestHandler = (fn, onError?) => async (req, res) => {
    try {
        console.info(`Pending request: ${req.method} ${req.originalUrl}`);
        await fn(req, res);
        console.info(`Success request: ${req.method} ${req.originalUrl}`);
    } catch (error) {
        console.error(`Error occurred in request: ${req.method} ${req.originalUrl}`, error);

        // Nothing below may throw: Express 4 ignores the returned promise, so an unhandled
        // rejection would crash the process.

        // onError runs even after headers are sent (streaming handlers emit an error frame).
        // Guarded because non-streaming ones call res.status().json() unconditionally.
        if (onError) {
            try {
                onError(req, res, error);
            } catch (handlerError) {
                console.error(`onError handler failed: ${req.method} ${req.originalUrl}`, handlerError);
                endUnanswered(res);
            }
            return;
        }

        // No custom handler: nothing can be said once the response has started.
        if (res.headersSent) return;

        try {
            sendErrorResponse(res, error);
        } catch (responseError) {
            console.error(`Error response failed: ${req.method} ${req.originalUrl}`, responseError);
            endUnanswered(res);
        }
    }
};

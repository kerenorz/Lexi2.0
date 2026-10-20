export type ErrorReason =
    | 'UNEXPECTED'
    | 'AUTH_REQUIRED'
    | 'USER_NOT_FOUND'
    | 'INVALID_TOKEN'
    | 'INSUFFICIENT_PERMISSIONS'
    | 'INVALID_PROVIDER'
    | 'API_KEY_NOT_FOUND'
    | 'NO_API_KEY'
    | 'EXPERIMENT_MISCONFIGURED'
    | 'INVALID_API_KEY'
    | 'MESSAGE_LIMIT_EXCEEDED'
    | 'CONVERSATION_LIMIT_EXCEEDED'
    | 'TTS_PROVIDER_ERROR'
    | 'PARTICIPANTS_LIMIT_REACHED'
    | 'INVALID_CREDENTIALS'
    // Non-string login fields (e.g. a `{ $regex }` operator object). A malformed request, not a 401.
    | 'INVALID_CREDENTIALS_FORMAT'
    | 'INVALID_EXPERIMENT_ID'
    | 'INVALID_CONVERSATION_ID'
    | 'UNKNOWN_MODEL'
    | 'CONVERSATION_NOT_OWNED'
    // A well-formed message id that names nothing (vs. "not yours").
    | 'MESSAGE_NOT_FOUND'
    | 'NOT_GROUP_CONVERSATION'
    | 'GROUP_CONVERSATION'
    | 'CANNOT_CREATE_FOR_OTHER_USER'
    | 'EXPERIMENT_MISMATCH'
    | 'INVALID_MESSAGE_FORMAT'
    | 'MESSAGE_TOO_LONG'
    | 'CONTEXT_LENGTH_EXCEEDED'
    | 'PROVIDER_RATE_LIMITED'
    | 'PROVIDER_OVERLOADED'
    | 'PROVIDER_NO_CREDITS'
    | 'LLM_PROVIDER_ERROR'
    // 502 for a 1-1 completion with no text. Not terminal: a Resend usually works.
    | 'EMPTY_COMPLETION'
    // 504: no reply in PROVIDER_TIMEOUT_MS, or the stream idle for STREAM_IDLE_TIMEOUT_MS. Not terminal.
    | 'PROVIDER_TIMEOUT'
    // 409: messageNumber already taken by another writer. Not terminal; a Resend re-reads the transcript.
    | 'MESSAGE_NUMBER_CONFLICT'
    // 409: this clientMessageId is already saved. Tell it apart from MESSAGE_NUMBER_CONFLICT by
    // reason, not status: this one means "already saved", that one "not saved".
    | 'DUPLICATE_MESSAGE'
    // Survey segments. SEGMENT_CLOSED is a normal end of block, not a failure (no Resend).
    | 'EXPERIMENT_NOT_FOUND'
    | 'EXPERIMENT_INACTIVE'
    | 'SEGMENTS_NOT_ENABLED'
    | 'MISSING_EXTERNAL_PID'
    | 'SEGMENT_CLOSED'
    | 'SEGMENTS_EXHAUSTED'
    // Agent-only round refusals. The client stops its chain silently on any non-2xx here.
    // BUDGET_EXHAUSTED (429) also covers another agent-only round still generating.
    | 'CONVERSATION_FINISHED'
    | 'AUTONOMOUS_DISABLED'
    | 'AUTONOMOUS_BUDGET_EXHAUSTED'
    // Key grants. GRANT_EXISTS: revoke first to change an expiry.
    | 'GRANT_NOT_FOUND'
    | 'GRANT_EXISTS'
    | 'INVALID_GRANTEE'
    | 'INVALID_EXPIRY'
    // WRONG_CURRENT_PASSWORD is a 403, not 401: the client logs out on any 401.
    // PASSWORD_LOCKED: shared account, only an admin may change it. TOO_LONG: bcrypt's 72-byte limit.
    | 'WRONG_CURRENT_PASSWORD'
    | 'PASSWORD_LOCKED'
    | 'PASSWORD_TOO_SHORT'
    | 'PASSWORD_TOO_LONG'
    | 'INVALID_PASSWORD_FORMAT';

export class AppError extends Error {
    code: number;
    reason: ErrorReason;

    constructor(message: string, code: number, reason: ErrorReason) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.reason = reason;
    }
}

export const isAppError = (err: any): err is AppError =>
    err && typeof err.code === 'number' && typeof err.message === 'string' && typeof err.reason === 'string';

// Use an error's code/status only if it is 400-599. MongoDB errors carry their own numeric codes
// (e.g. 11000), and res.status(11000) throws when headers are written, which can crash the process.
const isHttpErrorStatus = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599;

export const httpStatusOf = (error: unknown): number => {
    const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
    if (isHttpErrorStatus(code)) return code;
    if (isHttpErrorStatus(status)) return status;
    return 500;
};

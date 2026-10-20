// Password rules for admins and researchers. Mirrored in client/src/utils/password.ts.

// The cost every existing account was hashed with.
export const BCRYPT_COST = 10;

export const MIN_PASSWORD_LENGTH = 8;

// bcrypt silently ignores input past 72 bytes, so longer passwords are refused. Bytes, not
// characters: a Hebrew letter is two bytes in UTF-8.
export const MAX_PASSWORD_BYTES = 72;

// 403 for a locked (shared) account changing its own password.
export const PASSWORD_LOCKED_MESSAGE = "This account's password can only be changed by an administrator.";

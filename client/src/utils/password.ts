// Client mirror of the server's password rules (users.service assertNewPassword). Keep in step.
export const MIN_PASSWORD_LENGTH = 8;

// Same sentence as the server's 403 for shared accounts.
export const PASSWORD_LOCKED_MESSAGE = "This account's password can only be changed by an administrator.";

// No 0/O, 1/l/I: the password is read off a screen and typed by someone else.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Random password for an admin to hand out; 16 of 55 symbols is about 92 bits.
 * Rejection sampling avoids modulo bias, since 256 is not a multiple of 55.
 */
export const generatePassword = (length = 16): string => {
    const limit = 256 - (256 % ALPHABET.length);
    const out: string[] = [];
    const bytes = new Uint8Array(length * 2);
    while (out.length < length) {
        crypto.getRandomValues(bytes);
        // Index loop: the client's TS target can't for...of a Uint8Array.
        for (let i = 0; i < bytes.length && out.length < length; i++) {
            if (bytes[i] < limit) out.push(ALPHABET[bytes[i] % ALPHABET.length]);
        }
    }
    return out.join('');
};

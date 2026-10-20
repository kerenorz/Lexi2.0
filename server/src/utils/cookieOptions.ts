import type { CookieOptions } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

// Production uses SameSite=None + Secure so the cookie works inside a third-party
// iframe (Qualtrics). Dev uses Lax because HTTP localhost can't satisfy Secure.
export const authCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

// clearCookie() must match the set options, or the browser ignores the clear.
export const authCookieClearOptions: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
};

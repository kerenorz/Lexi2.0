import { AxiosError } from 'axios';
import { ErrorReason } from './errorReasons';
import { isStreamRefusal, StreamRefusal } from './streamRefusal';

export type ExtractedError = {
    message: string;
    reason?: ErrorReason;
    status?: number;
    isNetworkError: boolean;
};

function isAxiosError(err: unknown): err is AxiosError {
    return typeof err === 'object' && err !== null && (err as any).isAxiosError === true;
}

export function extractError(err: unknown, fallback = 'Something went wrong'): ExtractedError {
    // A marked stream refusal has the same shape as an axios error and is read the same way.
    // An in-band error frame looks alike but is a failure, so it keeps the fallback.
    if ((isAxiosError(err) && err.response) || isStreamRefusal(err)) {
        const response = (err as AxiosError | StreamRefusal).response!;
        const data = response.data;
        const serverMessage =
            typeof data === 'object' && data !== null && typeof (data as any).message === 'string'
                ? (data as any).message
                : undefined;
        const serverReason =
            typeof data === 'object' && data !== null && typeof (data as any).reason === 'string'
                ? ((data as any).reason as ErrorReason)
                : undefined;
        return {
            message: serverMessage ?? fallback,
            reason: serverReason,
            status: response.status,
            isNetworkError: false,
        };
    }

    if (isAxiosError(err) && !err.response) {
        return {
            message: "Couldn't reach the server. Check your connection and try again.",
            status: undefined,
            isNetworkError: true,
        };
    }

    if (err instanceof Error && err.message) {
        return { message: err.message, isNetworkError: false };
    }

    return { message: fallback, isNetworkError: false };
}

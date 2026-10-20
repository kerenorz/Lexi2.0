// A non-2xx answer to a group stream request, before any round ran. `refused: true` separates it
// from a dropped stream: nothing was saved, so the client reports it and does not re-sync.
// Shaped like an axios error (`response.data.reason`).

export interface StreamRefusal {
    refused: true;
    response: { status: number; data: unknown };
}

export const streamRefusal = async (res: Response): Promise<StreamRefusal> => {
    // Non-JSON body (e.g. a proxy's 502 page) still reports the status.
    let data: unknown = { message: `Request failed (${res.status})` };
    try {
        data = await res.json();
    } catch {
        /* keep the status-only message */
    }
    return { refused: true, response: { status: res.status, data } };
};

export const isStreamRefusal = (error: unknown): error is StreamRefusal =>
    typeof error === 'object' && error !== null && (error as { refused?: unknown }).refused === true;

import { MessageType, AudioType } from '@root/models/AppModels';
import { ApiPaths } from '../constants';
import axiosInstance, { API_BASE_URL } from './AxiosInstance';
import { setEmbeddedToken, withAuthHeaders } from './embeddedSession';
import { createSseFrameParser } from './sseFrameParser';
import { streamRefusal } from '../streamRefusal';
import { useConversationId } from '@hooks/useConversationId';

function normalRandom(mean: number, stdDev: number): number {
    // Generate a random number from a standard normal distribution using Box-Muller transform
    let u = 1 - Math.random(); // Converting [0,1) to (0,1]
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + stdDev * z; // Scale and shift
}

function gammaRandom(shape: number, scale: number): number {
    // Approximate Gamma distribution using Marsaglia and Tsang's method
    if (shape < 1) {
        shape += 1;
    }
    let d = shape - 1 / 3;
    let c = 1 / Math.sqrt(9 * d);
    let x, v;
    do {
        let u = Math.random();
        let n = normalRandom(0, 1);
        v = Math.pow(1 + c * n, 3);
        if (v > 0 && Math.log(u) < 0.5 * n * n + d * (1 - v + Math.log(v))) {
            x = d * v;
            break;
        }
    } while (true);
    return x * scale;
}

function getResponseDelay(n_char: number, n_char_prev: number): number {
    // Jones C.R. et al. 2024 stochastic delay formula
    let delay = (normalRandom(0.3, 0.03) * n_char
        + gammaRandom(2.5, 0.25)
        + normalRandom(0.03, 0.003) * n_char_prev);
    return delay; // Time delay in seconds
}

export const sendMessage = async (message: MessageType, conversationId: string): Promise<MessageType[]> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/message`, {
            message,
            conversationId,
        });
        // HD replies are an array of paced segments the caller reveals with server timing, so
        // don't sleep for them here. Client-side pacing runs only for a plain single reply.
        const data: MessageType[] = Array.isArray(response.data) ? response.data : [response.data];
        const only = data.length === 1 ? data[0] : null;
        const enveloped =
            !!only && (only.typingDurationMs != null || only.segmentCount != null || only.preTypingDelayMs != null);
        if (only && !enveloped && typeof only.content === 'string' && only.content) {
            if (only.timeDelay != null && only.timeDelay != 0) {
                // Mode 1: simple words-per-second formula
                const num_word = only.content.trim().split(/\s+/).length;
                await new Promise((resolve) => setTimeout(resolve, (num_word / only.timeDelay) * 1000));
            } else if (only.timeDelay == 0) {
                // Mode 2: Jones C.R. et al. 2024 stochastic formula
                const num_char = only.content.length;
                const prev_num_char = only.prev_message?.length ?? 0;
                await new Promise((resolve) => setTimeout(resolve, getResponseDelay(num_char, prev_num_char) * 1000));
            }
        }
        return data;
    } catch (error) {
        throw error;
    }
};

// sendMessage's pacing in ms, for the group UI's per-message reveals.
// Clamped like the server: a negative or huge delay would make setTimeout fire immediately.
const TYPING_DURATION_CEILING_MS = 600000; // 10 min, same as the server

// 0 for blank input (`''.split(/\s+/)` has length 1). Mirrors the server's countWords.
const countWords = (text: string): number => {
    const t = text.trim();
    return t.length === 0 ? 0 : t.split(/\s+/).length;
};

export const computeMessageDelayMs = (msg: {
    content?: string | Blob;
    timeDelay?: number | null;
    prev_message?: string | null;
}): number => {
    // Group messages are always text; a Blob (audio) has no word/char pacing here.
    if (!msg || typeof msg.content !== 'string' || !msg.content) return 0;

    const bounded = (ms: number): number =>
        Number.isFinite(ms) ? Math.max(0, Math.min(TYPING_DURATION_CEILING_MS, ms)) : 0;

    if (msg.timeDelay != null && msg.timeDelay != 0) {
        return bounded((countWords(msg.content) / msg.timeDelay) * 1000);
    }
    if (msg.timeDelay == 0) {
        const num_char = msg.content.length;
        const prev_num_char = msg.prev_message?.length ?? 0;
        return bounded(getResponseDelay(num_char, prev_num_char) * 1000);
    }
    return 0;
};

// Returns agent messages in order. The UI paces the reveal.
export const sendGroupMessage = async (
    message: MessageType,
    conversationId: string,
): Promise<MessageType[]> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/message`, {
            message,
            conversationId,
        });
        return Array.isArray(response.data) ? response.data : [response.data];
    } catch (error) {
        throw error;
    }
};

// A token delta of a turn still being written. Finished turns arrive as a Message with no `type`.
export type GroupDelta = {
    type: 'delta';
    turnId: string;
    speakerId: string;
    speakerName: string;
    text: string;
    // Only on later bubbles of a split turn; the UI uses it instead of INTER_TURN_GAP_MS. On the
    // delta because the gap is needed before the turn's final frame may arrive.
    interSegmentPauseMs?: number;
};

export type GroupStreamCallbacks = {
    onTurn: (turn: MessageType) => void;
    onError: (error?: any) => void;
    // For token streaming; `stream` must also be true.
    onDelta?: (delta: GroupDelta) => void;
};

// Reads the NDJSON group stream, calling onTurn per turn. Never throws: failures go to onError.
// A non-ok response is a refusal (nothing persisted); any other error leaves server state unknown.
export const sendGroupStream = async (
    message: MessageType,
    conversationId: string,
    { onTurn, onError, onDelta }: GroupStreamCallbacks,
    stream = false,
): Promise<void> => {
    try {
        const res = await fetch(`${API_BASE_URL}/${ApiPaths.CONVERSATIONS_PATH}/message/group-stream`, {
            method: 'POST',
            credentials: 'include',
            // Raw fetch skips the axios interceptor, so attach the embedded token here.
            headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ message, conversationId, stream }),
        });

        if (!res.ok) {
            onError(await streamRefusal(res));
            return;
        }
        if (!res.body) {
            // Accepted, but nothing to read: what the server did is unknown, so not a refusal.
            onError({ status: res.status });
            return;
        }

        const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const obj = JSON.parse(trimmed);
            if (obj && obj.error) onError(obj.error);
            else if (obj && obj.type === 'delta') onDelta?.(obj as GroupDelta);
            else onTurn(obj as MessageType);
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Emit only complete lines; keep a trailing partial for the next chunk.
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                handleLine(buffer.slice(0, nl));
                buffer = buffer.slice(nl + 1);
            }
        }
        // Flush a final complete line that arrived without a trailing newline.
        if (buffer.trim()) handleLine(buffer);
    } catch (error) {
        onError(error);
    }
};

// sendGroupStream for an agent-only round (no user message). Same contract.
export const sendAutonomousRound = async (
    conversationId: string,
    { onTurn, onError, onDelta }: GroupStreamCallbacks,
    stream = false,
): Promise<void> => {
    try {
        const res = await fetch(`${API_BASE_URL}/${ApiPaths.CONVERSATIONS_PATH}/round/continue`, {
            method: 'POST',
            credentials: 'include',
            // Raw fetch skips the axios interceptor; without this, 401 where third-party cookies are blocked.
            headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ conversationId, stream }),
        });

        // The caller ends the agent-only chain silently on any error.
        if (!res.ok) {
            onError(await streamRefusal(res));
            return;
        }
        if (!res.body) {
            onError({ status: res.status });
            return;
        }

        const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const obj = JSON.parse(trimmed);
            if (obj && obj.error) onError(obj.error);
            else if (obj && obj.type === 'delta') onDelta?.(obj as GroupDelta);
            else onTurn(obj as MessageType);
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                handleLine(buffer.slice(0, nl));
                buffer = buffer.slice(nl + 1);
            }
        }
        if (buffer.trim()) handleLine(buffer);
    } catch (error) {
        onError(error);
    }
};

export const sendAudio = async (message: AudioType, conversationId: string): Promise<AudioType> => {
    console.log(message);

    const formData = new FormData();
    formData.append("audio", message.content); // Attach the Blob
    formData.append("role", message.role); // Attach other data
    formData.append("conversationId", conversationId); // Include conversation ID
    // The server keeps it only when well-formed.
    if (message.clientMessageId) formData.append("clientMessageId", message.clientMessageId);

    try {
        const response = await axiosInstance.post(
            `/${ApiPaths.CONVERSATIONS_PATH}/audio`,
            formData,
            { responseType: "blob" } // Ensures we receive binary audio data
        );

        // Convert response Blob into FormData
        const receivedFormData = new FormData();
        receivedFormData.append("audioBlob", response.data);

        // Extract metadata from headers if available
        const metadata = {
            contentType: response.headers["content-type"] || "audio/mpeg",
        };
        
        

        return {
            ...message, // Keep original message fields
            content: response.data, // Store the received audio as a Blob
            role: "assistant",
            //metadata, // Include metadata (optional)
        };
    } catch (error) {
        console.error("Error sending/receiving audio:", error);
        throw error;
    }
};



// Streams a 1-1 reply over SSE. fetch, not EventSource, which can't POST or read a JSON reply.
// HD and splitting replies come back as buffered JSON instead (onBufferedReply). The payload can't
// tell them apart, so the X-Lexi-Reveal header says which ('typewriter' = split). Never throws.
export const sendStreamMessage = async (
    message: MessageType,
    conversationId: string,
    onMessageReceived: (message: string) => void,
    onCloseStream: (message: MessageType) => void,
    onError: (error?: any) => void,
    onBufferedReply?: (messages: MessageType[], reveal?: string) => void | Promise<void>,
): Promise<void> => {
    try {
        const res = await fetch(`${API_BASE_URL}/${ApiPaths.CONVERSATIONS_PATH}/message/stream`, {
            method: 'POST',
            credentials: 'include',
            // Raw fetch skips the axios interceptor; without this, 401 where third-party cookies are blocked.
            headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ message, conversationId }),
        });

        if (!res.ok || !res.body) {
            let parsed: any = {
                response: { status: res.status, data: { message: `Request failed (${res.status})` } },
            };
            try {
                const data = await res.json();
                parsed = { response: { status: res.status, data } };
            } catch {
                /* non-JSON body: keep the status-only shape */
            }
            onError(parsed);
            return;
        }

        // Buffered short-circuit (HD or splitting): an already-decided reply, not a stream.
        if ((res.headers.get('content-type') || '').includes('application/json')) {
            const data = await res.json();
            const segments: MessageType[] = Array.isArray(data) ? data : [data];
            if (onBufferedReply) await onBufferedReply(segments, res.headers.get('x-lexi-reveal') ?? undefined);
            return;
        }

        const parser = createSseFrameParser({ onMessageReceived, onCloseStream, onError });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            parser.push(decoder.decode(value, { stream: true }));
        }
        parser.end();
    } catch (error) {
        onError(error);
    }
};

export const createConversation = async (
    userId: string,
    numberOfConversations: number,
    experimentId: string,
): Promise<string> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/create`, {
            userId,
            numberOfConversations,
            experimentId,
        });
        return response.data;
    } catch (error) {
        throw error;
    }
};

// Client view of the current block. Not the stored record, which would reveal the quota.
export interface SegmentView {
    number: number;
    isOpen: boolean;
    isFinal: boolean;
    canProceed: boolean;
    totalSegments: number;
    notice?: string;
}

export interface SegmentEntry {
    // Absent when needsRegistration.
    conversationId?: string;
    token?: string;
    segment: SegmentView | null;
    isPreview: boolean;
    exhausted: boolean;
    // Requested block not opened yet because a round was still generating. `segment` is
    // still the closing block.
    pendingSegment?: number;
    // No participant for this pid yet, so nothing was created. Register, then enter again.
    needsRegistration?: boolean;
}

// Enter or re-enter a chat block; idempotent. The returned token is kept as a bearer because
// Safari and Firefox drop the third-party cookie inside the survey iframe.
export const enterSegment = async (
    experimentId: string,
    pid: string | null,
    segment?: number | null,
): Promise<SegmentEntry> => {
    const response = await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/segments/enter`, {
        experimentId,
        ...(pid ? { pid } : {}),
        ...(segment != null ? { segment } : {}),
    });
    setEmbeddedToken(response.data?.token);
    return response.data;
};

// Not a passive read: the server evaluates the quota first, so a time limit can close an idle block.
export const getSegmentState = async (conversationId: string): Promise<SegmentView | null> => {
    const response = await axiosInstance.get(`/${ApiPaths.CONVERSATIONS_PATH}/segments/state`, {
        params: { conversationId },
    });
    return response.data?.segment ?? null;
};

// Researcher preview only. Closes the block through the same path a quota does.
export const previewCloseSegment = async (conversationId: string): Promise<SegmentView | null> => {
    const response = await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/segments/preview-close`, {
        conversationId,
    });
    return response.data?.segment ?? null;
};

// Researcher preview only. Posts mock survey answers for a gap to check the injected knowledge.
export const previewSurveyAnswers = async (
    experimentId: string,
    conversationId: string,
    gap: number,
    values: Record<string, unknown>,
): Promise<unknown> => {
    const response = await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/segments/answers`, {
        experimentId,
        conversationId,
        gap,
        values,
    });
    return response.data;
};

export const getConversation = async (conversationId: string): Promise<MessageType[]> => {
    try {
        const response = await axiosInstance.get(
            `/${ApiPaths.CONVERSATIONS_PATH}/conversation?conversationId=${conversationId}`,
        );
        //console.log(response["conversationMetaData"])
        
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const sendSnap = async (image: string, conversationId: string, experimentId: string): Promise<void> => {
    try {
        await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/sendSnap`, { image: image, conversationId: conversationId, experimentId: experimentId })
        console.log('Frame sent successfully')
    } catch (error) {
        throw error;
    }
};

export const updateIMS = async (
    conversationId: string,
    imsValues: object,
    isPreConversation: boolean,
): Promise<void> => {
    try {
        await axiosInstance.put(`/${ApiPaths.CONVERSATIONS_PATH}/ims`, {
            conversationId,
            imsValues,
            isPreConversation,
        });
        return;
    } catch (error) {
        throw error;
    }
};

export const updateConversationMetadata = async (
    conversationId: string,
    data: object,
    isPreConversation: boolean,
): Promise<void> => {
    try {
        await axiosInstance.put(`/${ApiPaths.CONVERSATIONS_PATH}/metadata`, {
            conversationId,
            data,
            isPreConversation,
        });
        return;
    } catch (error) {
        throw error;
    }
};

export const finishConversation = async (
    conversationId: string,
    experimentId: string,
): Promise<void> => {
    try {
        await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/finish`, {
            conversationId,
            experimentId,
        });
        return;
    } catch (error) {
        throw error;
    }
};

export const updateUserAnnotation = async (messageId: string, userAnnotation: number): Promise<void> => {
    try {
        await axiosInstance.put(`/${ApiPaths.CONVERSATIONS_PATH}/annotation`, {
            messageId,
            userAnnotation,
        });
        return;
    } catch (error) {
        throw error;
    }
};

// Fire-and-forget: actual render time per message. Failures are never shown to the participant.
export const reportDisplayedAt = async (
    conversationId: string,
    displays: { messageId: string; displayedAt: number }[],
): Promise<void> => {
    if (!displays.length) return;
    try {
        await axiosInstance.post(`/${ApiPaths.CONVERSATIONS_PATH}/message/displayed`, { conversationId, displays });
    } catch {
        /* telemetry only — ignore */
    }
};

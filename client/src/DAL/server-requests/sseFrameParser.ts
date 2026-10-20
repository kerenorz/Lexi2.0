import { MessageType } from '@root/models/AppModels';

// Incremental SSE parser for the 1-1 token stream: push() decoded chunks, end() at EOF.
// Frames: `data: {message}` per chunk, optional `data: {error}`, then `event: close` with the saved message.
export const createSseFrameParser = ({
    onMessageReceived,
    onCloseStream,
    onError,
}: {
    onMessageReceived: (message: string) => void;
    onCloseStream: (message: MessageType) => void;
    onError: (error?: any) => void;
}) => {
    let buffer = '';
    let sawClose = false;
    let reportedError = false;

    const handleFrame = (frame: string) => {
        const lines = frame.split('\n');
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const raw = dataLines.join('\n');
        if (!raw) return;

        // Unparseable = truncated tail. Skip, don't throw: throwing after close would wipe a
        // finished reply. end() reports a real drop.
        let payload: any;
        try {
            payload = JSON.parse(raw);
        } catch {
            return;
        }

        if (event === 'close') {
            sawClose = true;
            onCloseStream(payload);
            return;
        }
        if (payload && payload.error) {
            reportedError = true;
            onError(payload.error);
            return;
        }
        onMessageReceived(payload.message);
    };

    return {
        // Emit complete frames only; keep the partial tail. \r\n tolerated for rewriting proxies.
        push(chunk: string) {
            buffer += chunk;
            buffer = buffer.replace(/\r\n/g, '\n');
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) >= 0) {
                handleFrame(buffer.slice(0, sep));
                buffer = buffer.slice(sep + 2);
            }
        },
        end() {
            // Last frame may lack its trailing blank line.
            if (buffer.trim()) handleFrame(buffer);
            // No close frame means the connection dropped; report it or the loader hangs.
            if (!sawClose && !reportedError) {
                onError({ message: 'The connection closed before the reply finished.', isNetworkError: true });
            }
        },
    };
};

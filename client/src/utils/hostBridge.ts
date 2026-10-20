// Messages from an embedded chat to the host survey page, so it can show its Next button.
// Platform-agnostic: survey-specific logic lives in the embed kit snippet.

export type HostMessageType =
    // Sent on entry, after every round, and when a poll sees the block change.
    | 'segment-state'
    // The chat cannot run. The host must release Next or the participant is stranded.
    | 'error';

export interface HostMessage {
    // Lets a host with several widgets tell ours apart.
    source: 'lexi';
    type: HostMessageType;
    experimentId?: string;
    conversationId?: string;
    // 1-based block number.
    segment?: number;
    isOpen?: boolean;
    // The study's last block.
    isFinal?: boolean;
    // What the host gates Next on. A block with a message floor can be proceedable while
    // still open, so `isOpen` alone is not enough.
    canProceed?: boolean;
    totalSegments?: number;
    // Machine-readable cause, so the host can skip the remaining chat blocks.
    reason?: string;
}

// targetOrigin '*' is deliberate: the host domain is unknown. Safe only because the message
// carries nothing secret (no transcript, identity, token or study design). Keep it that way.
export const postToHost = (message: Omit<HostMessage, 'source'>): void => {
    // Not embedded.
    if (typeof window === 'undefined' || window.parent === window) return;
    try {
        window.parent.postMessage({ source: 'lexi', ...message }, '*');
    } catch {
        // A refused post must not break the chat; the host snippet has its own fallback.
    }
};

export const isEmbedded = (): boolean => typeof window !== 'undefined' && window.parent !== window;

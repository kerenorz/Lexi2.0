import LoadingDots from '@components/loadig-dots/LoadingDots';
import { Box } from '@mui/material';
import { MessageType } from '@root/models/AppModels';
import Message from './Message';
import { useEffect, useState } from 'react';

interface MessageListProps {
    isMobile: boolean;
    messages: MessageType[];
    isMessageLoading: boolean;
    size: 'sm' | 'lg';
    handleUpdateUserAnnotation: (messageId, userAnnotation) => void;
    experimentHasUserAnnotation: boolean;
    speakerColors?: Record<string, string>;
    // One indicator per agent typing. Empty = default dots.
    typingColors?: string[];
    // Delay before the default dots show.
    typingIndicatorDelayMs?: number;
}

const MessageList: React.FC<MessageListProps> = ({
    isMobile,
    messages,
    isMessageLoading,
    size,
    experimentHasUserAnnotation,
    handleUpdateUserAnnotation,
    speakerColors,
    typingColors,
    typingIndicatorDelayMs = 500,
}) => {
    // By speakerId, then speakerName. Undefined = default color.
    const resolveSpeakerColor = (message: MessageType): string | undefined => {
        if (!speakerColors) return undefined;
        return (
            (message.speakerId && speakerColors[message.speakerId]) ||
            (message.speakerName && speakerColors[message.speakerName]) ||
            undefined
        );
    };

    const [showLoadingDots, setShowLoadingDots] = useState(false);

    useEffect(() => {
        let timer;
        if (isMessageLoading) {
            timer = setTimeout(() => {
                setShowLoadingDots(true);
            }, typingIndicatorDelayMs);
        } else {
            setShowLoadingDots(false);
        }

        return () => clearTimeout(timer);
    }, [isMessageLoading, typingIndicatorDelayMs]);

    return (
    <Box height="100%" width={isMobile ? '100%' : '85%'} padding={2}>
        {messages.map((message, index) => (
            <Message
                key={index}
                message={message}
                role={message.role}
                size={size}
                handleUpdateUserAnnotation={handleUpdateUserAnnotation}
                experimentHasUserAnnotation={experimentHasUserAnnotation}
                speakerColor={resolveSpeakerColor(message)}
            />
        ))}
        {/* Keyed by color (speaker), not index, so a handoff shows a new bubble rather than one changing color. */}
        {typingColors && typingColors.length > 0
            ? typingColors.map((color) => <LoadingDots key={color} color={color} />)
            : showLoadingDots && <LoadingDots />}
    </Box>
);
};

export default MessageList;

import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { MessageType } from '@models/AppModels';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { Box, Button, IconButton } from '@mui/material';
import { useState, useRef } from 'react';
import { sendMessage, sendStreamMessage } from '../../../../DAL/server-requests/conversations';
import { StyledInputBase, StyledInputBox } from './InputBox.s';

interface InputBoxProps {
    isMobile: boolean;
    messages: MessageType[];
    setMessages: (messages: MessageType[] | ((prevMessages: MessageType[]) => MessageType[])) => void;
    conversationId: string;
    setIsMessageLoading: (isLoading: boolean) => void;
    fontSize: string;
    isStreamMessage: boolean;
}

const InputBox: React.FC<InputBoxProps> = ({
    isMobile,
    messages,
    fontSize,
    conversationId,
    setMessages,
    setIsMessageLoading,
    isStreamMessage,
}) => {
    const { openSnackbar } = useSnackbar();
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setSelectedImage(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleSendMessage = async () => {
        if (!message && !errorMessage && !message.trim().length && !selectedImage) {
            openSnackbar('Message cannot be empty', SnackbarStatus.WARNING);
            return;
        }
        const messageContent: string = message || errorMessage || '';
        const imageContent = selectedImage;
        const conversation: MessageType[] = [...messages, { content: messageContent, role: 'user', image: imageContent }];
        setMessages(conversation);
        setMessage('');
        setSelectedImage(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setIsMessageLoading(true);
        try {
            const response = await sendMessage({ content: messageContent, role: 'user', image: imageContent }, conversationId);
            setMessages((prevMessages) => [...prevMessages, response]);
            setIsMessageLoading(false);
            setErrorMessage(null);
        } catch (err) {
            onMessageError(conversation, messageContent, err);
        }
    };

    const onMessageError = (conversation, messageContent, error) => {
        setIsMessageLoading(false);
        setMessages([
            ...conversation,
            {
                content:
                    error.response && error.response.status && error.response.status === 403
                        ? 'Messeges Limit Exceeded'
                        : error?.response?.status === 400
                          ? 'Message Is Too Long'
                          : 'Network Error',
                role: 'assistant',
            },
        ]);
        openSnackbar('Failed to send message', SnackbarStatus.ERROR);
        setErrorMessage(messageContent);
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <Box
            style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                width: isMobile ? '95%' : '85%',
                alignItems: 'center',
            }}
        >
            {selectedImage && (
                <Box style={{ marginBottom: '8px', position: 'relative', display: 'inline-block' }}>
                    <img src={selectedImage} alt="preview" style={{ maxHeight: '100px', borderRadius: '8px' }} />
                    <IconButton
                        size="small"
                        onClick={() => { setSelectedImage(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: 'white' }}
                    >✕</IconButton>
                </Box>
            )}
            {errorMessage ? (
                <Button
                    variant="contained"
                    onClick={() => {
                        setMessage(errorMessage);
                        handleSendMessage();
                    }}
                    style={{ width: 'fit-content', marginBottom: '24px' }}
                >
                    Resend Message
                </Button>
            ) : (
                <StyledInputBox>
                    <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleImageSelect}
                    />
                    <IconButton onClick={() => fileInputRef.current?.click()}>
                        <AttachFileIcon />
                    </IconButton>
                    <StyledInputBase
                        fullWidth
                        placeholder="Type a message…"
                        multiline
                        maxRows={5}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        fontSize={fontSize === 'sm' ? '1rem' : '1.25rem'}
                    />
                    <IconButton color="primary" onClick={handleSendMessage}>
                        <SendIcon />
                    </IconButton>
                </StyledInputBox>
            )}
        </Box>
    );
};

export default InputBox;
import { useEffect, useRef, useState } from 'react';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { MessageType, AudioType } from '@models/AppModels';
import SendIcon from '@mui/icons-material/Send';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { sendMessage, sendStreamMessage, sendAudio } from '../../../../DAL/server-requests/conversations';
import { extractError } from '../../../../DAL/extractError';
import { createStreamReveal, StreamReveal } from './streamReveal';
import { newClientMessageId } from './clientMessageId';
import { StyledInputBase, StyledInputBox } from './InputBox.s';

interface InputBoxProps {
    isMobile: boolean;
    messages: MessageType[];
    setMessages: (messages: MessageType[] | ((prevMessages: MessageType[]) => MessageType[])) => void;
    conversationId: string;
    setIsMessageLoading: (isLoading: boolean) => void;
    fontSize: string;
    isStreamMessage: boolean;
    // Words per minute for the streamed reveal. Undefined uses the default.
    streamWordsPerMinute?: number;
}

const InputBox_mic: React.FC<InputBoxProps> = ({
    isMobile,
    messages,
    fontSize,
    conversationId,
    setMessages,
    setIsMessageLoading,
    isStreamMessage,
    streamWordsPerMinute,
}) => {
    const { openSnackbar } = useSnackbar();
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioURL, setAudioURL] = useState<string | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);
    const [hasAudio, setHasAudio] = useState(false);

    // True until the reveal finishes; two concurrent streams would mix into one bubble.
    const isStreamInFlightRef = useRef(false);
    // When the first character became visible, not when the first token arrived.
    const streamStartedAtRef = useRef<number | null>(null);
    // Held so unmount can flush it.
    const revealRef = useRef<StreamReveal | null>(null);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
    const [animationId, setAnimationId] = useState<number | null>(null);

    useEffect(() => {
        if (isRecording) {
            timerRef.current = window.setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } else if (timerRef.current) {
            clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isRecording]);

    // On unmount show the full reply; it is already saved server-side.
    useEffect(
        () => () => {
            revealRef.current?.finish();
            revealRef.current = null;
        },
        [],
    );

    const handleSend = () => {
        if (hasAudio && audioBlob) {
          handleAudio();
        } else {
          handleSendMessage();
        }
    };


    const handleAudio = async () => {
        console.log("Sending audio...");

        if (!audioBlob && !errorMessage) {
            openSnackbar('Message cannot be empty', SnackbarStatus.WARNING);
            return;
        }
        const messageContent: Blob = audioBlob;
        // Lets the server de-duplicate re-sends (clientMessageId.ts).
        const clientMessageId = newClientMessageId();
        const conversation: AudioType[] = [...messages, { content: messageContent, role: 'user', clientMessageId }];
        setMessages(conversation);
        setMessage('');
        setIsMessageLoading(true);
        try {
            {
                const response = await sendAudio({ content: messageContent, role: 'user', clientMessageId }, conversationId);
                console.log(response)
                setMessages((prevMessages) => [...prevMessages, response]);
                setIsMessageLoading(false);
                setErrorMessage(null);
            }
        } catch (err) {
            onMessageError(conversation, messageContent, err);
        }


        setAudioBlob(null);
        setHasAudio(false);
    };
    
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.current.push(event.data);
            };
            recorder.onstop = () => {
                const blob = new Blob(audioChunks.current, { type: 'audio/wav' });
                setAudioBlob(blob);
                setAudioURL(URL.createObjectURL(blob));
                //console.log('Audio recorded:', audioUrl);
                audioChunks.current = [];
            };
            recorder.start();
            setMediaRecorder(recorder);
            setIsRecording(true);
            setRecordingTime(0);

            // Visualizer
            const audioCtx = new AudioContext();
            const analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 256;
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyserNode);
            setAudioContext(audioCtx);
            setAnalyser(analyserNode);

            visualizeAudio(analyserNode);
        } catch (error) {
            console.error('Error accessing microphone:', error);
            openSnackbar('Microphone access denied', SnackbarStatus.ERROR);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder) {
            mediaRecorder.stop();
            setIsRecording(false);
            setHasAudio(true);
        }
        if (audioContext) {
            audioContext.close();
            setAudioContext(null);
        }
        if (animationId) {
            cancelAnimationFrame(animationId);
            setAnimationId(null);
        }

        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
    };

    const visualizeAudio = (analyser: AnalyserNode) => {
        const canvas = canvasRef.current;
        if (!canvasRef.current) {
            console.error("Canvas not found - Retrying in 500ms...");
            setTimeout(() => visualizeAudio(analyser), 500);
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error("Canvas context is null");
            return;
        }

        console.log("Canvas successfully found, starting visualization...");
    
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        console.log("Buffer Length in visual aud:", bufferLength);
    
        const draw = () => {
            analyser.getByteTimeDomainData(dataArray);
    
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.beginPath();
            ctx.strokeStyle = 'blue';
            ctx.lineWidth = 2;
    
            const sliceWidth = canvas.width / bufferLength;
            let x = 0;
    
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * canvas.height) / 2;
    
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
    
            ctx.stroke();
            requestAnimationFrame(draw);
        };
    
        draw();
    };
    
    const visualizePlayback = async () => {
        if (!audioBlob) return;
        
        console.log("audioBlob present I guess")
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioCtx = new AudioContext();
        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
    
        const source = audioCtx.createBufferSource();
        audioCtx.decodeAudioData(arrayBuffer, (buffer) => {
            source.buffer = buffer;
            source.connect(analyserNode);
            analyserNode.connect(audioCtx.destination);
            source.start();
        });
    
        setAudioContext(audioCtx);
        setAnalyser(analyserNode);
        visualizeAudio(analyserNode);
    };
    

    const handleSendMessage = async () => {
        if (!message && !errorMessage && !message.trim().length) {
            openSnackbar('Message cannot be empty', SnackbarStatus.WARNING);
            return;
        }
        // Refuse before mutating anything, or the message shows but is never sent.
        if (isStreamInFlightRef.current) {
            openSnackbar('Please wait for the current reply to finish.', SnackbarStatus.WARNING);
            return;
        }
        const messageContent: string = message || errorMessage;
        // Lets the server de-duplicate re-sends (clientMessageId.ts).
        const clientMessageId = newClientMessageId();
        const conversation: MessageType[] = [...messages, { content: messageContent, role: 'user', clientMessageId }];
        setMessages(conversation);
        setMessage('');

        setIsMessageLoading(true);
        try {
            if (isStreamMessage) {
                isStreamInFlightRef.current = true;
                streamStartedAtRef.current = null;
                try {
                    await runStreamedTurn(conversation, messageContent, clientMessageId);
                } finally {
                    isStreamInFlightRef.current = false;
                }
            } else {
                const response = await sendMessage({ content: messageContent, role: 'user', clientMessageId }, conversationId);
                // sendMessage returns an array; spread it.
                setMessages((prevMessages) => [...prevMessages, ...response]);
                setIsMessageLoading(false);
                setErrorMessage(null);
            }
        } catch (err) {
            onMessageError(conversation, messageContent, err);
        }
    };

    const onMessageError = (conversation, messageContent, error) => {
        setIsMessageLoading(false);
        const { message: errorText, isNetworkError } = extractError(error, "Couldn't send message");
        setMessages([
            ...conversation,
            {
                content: errorText,
                role: 'assistant',
            },
        ]);
        if (isNetworkError) {
            openSnackbar(errorText, SnackbarStatus.ERROR);
        }
        setErrorMessage(messageContent);
    };

    // Resolves when the reveal finishes, not when the network closes, so the in-flight guard
    // covers the whole animation.
    const runStreamedTurn = async (conversation: MessageType[], messageContent: string, clientMessageId: string) => {
        let saved: MessageType | null = null;
        let aborted = false;
        // First onText appends the bubble, later ones replace it. Outside the updater, which React may run twice.
        let bubbleCreated = false;

        let resolveReveal!: () => void;
        const revealFinished = new Promise<void>((resolve) => {
            resolveReveal = resolve;
        });

        const reveal = createStreamReveal({
            wpm: streamWordsPerMinute,
            onText: (visible) => {
                setIsMessageLoading(false);
                if (streamStartedAtRef.current === null) streamStartedAtRef.current = Date.now();
                const isFirst = !bubbleCreated;
                bubbleCreated = true;
                setMessages((prevMessages) => {
                    const lastMessage = prevMessages[prevMessages.length - 1];
                    if (isFirst || !lastMessage || lastMessage.role !== 'assistant') {
                        return [...prevMessages, { content: visible, role: 'assistant' }];
                    }
                    return [...prevMessages.slice(0, -1), { ...lastMessage, content: visible }];
                });
                setErrorMessage(null);
            },
            onComplete: () => resolveReveal(),
        });
        revealRef.current = reveal;

        await sendStreamMessage(
            { content: messageContent, role: 'user', clientMessageId },
            conversationId,
            (chunk) => reveal.push(chunk),
            (savedMessage) => {
                saved = savedMessage;
            },
            (error) => {
                aborted = true;
                reveal.cancel();
                resolveReveal();
                onMessageError(conversation, messageContent, error);
            },
            // Human Deception overrides streaming and returns paced segments; just append them.
            (segments) => {
                aborted = true;
                reveal.cancel();
                resolveReveal();
                setMessages((prevMessages) => [...prevMessages, ...segments]);
                setIsMessageLoading(false);
                setErrorMessage(null);
            },
        );

        if (!aborted) reveal.endInput();
        await revealFinished;
        revealRef.current = null;

        if (aborted || !saved) return;
        finalizeStreamedReply(saved);
    };

    // Attach the saved _id after the reveal drains; it arrives well before the reveal ends.
    const finalizeStreamedReply = (message: MessageType) => {
        setIsMessageLoading(false);
        streamStartedAtRef.current = null;
        setMessages((prevMessages) => {
            const lastMessage = prevMessages[prevMessages.length - 1];
            // Empty completion: the last bubble is the user's, so append rather than stamp it.
            if (!lastMessage || lastMessage.role !== 'assistant') {
                return [
                    ...prevMessages,
                    {
                        content: message.content ?? '',
                        role: 'assistant',
                        _id: message._id,
                        userAnnotation: message.userAnnotation,
                    },
                ];
            }
            return [
                ...prevMessages.slice(0, -1),
                { ...lastMessage, _id: message._id, userAnnotation: message.userAnnotation },
            ];
        });
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
                    <StyledInputBase
                        fullWidth
                        placeholder={isRecording ? "Recording in progress..." : "Type a message…"}
                        multiline
                        // Direction follows the typed text (Hebrew or English).
                        inputProps={{ dir: 'auto' }}
                        maxRows={5}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        fontSize={fontSize === 'sm' ? '1rem' : '1.25rem'}
                        disabled={isRecording}
                    />
                    <IconButton color="primary" onClick={isRecording ? stopRecording : startRecording}>
                        {isRecording ? <StopIcon /> : <MicIcon />}
                    </IconButton>
                    <IconButton color="primary" onClick={handleSend}>
                        <SendIcon />
                    </IconButton>
                </StyledInputBox>

            )}

            <Box style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 10 }}>  
                {isRecording && (
                    <Typography variant="body1" color="secondary">
                        Recording: {recordingTime}s
                    </Typography>
                )}
                <canvas
                    ref={canvasRef}
                    width={300}
                    height={50}
                    style={{ backgroundColor: '#f5f5f5', borderRadius: '5px', marginTop: '10px' }}
                />
            </Box>

            {audioBlob && (
                <IconButton color="primary" onClick={visualizePlayback}>
                    <PlayArrowIcon />
                </IconButton>
            )}
        </Box>
    );
};

export default InputBox_mic;

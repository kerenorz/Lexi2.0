import { getConversation, getSegmentState, updateUserAnnotation } from '@DAL/server-requests/conversations';
import type { SegmentView } from '@DAL/server-requests/conversations';
import { sendSnap } from '@DAL/server-requests/conversations';
import { postToHost } from '@root/utils/hostBridge';
import SegmentPreviewPanel from './components/SegmentPreviewPanel';
import { extractError } from '@DAL/extractError';
import FinishConversationDialog from '@components/common/FinishConversationDialog';
import LoadingPage from '@components/common/LoadingPage';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import { useConversationId } from '@hooks/useConversationId';
import { useExperimentId } from '@hooks/useExperimentId';
import useEffectAsync from '@hooks/useEffectAsync';
import { Box, Dialog, Grid, Typography, useMediaQuery } from '@mui/material';
import theme, { speakerMessageColors } from '@root/Theme';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExperimentCoversationForms, getExperimentFeatures } from '../../DAL/server-requests/experiments';
import { ConversationForm } from '../../components/forms/conversation-form/ConversationForm';
//import { useExperimentId } from '../../hooks/useExperimentId';
import { UserAnnotation } from '../../models/AppModels';
import { MainContainer, MessageListContainer, SectionContainer, SectionInnerContainer } from './ChatPage.s';
import MessageList from './components/MessageList';
import InputBox from './components/input-box/InputBox';
import InputBox_mic from './components/input-box/InputBox_mic';
import { SidebarChat } from './components/side-bar-chat/SideBarChat';
import React from "react";
import ReactWebcam from "react-webcam";
//import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
//import '@tensorflow/tfjs-backend-webgl';

interface ChatPageProps {
isFinishDialogOpen: boolean;
setIsFinishDialogOpen: (open: boolean) => void;
// Set by SegmentEntry for survey-embedded chats; otherwise the id comes from the URL.
conversationId?: string;
initialSegment?: SegmentView | null;
// Researcher rehearsing their own study.
isPreview?: boolean;
}

// Block state poll, so a time quota can close the block for a participant who stopped typing.
const SEGMENT_POLL_MS = 20000;

// "At bottom" tolerance: a streamed frame can add a line, and scroll heights can be fractional.
const BOTTOM_SLACK_PX = 64;

const ChatPage: React.FC<ChatPageProps> = ({
    isFinishDialogOpen,
    setIsFinishDialogOpen,
    conversationId: conversationIdProp,
    initialSegment = null,
    isPreview = false,
}) => {
    const navigate = useNavigate();
    const messagesRef = useRef(null);
    const { openSnackbar } = useSnackbar();
    const [messages, setMessages] = useState([]);
    const [conversationForms, setConversationForms] = useState({
        preConversation: null,
        postConversation: null,
    });
    const [messageFontSize, setMessageFontSize] = useState<'sm' | 'lg'>('lg');
    const [surveyOpen, setIsSurveyOpen] = useState(false);
    const [isPageLoading, setIsPageLoading] = useState(true);
    const [experimentFeatures, setExperimentFeatures] = useState(null);
    const [isMessageLoading, setIsMessageLoading] = useState(false);
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const questionnaireLink = 'https://docs.google.com/forms/u/0/?tgif=d&ec=asw-forms-hero-goto';
    // Hook called unconditionally; `prop ?? useConversationId()` would skip it and break hook order.
    const routeConversationId = useConversationId();
    const conversationId = conversationIdProp ?? routeConversationId;
    const experimentId = useExperimentId();
    // null unless the study is survey-embedded, which disables all segment behaviour.
    const [segment, setSegment] = useState<SegmentView | null>(initialSegment);
    const segmentRef = useRef<SegmentView | null>(initialSegment);
    const [cameraAccess, setCameraAccess] = useState(false);
    const [audioAccess, setAudioAccess] = useState(false);
    const [isGroup, setIsGroup] = useState(false);
    const [speakerColors, setSpeakerColors] = useState<Record<string, string>>({});
    // Group: agent-only rounds while the participant is silent (0 = off).
    const [autonomousRounds, setAutonomousRounds] = useState(0);
    // Colors of group agents currently typing. Empty = default loading dots.
    const [typingColors, setTypingColors] = useState<string[]>([]);
    const webcamRef = useRef(null);

    // Autoscroll only while the participant is at the bottom. Streaming updates ~60x/s, so
    // always scrolling would make scrolling up impossible.
    const isPinnedToBottomRef = useRef(true);
    const prevMessageCountRef = useRef(0);

    const handleMessagesScroll = () => {
        const el = messagesRef.current;
        if (!el) return;
        isPinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    };

    useEffect(() => {
        const el = messagesRef.current;
        if (!el) return;
        // Sending a message re-pins. Checked on count growth, since a streamed bubble replaces in place.
        const grew = messages.length > prevMessageCountRef.current;
        prevMessageCountRef.current = messages.length;
        if (grew && messages[messages.length - 1]?.role === 'user') isPinnedToBottomRef.current = true;
        if (isPinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
    }, [messages]);

    // Typing indicators change height without changing `messages`.
    useEffect(() => {
        const el = messagesRef.current;
        if (el && isPinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
    }, [typingColors, isMessageLoading]);

    // iOS doesn't resize an iframe for the keyboard; only visualViewport reports it.
    // Re-scroll so the composer stays above the keyboard.
    useEffect(() => {
        const vv = (window as any).visualViewport;
        if (!vv) return undefined;
        const onViewportChange = () => {
            const el = messagesRef.current;
            if (el && isPinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
        };
        vv.addEventListener('resize', onViewportChange);
        vv.addEventListener('scroll', onViewportChange);
        return () => {
            vv.removeEventListener('resize', onViewportChange);
            vv.removeEventListener('scroll', onViewportChange);
        };
    }, []);
    
    useEffectAsync(async () => {
        const preConversationFormAnsweredKey = `preConversationFormAnswered-${conversationId}`;
        const preConversationFormAnsweredKeyAnswered = sessionStorage.getItem(preConversationFormAnsweredKey);
        try {
            const [conversation, conversationForms, experimentFeaturesRes] = await Promise.all([
                getConversation(conversationId),
                getExperimentCoversationForms(experimentId),
                getExperimentFeatures(experimentId),
            ]);
            //console.log(conversationId, conversation)
            const metaSegment: SegmentView | null = conversation['conversationMetaData']?.segment ?? null;
            if (metaSegment) {
                segmentRef.current = metaSegment;
                setSegment(metaSegment);
            }
            // No pre-conversation form in a survey-embedded study; the survey owns the questions.
            if (!metaSegment && !preConversationFormAnsweredKeyAnswered && conversationForms.preConversation) {
                setIsSurveyOpen(true);
            }
            setConversationForms(conversationForms);
            setExperimentFeatures(experimentFeaturesRes);
            //console.log(conversation['conversation'])
            if (Array.isArray(conversation['conversation'])) {
                setMessages(conversation['conversation'].length ? conversation['conversation'] : []);
              } else {
                console.error('Invalid conversation format:', conversation['conversation']);
              }
            setIsPageLoading(false);

            // Group: speaker color by roster index, keyed by id and by name.
            const metaData = conversation['conversationMetaData'];
            const conversationIsGroup = metaData?.mode === 'Group';
            setIsGroup(conversationIsGroup);
            setAutonomousRounds(Number(metaData?.turnTaking?.autonomousRounds) || 0);
            if (conversationIsGroup && Array.isArray(metaData?.agents)) {
                const colorMap: Record<string, string> = {};
                metaData.agents.forEach((agent, index) => {
                    const color = speakerMessageColors[index % speakerMessageColors.length];
                    if (agent?._id) colorMap[String(agent._id)] = color;
                    const name = agent?.displayName || agent?.title;
                    if (name) colorMap[name] = color;
                });
                setSpeakerColors(colorMap);
            }

            let cameraAccess = false;
            let audioAccess = false;
            if (conversation["conversationMetaData"]["agent"]["cameraCaptureRate"] != null) {
                setCameraAccess(true);
            }
            if (conversation["conversationMetaData"]["agent"]["audioInput"] != null) {
                setAudioAccess(true);
            }
        } catch (err) {
            const { message } = extractError(err, 'Failed to load conversation');
            openSnackbar(message, SnackbarStatus.ERROR);
            navigate(-1);
        }
    }, []);

    useEffectAsync(async () => {
        let intervalId;
        const captureAndSendFrame = () => {
        if (webcamRef.current) {
            const imageSrc = webcamRef.current.getScreenshot({ width: 1280, height: 720 });
            //console.log(imageSrc);
            if (imageSrc && imageSrc.startsWith('data:image/')) {
                sendSnap(imageSrc, conversationId, experimentId);
            }
            /*else {
                console.error('No image source available or invalid format', imageSrc);
            }*/
                }        }
        if (cameraAccess) {
            intervalId = setInterval(captureAndSendFrame, 10000); // every 10 s
        }
    
        return () => clearInterval(intervalId);
    }, [conversationId, cameraAccess]);
    
    // Fetch block state (the server may close it on this call) and report it to the host survey.
    const refreshSegment = React.useCallback(async () => {
        if (!segmentRef.current) return null;
        try {
            const next = await getSegmentState(conversationId);
            if (!next) return null;
            segmentRef.current = next;
            setSegment(next);
            postToHost({
                type: 'segment-state',
                experimentId,
                conversationId,
                segment: next.number,
                isOpen: next.isOpen,
                isFinal: next.isFinal,
                canProceed: next.canProceed,
                totalSegments: next.totalSegments,
            });
            return next;
        } catch {
            // Ignored; the next round or poll retries.
            return null;
        }
    }, [conversationId, experimentId]);

    // Poll only while the block is open; a closed block never reopens.
    useEffect(() => {
        if (!segment?.isOpen) return undefined;
        const id = setInterval(refreshSegment, SEGMENT_POLL_MS);
        return () => clearInterval(id);
    }, [segment?.isOpen, segment?.number, refreshSegment]);

    const handlePreConversationSurveyDone = () => {
        const preConversationFormAnsweredKey = `preConversationFormAnswered-${conversationId}`;
        sessionStorage.setItem(preConversationFormAnsweredKey, 'true');
        setIsSurveyOpen(false);
    };

    const handleUpdateUserAnnotation = async (messageId: string, userAnnotation: UserAnnotation) => {
        try {
            await updateUserAnnotation(messageId, userAnnotation);
            setMessages(
                messages.map((message) => (message._id === messageId ? { ...message, userAnnotation } : message))
            );
            //console.log("Vaibhav here: ", messages)
            //console.log("Vaibhav again: ", setMessages)
        } catch (error) {
            console.log(error);
        }
    };
    
    return isPageLoading ? (
        <LoadingPage />
    ) : (
        <MainContainer container>
            {!isMobile && (
                <Grid item xs={2} sm={2} md={2} lg={2} style={{ backgroundColor: '#f5f5f5' }}>
                    <SidebarChat
                        setIsOpen={setIsFinishDialogOpen}
                        setMessageFontSize={setMessageFontSize}
                        messageFontSize={messageFontSize}
                    />
                </Grid>
            )}
            {cameraAccess && (
                <ReactWebcam
                ref = {webcamRef}
                //style={{ width: '100%' }} 
                //style={{ display: 'none' }}  This will hide the webcam feed
                style={{ 
                    position: 'fixed', 
                    width: '1px', 
                    height: '1px', 
                    opacity: 0 
                  }}
                screenshotFormat='image/jpeg'
                videoConstraints={{
                    width: 1280,
                    height: 720,
                    facingMode: 'user'
                  }}
                />)}
            <Grid item xs={12} sm={10} md={10} lg={10}>
                <SectionContainer>
                    <SectionInnerContainer container direction="column">
                        <MessageListContainer ref={messagesRef} item onScroll={handleMessagesScroll}>
                            <MessageList
                                isMobile={isMobile}
                                messages={messages}
                                isMessageLoading={isMessageLoading}
                                size={messageFontSize}
                                handleUpdateUserAnnotation={handleUpdateUserAnnotation}
                                experimentHasUserAnnotation={experimentFeatures?.userAnnotation}
                                speakerColors={isGroup ? speakerColors : undefined}
                                typingColors={typingColors}
                                typingIndicatorDelayMs={isGroup ? 0 : 500}
                            />
                        </MessageListContainer>
                        {segment && isPreview && (
                            <SegmentPreviewPanel
                                experimentId={experimentId}
                                conversationId={conversationId}
                                segment={segment}
                                onChanged={refreshSegment}
                            />
                        )}
                        <Grid item display={'flex'} justifyContent={'center'}>
                            {segment && !segment.isOpen ? (
                                // Block over: replace the composer (a disabled box invites retries).
                                <Box padding={2} textAlign="center" width="100%">
                                    <Typography variant="body2" color="textSecondary">
                                        {segment.notice || 'Thanks — please continue with the survey.'}
                                    </Typography>
                                </Box>
                            ) : audioAccess && !isGroup ? (
                                <InputBox_mic
                                    isMobile={isMobile}
                                    messages={messages}
                                    setMessages={setMessages}
                                    conversationId={conversationId}
                                    setIsMessageLoading={setIsMessageLoading}
                                    fontSize={messageFontSize}
                                    isStreamMessage={experimentFeatures?.streamMessage}
                                    streamWordsPerMinute={experimentFeatures?.streamWordsPerMinute}
                                />
                            ) : (
                                <InputBox
                                    isMobile={isMobile}
                                    messages={messages}
                                    setMessages={setMessages}
                                    conversationId={conversationId}
                                    setIsMessageLoading={setIsMessageLoading}
                                    fontSize={messageFontSize}
                                    isStreamMessage={experimentFeatures?.streamMessage}
                                    streamWordsPerMinute={experimentFeatures?.streamWordsPerMinute}
                                    isGroup={isGroup}
                                    speakerColors={speakerColors}
                                    setTypingColors={setTypingColors}
                                    autonomousRounds={autonomousRounds}
                                    isSegmented={!!segment}
                                    onRoundEnd={refreshSegment}
                                />
                            )}
                        </Grid>
                    </SectionInnerContainer>
                </SectionContainer>
            </Grid>
            {isFinishDialogOpen && (
                <FinishConversationDialog
                    open={isFinishDialogOpen}
                    setIsOpen={setIsFinishDialogOpen}
                    questionnaireLink={questionnaireLink}
                    form={conversationForms.postConversation}
                />
            )}
            <Dialog
                open={surveyOpen}
                maxWidth={'lg'}
                fullScreen={isMobile}
                PaperProps={{
                    style: {
                        maxHeight: isMobile ? 'none' : '70vh',
                        overflow: 'auto',
                    },
                }}
            >
                <ConversationForm
                    form={conversationForms.preConversation}
                    isPreConversation={true}
                    handleDone={handlePreConversationSurveyDone}
                />
            </Dialog>
        </MainContainer>
    );

};

export default ChatPage;


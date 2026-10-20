import { extractError } from '@DAL/extractError';
import { createConversation } from '@DAL/server-requests/conversations';
import { getExperimentContent, updateExperimentDisplaySettings } from '@DAL/server-requests/experiments';
import { Pages } from '@app/App';
import AsyncButton from '@components/common/AsyncButton';
import LoadingPage from '@components/common/LoadingPage';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import useActiveUser from '@hooks/useActiveUser';
import useEffectAsync from '@hooks/useEffectAsync';
import { useExperimentId } from '@hooks/useExperimentId';
import CancelIcon from '@mui/icons-material/Cancel';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import { Button, Typography, useMediaQuery } from '@mui/material';
import theme from '@root/Theme';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';
import {
    BodyContent,
    ButtonsBox,
    StartButton,
    StyledContainer,
    TextFieldStyled,
    TitleContent,
    TitleTextField,
} from './Home.s';

const Home: React.FC = () => {
    const { activeUser } = useActiveUser();
    const { openSnackbar } = useSnackbar();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const experimentId = useExperimentId();
    const [isLoadingPage, setIsLoadingPage] = useState(true);
    const [isLoadingUpdate, setIsLoadingUpdate] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(null);
    const [experimentContent, setExperimentContent] = useState<any>(null);
    // Participants only; a researcher on their own inactive study still gets the full page.
    const [isStudyInactive, setIsStudyInactive] = useState(false);

    useEffectAsync(async () => {
        try {
            const { content, isActive } = await getExperimentContent(experimentId);
            setExperimentContent(content);
            if (!isActive) {
                if (activeUser.role === 'admin' || activeUser.role === 'user') {
                    openSnackbar('Experiment is not active', SnackbarStatus.WARNING);
                } else {
                    // Stay here with a notice and keep the session. Logging out would 401-redirect
                    // to the admin login, and re-registering later would create a second participant.
                    setIsStudyInactive(true);
                }
            }
        } catch (err) {
            const { message } = extractError(err, 'Failed to load experiment');
            openSnackbar(message, SnackbarStatus.ERROR);
            navigate(Pages.PROJECT_OVERVIEW);
        }
        setIsLoadingPage(false);
    }, []);

    const handleEdit = () => {
        setIsEditing(true);
        setEditedContent(experimentContent);
    };

    const handleContentChange = (event) => {
        const { name, value } = event.target;
        setEditedContent({ ...editedContent, [name]: value });
    };

    const handleSave = async () => {
        setIsLoadingUpdate(true);
        try {
            await updateExperimentDisplaySettings(experimentId, editedContent);
            setExperimentContent(editedContent);
            openSnackbar('Update Success', SnackbarStatus.SUCCESS);
        } catch (err) {
            const { message } = extractError(err, 'Update Failed');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
        setIsEditing(false);
        setIsLoadingUpdate(false);
    };

    const startConversation = async () => {
        try {
            const newConversationId = await createConversation(
                activeUser._id,
                activeUser.numberOfConversations,
                experimentId,
            );
            navigate(
                `${Pages.EXPERIMENT_CONVERSATION.replace(':experimentId', experimentId).replace(
                    ':conversationId',
                    newConversationId,
                )}`,
            );
        } catch (err) {
            if (err?.response?.status === 403) {
                const { message } = extractError(err, 'Conversations Limit Exceeded');
                openSnackbar(message, SnackbarStatus.ERROR);
                return;
            }
            const { message } = extractError(err, 'Failed to start a new conversation');
            openSnackbar(message, SnackbarStatus.ERROR);
        }
    };

    // Notice only: no welcome text, no "Start Conversation".
    if (isStudyInactive) {
        return (
            <StyledContainer>
                <Typography variant="h5" dir="auto" textAlign="center">
                    This study is not currently active
                </Typography>
            </StyledContainer>
        );
    }

    return isLoadingPage ? (
        <LoadingPage />
    ) : (
        <StyledContainer>
            {isEditing ? (
                <TitleTextField
                    variant="outlined"
                    multiline
                    name="welcomeHeader"
                    value={editedContent.welcomeHeader}
                    onChange={handleContentChange}
                    fullWidth
                    inputProps={{ style: { whiteSpace: 'normal' } }}
                />
            ) : (
                <TitleContent variant={'h2'}>
                    {experimentContent ? experimentContent.welcomeHeader : ''}
                </TitleContent>
            )}
            {isEditing ? (
                <TextFieldStyled
                    variant="outlined"
                    multiline
                    name="welcomeContent"
                    rows={4}
                    value={editedContent.welcomeContent}
                    onChange={handleContentChange}
                    fullWidth
                    inputProps={{ style: { whiteSpace: 'normal' } }}
                />
            ) : (
                <BodyContent variant={'h6'} textAlign={'center'} width={isMobile ? '90%' : '60%'}>
                    {experimentContent ? experimentContent.welcomeContent : ''}
                </BodyContent>
            )}
            <StartButton variant="contained" color="primary" onClick={startConversation} isMobile={isMobile}>
                Start Conversation
            </StartButton>
            {(activeUser?.role === 'admin' || activeUser?.role === 'user') && (
                <ButtonsBox>
                    <AsyncButton
                        isLoading={isLoadingUpdate}
                        variant="outlined"
                        onClick={isEditing ? handleSave : handleEdit}
                        style={{ minWidth: '36px' }}
                        size="small"
                    >
                        {isEditing ? (
                            <SaveIcon sx={{ fontSize: '1.25rem' }} />
                        ) : (
                            <EditIcon sx={{ fontSize: '1.25rem' }} />
                        )}
                    </AsyncButton>
                    {isEditing && (
                        <Button
                            variant="outlined"
                            onClick={() => setIsEditing(false)}
                            style={{ minWidth: '36px', marginLeft: '10px' }}
                            size="small"
                        >
                            <CancelIcon sx={{ fontSize: '1.25rem' }} />
                        </Button>
                    )}
                </ButtonsBox>
            )}
        </StyledContainer>
    );
};

export default Home;

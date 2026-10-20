import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, Grid, IconButton, Typography, useMediaQuery } from '@mui/material';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { updateConversationMetadata } from '../../../DAL/server-requests/conversations';
import theme from '../../../Theme';
import { Pages } from '../../../app/App';
import { useConversationId } from '../../../hooks/useConversationId';
import { useExperimentId } from '../../../hooks/useExperimentId';
import Question from '../../questions/Question';
import { FitButton } from '../CommonFormStyles.s';
import {
    ConversationFormButtonContainer,
    ConversationFormContainer,
    ConversationFormFieldTitle,
    ConversationFormTitle,
} from './ConversationForm.s';
import { submitQuestionnaire } from './questionnaireSubmit';

// Fixed text: server errors can be internal, and the only fix is pressing Continue again.
const SAVE_FAILED = 'Your answers could not be saved. Please try again.';

interface FinalRegisterFormProps {
    form: any;
    isPreConversation: boolean;
    handleDone: () => void;
}

export const ConversationForm: React.FC<FinalRegisterFormProps> = ({ form, isPreConversation, handleDone }) => {
    const conversationId = useConversationId();
    const experimentId = useExperimentId();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();

    const {
        register,
        handleSubmit,
        getValues,
        setValue,
        control,
        formState: { errors },
    } = useForm();

    // The ref is the real in-flight guard: state only disables the button on the next render,
    // so a quick double press would save twice.
    const [isSaving, setIsSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const savingRef = useRef(false);

    // Save first; `handleDone` unmounts the form only after success, so a failed save keeps the
    // answers and Continue retries.
    const onSubmit = async (data) => {
        if (savingRef.current) return;
        savingRef.current = true;
        setIsSaving(true);
        setSaveFailed(false);
        const outcome = await submitQuestionnaire({
            save: () => updateConversationMetadata(conversationId, data, isPreConversation),
            onSaved: handleDone,
        });
        // Saved: keep Continue disabled while the form goes away.
        if (outcome.status === 'saved') return;
        console.error("Couldn't save the questionnaire answers", outcome.error);
        savingRef.current = false;
        setIsSaving(false);
        setSaveFailed(true);
    };

    return (
        <ConversationFormContainer
            isMobile={isMobile}
            style={{ paddingLeft: isMobile ? '4px' : '4vw', paddingRight: isMobile ? '4px' : '4vw' }}
        >
            {isPreConversation && (
                <Box style={{ display: 'flex', alignItems: 'center' }}>
                    <IconButton
                        color="inherit"
                        onClick={() => navigate(`${Pages.EXPERIMENT.replace(':experimentId', experimentId)}`)}
                    >
                        <ArrowBackIcon />
                    </IconButton>
                    <ConversationFormFieldTitle>Go Back Home</ConversationFormFieldTitle>
                </Box>
            )}
            <ConversationFormTitle variant="h4" gutterBottom style={{ margin: 0 }}>
                {form.title}
            </ConversationFormTitle>
            <ConversationFormTitle variant="subtitle1" gutterBottom style={{ margin: 0, marginBottom: '16px' }}>
                {form.instructions}
            </ConversationFormTitle>
            {form &&
                form?.questions.map((question, index) => (
                    <Grid item xs={12} key={index}>
                        <Question
                            type={question.type}
                            props={question.props}
                            errors={errors}
                            register={register}
                            getValues={getValues}
                            setValue={setValue}
                            control={control}
                        />
                    </Grid>
                ))}

            <ConversationFormButtonContainer>
                <FitButton variant="contained" color="primary" disabled={isSaving} onClick={handleSubmit(onSubmit)}>
                    Continue
                </FitButton>
            </ConversationFormButtonContainer>
            {saveFailed && (
                // role="alert" for screen readers; dir="auto" for RTL translations.
                <Typography
                    role="alert"
                    dir="auto"
                    variant="body2"
                    color="error"
                    align="center"
                    style={{ marginTop: '8px' }}
                >
                    {SAVE_FAILED}
                </Typography>
            )}
        </ConversationFormContainer>
    );
};

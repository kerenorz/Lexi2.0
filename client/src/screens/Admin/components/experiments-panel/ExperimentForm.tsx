import {
    DEFAULT_STREAM_WPM,
    MAX_MOVE_CHANCE,
    MAX_MOVE_CHANCE_SUM,
    MAX_STREAM_WPM,
    MIN_STREAM_WPM,
    defaultExperiment,
    isAgentDocHumanized,
} from '@DAL/constants';
import { extractError } from '@DAL/extractError';
import { saveExperiment, updateExperiment } from '@DAL/server-requests/experiments';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import FieldInfo from '@components/common/FieldInfo';
import { AgentsModes } from '@models/AppModels';
import {
    Box,
    Checkbox,
    CircularProgress,
    FormControl,
    FormControlLabel,
    InputAdornment,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import StyledSelection from '../../../../components/common/StyledSelection';
import { getFormErrorMessage } from '../../../../utils/commonFunctions';
import { AbAgents } from '../agents-panel/active-agents/AbAgents';
import { GroupAgents } from '../agents-panel/active-agents/GroupAgents';
import { GroupDriftControls } from '../agents-panel/active-agents/GroupDriftControls';
import { AgentPicker } from '../shared/AgentPicker';
import { experimentUsesConversationPhases } from '../shared/conversationPhases';
import { MainContainer, SaveButton } from '../agents-panel/agent-form/AgentForm.s';
import {
    PhaseScheduleEditor,
    normalizePhaseSchedule,
    phaseScheduleForForm,
    validatePhaseSchedule,
} from './PhaseScheduleEditor';
import { SegmentsEditor, normalizeSegments, validateSegments } from './SegmentsEditor';
import { ApiKeyOverrides, normalizeApiKeyOverrides } from './ApiKeyOverrides';
import { useAppSelector } from '@DAL/redux/store';

// Returns an error message or null. Skipped when the feature is off, since stale values are never read.
const MOVE_CHANCE_FIELDS = ['groundChance', 'shiftChance', 'returnChance', 'closeChance'] as const;
const validateThreadControl = (threadControl: any): string | null => {
    if (threadControl?.enabled !== true) return null;
    let sum = 0;
    for (const field of MOVE_CHANCE_FIELDS) {
        const value = threadControl[field];
        if (value == null) continue; // absent = default
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > MAX_MOVE_CHANCE) {
            return `Thread control: each move chance must be between 0 and ${MAX_MOVE_CHANCE}.`;
        }
        sum += n;
    }
    if (sum > MAX_MOVE_CHANCE_SUM) {
        return 'Thread control: the four move chances must add up to 1 or less, so an ordinary reply is still possible.';
    }
    return null;
};

const modeLabels: Record<string, string> = {
    [AgentsModes.SINGLE]: 'Single Condition',
    [AgentsModes.AB]: 'A/B',
    [AgentsModes.GROUP]: 'Group',
};

const ExperimentForm = ({
    editExperiment,
    experiments,
    tempExperiments,
    setTempExperiments,
    agents,
    setExperiments,
    closeDialog,
    isEditMode = false,
    forms,
}) => {
    // Convert stored phase totals to per-phase durations exactly once; converting twice would
    // corrupt the schedule. normalizePhaseSchedule converts back on save.
    const initialValues = useMemo(
        () =>
            editExperiment
                ? { ...editExperiment, phaseSchedule: phaseScheduleForForm((editExperiment as any).phaseSchedule) }
                : defaultExperiment,
        [],
    );
    const {
        register,
        control,
        handleSubmit,
        watch,
        setValue,
        getValues,
        formState: { errors },
    } = useForm({ defaultValues: initialValues });
    const [isSaveLoading, setIsSaveLoading] = useState(false);

    // "Conversation phases" checkbox: derived from content, not stored. Seeded once so deleting
    // the last phase row mid-edit doesn't collapse the section.
    const [phasesOpen, setPhasesOpen] = useState(() => experimentUsesConversationPhases(initialValues as any));
    const formTitle = useMemo(() => (!isEditMode ? 'New Experiment' : 'Edit Experiment'), []);
    const { openSnackbar } = useSnackbar();
    // Only the owner picks billing keys; an admin would see their own keys, which the server refuses.
    const activeUser = useAppSelector((state) => state.activeUser);
    const ownedByCurrentUser =
        !isEditMode || !editExperiment?.ownerId || String(editExperiment.ownerId) === String(activeUser?._id);
    const agentsMode = watch('agentsMode');
    // Watched so the per-block phase trigger appears as soon as the box is ticked.
    const isSegmented = !!(watch('segments') as any)?.enabled;

    // Human Deception overrides streaming on the server, so reflect that here. Splitting
    // does not block streaming.
    const activeAgent = watch('activeAgent');
    const abAgents = watch('abAgents');
    const groupAgents = watch('groupAgents');

    // Must match the server's isHumanized.
    const isAgentHumanized = (agentId) => {
        if (!agentId) return false;
        const agent = agents.find((a) => String(a._id) === String(agentId));
        return isAgentDocHumanized(agent);
    };

    const selectedAgentIds = useMemo(() => {
        if (agentsMode === AgentsModes.SINGLE) return [activeAgent].filter(Boolean);
        if (agentsMode === AgentsModes.AB) return [abAgents?.agentA, abAgents?.agentB].filter(Boolean);
        return (groupAgents || []).filter(Boolean);
    }, [agentsMode, activeAgent, abAgents?.agentA, abAgents?.agentB, groupAgents]);

    // Full agent docs for the phase editor. Unresolvable ids (legacy object values) drop out.
    const rosterAgents = useMemo(
        () => selectedAgentIds.map((id) => agents.find((a) => String(a._id) === String(id))).filter(Boolean),
        [selectedAgentIds, agents],
    );

    // Disabled if every agent is humanized, or in group mode if any is (group streaming is all
    // or nothing per round). A mixed A/B stays enabled: one streaming arm is a valid design.
    const humanizedCount = selectedAgentIds.filter(isAgentHumanized).length;
    const isGroupMode = agentsMode === AgentsModes.GROUP;
    const allSelectedAreHumanized = selectedAgentIds.length > 0 && humanizedCount === selectedAgentIds.length;
    const groupHasHumanized = isGroupMode && humanizedCount > 0;
    const streamDisabled = allSelectedAreHumanized || groupHasHumanized;
    const streamPartiallyIgnored = !streamDisabled && !isGroupMode && humanizedCount > 0;

    // Don't save a flag the run can't honour.
    useEffect(() => {
        if (streamDisabled && getValues('experimentFeatures.streamMessage')) {
            setValue('experimentFeatures.streamMessage', false);
        }
    }, [streamDisabled]);

    const streamMessageOn = watch('experimentFeatures.streamMessage');
    const streamWpm = watch('experimentFeatures.streamWordsPerMinute');

    // Slow speeds lock the participant's input for minutes, so show the estimate.
    const revealEstimate = useMemo(() => {
        const wpm = Number(streamWpm);
        if (!Number.isFinite(wpm) || wpm <= 0) return '';
        const seconds = (150 / wpm) * 60;
        const pretty =
            seconds < 60
                ? `${Math.round(seconds)} seconds`
                : `${Math.floor(seconds / 60)} min ${String(Math.round(seconds % 60)).padStart(2, '0')} sec`;
        return `A typical 150-word reply will take about ${pretty} to appear.`;
    }, [streamWpm]);

    // Unticking clears the content after a confirm: hidden settings must not stay active.
    const handlePhasesToggle = (event) => {
        if (event.target.checked) {
            setPhasesOpen(true);
            return;
        }
        if (experimentUsesConversationPhases(getValues() as any)) {
            const ok = window.confirm(
                'Turning off Conversation phases will delete this experiment’s phase schedule and turn off ' +
                    'the Scene, Thread control and Memory window settings. Continue?',
            );
            if (!ok) return;
            setValue('phaseSchedule', undefined);
            setValue('turnTaking.scene', '');
            setValue('turnTaking.threadControl.enabled', false);
            setValue('turnTaking.memoryWindow', false);
        }
        setPhasesOpen(false);
    };

    const updateExperimentInList = (updatedExp) => {
        const updatedSettings = experiments.map((exp) => (exp._id === updatedExp._id ? updatedExp : exp));
        setTempExperiments(updatedSettings);
        setExperiments(updatedSettings);
    };

    const handleSave = async (data) => {
        setIsSaveLoading(true);
        try {
            // Clamp the reveal rate; the input can hold blank or out-of-range values.
            if (data.experimentFeatures) {
                const wpm = Number(data.experimentFeatures.streamWordsPerMinute);
                data.experimentFeatures.streamWordsPerMinute = Number.isFinite(wpm)
                    ? Math.min(MAX_STREAM_WPM, Math.max(MIN_STREAM_WPM, Math.round(wpm)))
                    : DEFAULT_STREAM_WPM;
            }
            if (data.agentsMode === AgentsModes.SINGLE) {
                data.abAgents = null;
                delete data.groupAgents;
                delete data.turnTaking;
                delete data.firstMessageSender;
            } else if (data.agentsMode === AgentsModes.AB) {
                data.activeAgent = null;
                delete data.groupAgents;
                delete data.turnTaking;
                delete data.firstMessageSender;
            } else {
                data.activeAgent = null;
                data.abAgents = null;
                const groupAgents = (data.groupAgents || []).filter(Boolean);
                if (groupAgents.length < 1 || groupAgents.length > 2) {
                    openSnackbar('Select 1 or 2 agents for Group mode.', SnackbarStatus.ERROR);
                    setIsSaveLoading(false);
                    return;
                }
                data.groupAgents = groupAgents;

                // The server silently rescales an over-1 sum; tell the researcher now instead.
                const threadIssue = validateThreadControl(data.turnTaking?.threadControl);
                if (threadIssue) {
                    openSnackbar(threadIssue, SnackbarStatus.ERROR);
                    setIsSaveLoading(false);
                    return;
                }
            }

            // Phases apply to every mode, so this sits outside the group-only stripping above.
            // Segments are passed to check that block triggers are reachable.
            const phaseIssues = validatePhaseSchedule(data.phaseSchedule, rosterAgents, data.segments);
            if (phaseIssues.length) {
                openSnackbar(phaseIssues[0].message, SnackbarStatus.ERROR);
                setIsSaveLoading(false);
                return;
            }
            // Segments apply to every mode too.
            const segmentIssues = validateSegments(data.segments, data.maxMessages);
            if (segmentIssues.length) {
                openSnackbar(segmentIssues[0].message, SnackbarStatus.ERROR);
                setIsSaveLoading(false);
                return;
            }
            const segments = normalizeSegments(data.segments);
            if (segments) {
                data.segments = segments;
            } else if (isEditMode && editExperiment?.segments) {
                // Explicit null so `$set` clears the old config.
                data.segments = null;
            } else {
                // Never had it: omit the key rather than write null.
                delete data.segments;
            }

            // Same null-vs-omit rule as segments.
            const apiKeyOverrides = normalizeApiKeyOverrides(data.apiKeyOverrides);
            if (apiKeyOverrides) {
                data.apiKeyOverrides = apiKeyOverrides;
            } else if (isEditMode && editExperiment?.apiKeyOverrides) {
                data.apiKeyOverrides = null;
            } else {
                delete data.apiKeyOverrides;
            }

            const phaseSchedule = normalizePhaseSchedule(data.phaseSchedule, rosterAgents);
            if (phaseSchedule) {
                data.phaseSchedule = phaseSchedule;
            } else if (isEditMode && editExperiment?.phaseSchedule) {
                // Explicit null so `$set` clears it, or the study keeps phasing.
                data.phaseSchedule = null;
            } else {
                // Never had one: omit the key rather than write null.
                delete data.phaseSchedule;
            }

            const parsedExperiment = {
                ...data,
                activeAgent: !data.activeAgent ? null : data.activeAgent.toString(),
                maxMessages: !data.maxMessages ? null : Number(data.maxMessages),
                maxConversations: !data.maxConversations ? null : Number(data.maxConversations),
                maxParticipants: !data.maxParticipants ? null : Number(data.maxParticipants),
                isActive: data.isActive,
            };
            if (!isEditMode) {
                const savedExperiment = await saveExperiment(parsedExperiment);
                setTempExperiments([...tempExperiments, savedExperiment]);
                setExperiments([...experiments, savedExperiment]);
            } else {
                await updateExperiment(parsedExperiment);
                updateExperimentInList(parsedExperiment);
            }
            openSnackbar('Experiment Saved !', SnackbarStatus.SUCCESS);
            setIsSaveLoading(false);
            closeDialog();
        } catch (error) {
            const { message } = extractError(error, 'Experiment Saving Failed');
            openSnackbar(message, SnackbarStatus.ERROR);
            setIsSaveLoading(false);
        }
    };

    return (
        <MainContainer as="form" onSubmit={handleSubmit(handleSave)} style={{ padding: '32px' }}>
            <Typography variant="h4" gutterBottom margin="normal">
                {formTitle}
            </Typography>
            <TextField
                fullWidth
                required
                label="Title"
                {...register('title', { required: 'Title is required.' })}
                error={!!errors.title}
                helperText={getFormErrorMessage(errors.title)}
                size="small"
                margin="normal"
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <FieldInfo text="Experiment name, for your dashboard; not shown to participants." />
                        </InputAdornment>
                    ),
                }}
            />
            <TextField
                maxRows={3}
                rows={3}
                multiline
                fullWidth
                label="Description"
                {...register('description')}
                size="small"
                margin="normal"
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                            <FieldInfo text="Optional internal note describing the experiment." />
                        </InputAdornment>
                    ),
                }}
            />
            <Typography
                style={{
                    color: 'grey',
                    marginBottom: '4px',
                    marginTop: '8px',
                    borderBottom: '1px solid grey',
                }}
            >
                Experiment Agents:
            </Typography>
            <FormControl
                margin="dense"
                size="small"
                sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
            >
                <Typography>
                    Experimental Design:
                    <FieldInfo text="Single = one agent; A/B = each participant randomly gets one of two; Group = one participant chats with up to two named agents together." />
                </Typography>
                <Controller
                    name="agentsMode"
                    control={control}
                    render={({ field }) => (
                        <Select {...field} labelId="agent-mode-select-label" style={{ minWidth: '100px' }}>
                            {Object.values(AgentsModes).map((mode) => (
                                <MenuItem key={mode} value={mode}>
                                    {modeLabels[mode] ?? mode}
                                </MenuItem>
                            ))}
                        </Select>
                    )}
                />
            </FormControl>
            {agentsMode === AgentsModes.SINGLE ? (
                <FormControl
                    margin="dense"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>
                        Active Agent:
                        <FieldInfo text="The agent participants talk to in this Single-mode experiment." />
                    </Typography>
                    <Controller
                        name="activeAgent"
                        control={control}
                        defaultValue={agents.length ? agents[0] : ''}
                        rules={{ required: 'Active agent is required.' }}
                        render={({ field }) => (
                            <AgentPicker
                                agents={agents}
                                value={field.value}
                                onChange={field.onChange}
                                error={!!errors.activeAgent}
                            />
                        )}
                    />
                    {errors.activeAgent && (
                        <Typography color="error">{getFormErrorMessage(errors.activeAgent)}</Typography>
                    )}
                </FormControl>
            ) : agentsMode === AgentsModes.AB ? (
                <AbAgents
                    agents={agents}
                    control={control}
                    setValue={setValue}
                    getValues={getValues}
                    isRow={false}
                    errors={errors}
                />
            ) : (
                <GroupAgents
                    agents={agents}
                    control={control}
                    setValue={setValue}
                    watch={watch}
                    getValues={getValues}
                />
            )}
            {/* Conversation phases, under the roster so per-agent timelines sit by their agents. */}
            <Box style={{ width: '100%', marginTop: 12 }}>
                <FormControlLabel
                    control={<Checkbox size="small" checked={phasesOpen} onChange={handlePhasesToggle} />}
                    label={
                        <Tooltip title="Advanced. Lets ONE conversation change character as it goes — warm and including at the start, distant and excluding later, for example — on a schedule you set here, with the text each agent uses written on the agents themselves. In Group mode it also holds the settings that keep two agents from drifting off the study's topic. Leave it off for an ordinary experiment.">
                            <Typography variant="body2">Conversation phases</Typography>
                        </Tooltip>
                    }
                />
                {phasesOpen && (
                    <Box style={{ paddingLeft: 12, borderLeft: '2px solid #eee' }}>
                        {/* isSegmented only controls whether the block trigger is offered. */}
                        <PhaseScheduleEditor
                            control={control}
                            rosterAgents={rosterAgents}
                            isSegmented={isSegmented}
                        />
                        {/* Group only: turnTaking is stripped for Single/AB. */}
                        {isGroupMode && <GroupDriftControls control={control} watch={watch} />}
                    </Box>
                )}
            </Box>
            {/* Next to phases: survey studies usually run one phase per block. */}
            <SegmentsEditor control={control} />
            <Typography
                style={{
                    color: 'grey',
                    marginBottom: '4px',
                    marginTop: '8px',
                    borderBottom: '1px solid grey',
                }}
            >
                Experiment Features:
            </Typography>
            <Box style={{ width: '100%' }}>
                <Controller
                    name="experimentFeatures.userAnnotation"
                    control={control}
                    render={({ field }) => (
                        <FormControlLabel
                            control={<Checkbox {...field} checked={field.value} />}
                            label={
                                <>
                                    <span>User Annotation</span>
                                    <FieldInfo text="Lets participants mark each agent reply thumbs up/down, saved with the message." />
                                </>
                            }
                        />
                    )}
                />
            </Box>
            <Box style={{ width: '100%' }}>
                <Controller
                    name="experimentFeatures.streamMessage"
                    control={control}
                    render={({ field }) => (
                        <FormControlLabel
                            control={<Checkbox {...field} checked={!!field.value} disabled={streamDisabled} />}
                            label={
                                <>
                                    <span style={{ color: streamDisabled ? 'grey' : undefined }}>
                                        Stream Message
                                    </span>
                                    <FieldInfo text="Shows the agent's reply as it is generated, word by word, instead of all at once. Works in Single, A/B and Group conversations. An agent with Human Deception on always ignores this: HD delivers a reply behind a typing indicator, and an indicator on top of text that is already appearing is a contradiction. In Group mode a single humanized agent turns the whole round back into that paced delivery. Splitting does NOT block streaming — a splitting agent still streams, it just has to write the whole reply before it can decide where to cut, so its first text appears a few seconds later and then each part is typed out as its own bubble. Turning this on also removes the agent's pre-typing pause and typing indicator, since text is already arriving on screen." />
                                </>
                            }
                        />
                    )}
                />
                {streamDisabled && (
                    <Typography variant="caption" style={{ color: 'grey', display: 'block' }}>
                        {groupHasHumanized
                            ? 'Not available: a Group round streams only when NO agent has Human Deception on — a typing indicator and text appearing as it is written are contradictory reveals, so HD takes priority.'
                            : 'Not available: every selected agent has Human Deception on, which delivers behind a typing indicator and so always takes priority.'}
                    </Typography>
                )}
                {streamPartiallyIgnored && (
                    <Typography variant="caption" style={{ color: '#b26a00', display: 'block' }}>
                        Note: one of the selected agents has Human Deception on and will ignore this — only the
                        other arm will stream.
                    </Typography>
                )}
                {streamMessageOn && !streamDisabled && (
                    <Box style={{ marginTop: '8px', marginLeft: '32px' }}>
                        <Controller
                            name="experimentFeatures.streamWordsPerMinute"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    value={field.value ?? DEFAULT_STREAM_WPM}
                                    onChange={(e) =>
                                        field.onChange(e.target.value === '' ? '' : Number(e.target.value))
                                    }
                                    type="number"
                                    size="small"
                                    label="Typing speed (words/min)"
                                    inputProps={{ min: MIN_STREAM_WPM, max: MAX_STREAM_WPM, step: 10 }}
                                    style={{ width: '220px' }}
                                />
                            )}
                        />
                        <FieldInfo text="How fast the reply appears on the participant's screen. The model still generates at full speed — this only paces how the text is uncovered. 80 is real human typing speed, but it is slow: a 150-word reply takes almost 2 minutes, and the participant cannot reply until it finishes. 200 reads as fast-but-human (~45 seconds)." />
                        <Typography
                            variant="caption"
                            style={{ color: 'grey', display: 'block', marginTop: '4px' }}
                        >
                            {revealEstimate}
                        </Typography>
                    </Box>
                )}
            </Box>

            <Typography
                style={{
                    color: 'grey',
                    marginBottom: '4px',
                    marginTop: '8px',
                    borderBottom: '1px solid grey',
                }}
            >
                Experiment Forms:
            </Typography>
            <Box width={'100%'} paddingLeft={'16px'} style={{ marginBottom: '24px' }}>
                <StyledSelection
                    label="Registration"
                    options={forms}
                    control={control}
                    name="experimentForms.registration"
                    placeholder={'No Form'}
                    info="Optional form shown when a participant first registers (e.g. demographics)."
                />
                <StyledSelection
                    label="Before Conversation"
                    options={forms}
                    control={control}
                    name="experimentForms.preConversation"
                    placeholder={'No Form'}
                    info="Optional survey shown right before the conversation begins."
                />
                <StyledSelection
                    label="After Conversation"
                    options={forms}
                    control={control}
                    name="experimentForms.postConversation"
                    placeholder={'No Form'}
                    info="Optional survey shown after they finish."
                />
            </Box>
            {/* Renders only when there's a key choice to make, so it has its own heading. */}
            <ApiKeyOverrides control={control} ownedByCurrentUser={ownedByCurrentUser} />
            <Typography
                style={{
                    color: 'grey',
                    marginBottom: '4px',
                    marginTop: '8px',
                    borderBottom: '1px solid grey',
                }}
            >
                Experiment Boundaries:
            </Typography>
            <Typography style={{ fontSize: '0.75rem', color: 'rgba(0, 0, 0, 0.6)', padding: '8px' }}>
                * Leave blank for no limit
            </Typography>
            <TextField
                fullWidth
                label="Max Participants"
                {...register('maxParticipants')}
                size="small"
                margin="dense"
                type="number"
                InputLabelProps={{ shrink: true }}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <FieldInfo text="Total participants allowed to register." />
                        </InputAdornment>
                    ),
                }}
            />
            <TextField
                fullWidth
                label="Max Conversations"
                {...register('maxConversations')}
                size="small"
                margin="dense"
                type="number"
                InputLabelProps={{ shrink: true }}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <FieldInfo text="How many separate conversations one participant may start." />
                        </InputAdornment>
                    ),
                }}
            />
            <TextField
                fullWidth
                label="Max Messages"
                {...register('maxMessages')}
                size="small"
                margin="dense"
                type="number"
                InputLabelProps={{ shrink: true }}
                style={{ marginBottom: '12px' }}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <FieldInfo text="Cap on messages a participant can send per conversation; only their messages count, not the agents'." />
                        </InputAdornment>
                    ),
                }}
            />
            <Box style={{ width: '100%' }}>
                <Controller
                    name="isActive"
                    control={control}
                    render={({ field }) => (
                        <FormControlLabel
                            control={<Checkbox {...field} checked={field.value} />}
                            label="Activate Experiment"
                        />
                    )}
                />
            </Box>
            <SaveButton type="submit" variant="contained" color="primary" style={{ marginBottom: 0 }}>
                {isSaveLoading ? <CircularProgress size={28} sx={{ color: 'white' }} /> : 'Save Experiment'}
            </SaveButton>
        </MainContainer>
    );
};

export default ExperimentForm;

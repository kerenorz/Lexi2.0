// Phase timing editor (on the experiment, so all agents share one clock). Phase text lives on
// each agent; the server merges them at conversation creation (mergeAgentPhases).
// Logic lives in phaseScheduleConfig.ts, re-exported below.
import FieldInfo from '@components/common/FieldInfo';
import { AgentType, PhaseBoundary, PhaseScheduleConfig, PhaseScheduleMode } from '@models/AppModels';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Button, MenuItem, Select, TextField, Typography } from '@mui/material';
import React, { useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { agentLabel } from '../shared/AgentPicker';
import {
    PhaseIssueField,
    boundariesForAgent,
    countInputValue,
    declaresSegment,
    padTo,
    perAgentIds,
    rowCount,
    scheduleMode,
    secondsInputValue,
    validatePhaseSchedule,
} from './phaseScheduleConfig';

export type { PhaseIssueField, PhaseScheduleIssue } from './phaseScheduleConfig';
export {
    accumulateBoundaries,
    boundariesForAgent,
    declaresSegment,
    differenceBoundaries,
    formatMmSs,
    normalizePhaseSchedule,
    parseCountInput,
    parseSecondsInput,
    phaseScheduleForForm,
    validatePhaseSchedule,
} from './phaseScheduleConfig';

// Matches the section headers in GroupAgents and ExperimentForm.
const sectionHeader = (text: string, info?: string) => (
    <Typography style={{ color: 'grey', marginBottom: '4px', marginTop: '12px', borderBottom: '1px solid grey' }}>
        {text}
        {info && <FieldInfo text={info} />}
    </Typography>
);

const WARNING_COLOR = '#b26a00';
const CAPTION_COLOR = 'rgba(0,0,0,0.6)';

// Shared by the Timeline selector and an empty-roster perAgent row.
const PICK_AGENTS_HINT = "Pick the experiment's agents above to give each one its own start times.";

// Warns when an agent's phase-text count doesn't match the schedule's. Both counts cover
// phases from 2 up (phase 1 is the base prompt).
const textAdvisory = (agent: AgentType, length: number): { text: string; warn: boolean } | null => {
    if (!length || !agent) return null;
    const authored = (agent.phases && agent.phases.length) || 0;
    const name = agentLabel(agent) || 'This agent';

    if (authored === 0) {
        return {
            warn: true,
            text: `${name} defines no phase texts, so it keeps its base prompts for the whole conversation — the schedule will advance but nothing it says will change. Add phase texts on the agent.`,
        };
    }
    if (authored < length) {
        // The server carries the last authored phase forward, not the base prompts.
        const first = authored + 2;
        const last = length + 1;
        const range = first === last ? `phase ${first}` : `phases ${first}–${last}`;
        return {
            warn: false,
            text: `${name} defines ${authored} phase text${
                authored === 1 ? '' : 's'
            }; the schedule has ${length} — ${range} will keep phase ${authored + 1}'s text.`,
        };
    }
    if (authored > length) {
        const dropped = authored - length;
        return {
            warn: true,
            text: `${name} defines ${authored} phase texts but the schedule has only ${length} — the last ${dropped} will be DROPPED, because a phase with no trigger can never start. Add ${dropped} more phase${
                dropped === 1 ? '' : 's'
            } here, or remove them on the agent.`,
        };
    }
    return null;
};

interface TriggerPairProps {
    boundary: PhaseBoundary;
    onPatch: (patch: PhaseBoundary) => void;
    heading?: string;
    showTail: boolean;
    secondsError: boolean;
    messagesError: boolean;
    segmentError: boolean;
    // Offer the block field on segmented studies; a row that already declares one always shows it.
    showSegment: boolean;
}

// Edited as a per-phase duration; stored as total elapsed (see accumulateBoundaries).
const TriggerPair: React.FC<TriggerPairProps> = ({
    boundary,
    onPatch,
    heading,
    showTail,
    secondsError,
    messagesError,
    segmentError,
    showSegment,
}) => (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {heading && (
            <Typography variant="caption" style={{ fontWeight: 500 }}>
                {heading}
            </Typography>
        )}
        <Box style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Typography variant="body2">lasts</Typography>
            <TextField
                size="small"
                label="mm:ss or seconds"
                placeholder="4:30"
                InputLabelProps={{ shrink: true }}
                value={secondsInputValue(boundary?.startAfterSeconds)}
                onChange={(e) => onPatch({ startAfterSeconds: e.target.value })}
                error={secondsError}
                style={{ width: '140px' }}
            />
            <Typography variant="body2">or</Typography>
            <TextField
                size="small"
                type="number"
                label="messages"
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: 0, step: 1 }}
                value={countInputValue(boundary?.startAfterUserMessages)}
                onChange={(e) => onPatch({ startAfterUserMessages: e.target.value })}
                error={messagesError}
                style={{ width: '110px' }}
            />
            <Typography variant="body2">
                participant messages{showTail ? ' — whichever comes first' : ''}
            </Typography>
            {(showSegment || declaresSegment(boundary)) && (
                <>
                    <Typography variant="body2">or starts at block</Typography>
                    <TextField
                        size="small"
                        type="number"
                        label="block"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{ min: 2, step: 1 }}
                        value={countInputValue(boundary?.startAtSegment)}
                        onChange={(e) => onPatch({ startAtSegment: e.target.value })}
                        error={segmentError}
                        style={{ width: '100px' }}
                    />
                </>
            )}
        </Box>
    </Box>
);

interface ScheduleBodyProps {
    value: PhaseScheduleConfig | undefined;
    onChange: (next: PhaseScheduleConfig | undefined) => void;
    rosterAgents: AgentType[];
    isSegmented: boolean;
}

const ScheduleBody: React.FC<ScheduleBodyProps> = ({ value, onChange, rosterAgents, isSegmented }) => {
    const roster = rosterAgents || [];
    const mode = scheduleMode(value);
    const rows = rowCount(value, roster);
    const ids = perAgentIds(value, roster);

    // The block count isn't known here, so an out-of-range block is caught on save instead.
    const issues = useMemo(
        () => validatePhaseSchedule(value, roster, { enabled: isSegmented }),
        [value, roster, isSegmented],
    );
    const issueFor = (index: number, field: PhaseIssueField, agentId?: string) =>
        issues.filter(
            (issue) => issue.index === index && issue.field === field && (issue.agentId || '') === (agentId || ''),
        )[0];
    const issuesForRow = (index: number) => issues.filter((issue) => issue.index === index);

    const sharedList = (value && value.boundaries) || [];

    // Only user actions write the field (never mount or roster changes), so phaseSchedule
    // stays absent on experiments that never opted in.
    const setShared = (boundaries: PhaseBoundary[]) => onChange({ mode: 'shared', boundaries });

    // Rebuilds every per-agent list together. Lists are padded to the row count first, or an
    // agent added later (shorter list) would drop keystrokes.
    const setPerAgent = (build: (list: PhaseBoundary[], agentId: string) => PhaseBoundary[]) => {
        const perAgent: Record<string, PhaseBoundary[]> = {};
        ids.forEach((id) => {
            perAgent[id] = build(padTo(boundariesForAgent(value, id), rows), id);
        });
        onChange({ mode: 'perAgent', perAgent });
    };

    const handleModeChange = (nextMode: PhaseScheduleMode) => {
        if (nextMode === mode) return;
        // No ids would write perAgent: {}, i.e. zero rows, losing every boundary with no way back.
        if (nextMode === 'perAgent' && !ids.length) return;
        if (nextMode === 'perAgent') {
            // Start each agent from the shared timeline rather than blank.
            const perAgent: Record<string, PhaseBoundary[]> = {};
            ids.forEach((id) => {
                perAgent[id] = sharedList.map((boundary) => ({ ...boundary }));
            });
            onChange({ mode: 'perAgent', perAgent });
            return;
        }
        // Lists may disagree, so keep the first agent's list that has rows.
        const [firstWithRows] = ids.filter((id) => boundariesForAgent(value, id).length);
        onChange({
            mode: 'shared',
            boundaries: boundariesForAgent(value, firstWithRows).map((boundary) => ({ ...boundary })),
        });
    };

    const addPhase = () => {
        if (mode === 'shared') setShared([...sharedList, {}]);
        else setPerAgent((list) => [...list, {}]);
    };

    const removePhase = (index: number) => {
        const drop = (list: PhaseBoundary[]) => list.filter((_, i) => i !== index);
        // An empty list keeps the chosen mode; normalizePhaseSchedule drops it on save.
        if (mode === 'shared') setShared(drop(sharedList));
        else setPerAgent(drop);
    };

    // With agentId: a timing edit for that agent only. Without: a label edit written to every
    // agent's row, so one phase never gets two names in the transcript.
    const patchBoundary = (index: number, patch: PhaseBoundary, agentId?: string) => {
        const apply = (list: PhaseBoundary[]) =>
            list.map((boundary, i) => (i === index ? { ...boundary, ...patch } : boundary));
        if (mode === 'shared') setShared(apply(sharedList));
        else setPerAgent((list, id) => (agentId && id !== agentId ? list : apply(list)));
    };

    const labelFor = (index: number): string => {
        if (mode === 'shared') return (sharedList[index] && sharedList[index].label) || '';
        for (let i = 0; i < ids.length; i++) {
            const boundary = boundariesForAgent(value, ids[i])[index];
            if (boundary && boundary.label) return boundary.label;
        }
        return '';
    };

    return (
        <Box style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sectionHeader(
                'Conversation Phases:',
                'Splits one conversation into phases that run different prompts, so the agents change character as the session goes on. WHEN each phase starts is set here, on the experiment, so every agent in the conversation changes on the same clock. WHAT each agent says in a phase is set on the agent itself.',
            )}

            <Typography style={{ fontSize: '0.75rem', color: CAPTION_COLOR, marginBottom: '4px' }}>
                Phase 1 is not listed: it is each agent&apos;s own prompts, exactly as they are today, running from
                the start of the conversation. The rows below say when the agents CHANGE.
            </Typography>

            {rows > 0 && (
                <Box
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px',
                        flexWrap: 'wrap',
                    }}
                >
                    <Typography>
                        Timeline:
                        <FieldInfo text="Shared: one set of start times, applied to every agent in this experiment — nobody can drift. Independent: each agent gets its own start times for the same phases, so one can turn cold well before the other." />
                    </Typography>
                    <Select
                        size="small"
                        value={mode}
                        onChange={(e) => handleModeChange(e.target.value as PhaseScheduleMode)}
                        style={{ minWidth: '340px' }}
                    >
                        <MenuItem value="shared">Shared — one timeline for all agents</MenuItem>
                        {/* Disabled with no agents: see the guard in handleModeChange. */}
                        <MenuItem value="perAgent" disabled={!ids.length}>
                            Independent — each agent runs its own timeline
                        </MenuItem>
                    </Select>
                    {!ids.length && (
                        <Typography style={{ fontSize: '0.75rem', color: CAPTION_COLOR }}>
                            {PICK_AGENTS_HINT}
                        </Typography>
                    )}
                </Box>
            )}

            {rows === 0 && (
                <Typography style={{ fontSize: '0.75rem', color: CAPTION_COLOR, marginBottom: '8px' }}>
                    No phases: the agents run their base prompts for the whole conversation.
                </Typography>
            )}

            {Array.from({ length: rows }).map((_, index) => {
                const rowIssues = issuesForRow(index);
                return (
                    <Box
                        key={index}
                        style={{
                            border: '1px solid rgba(0,0,0,0.12)',
                            borderRadius: '4px',
                            padding: '8px 12px',
                            marginBottom: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                        }}
                    >
                        <Box style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Typography style={{ fontWeight: 500, minWidth: '64px' }}>
                                Phase {index + 2}
                            </Typography>
                            <TextField
                                size="small"
                                label="Label (optional)"
                                placeholder="Drift"
                                InputLabelProps={{ shrink: true }}
                                value={labelFor(index)}
                                onChange={(e) => patchBoundary(index, { label: e.target.value })}
                                style={{ width: '220px' }}
                            />
                            <FieldInfo text="Researcher-facing name for this phase, e.g. 'Drift' or 'Exclusion'. It shows up in the exported transcript alongside the phase number, and is never shown to participants." />
                            <Box style={{ flexGrow: 1 }} />
                            {/* type="button", or it submits the surrounding form. */}
                            <Button
                                type="button"
                                variant="outlined"
                                size="small"
                                onClick={() => removePhase(index)}
                                sx={{ minWidth: '36px', border: '1px solid red', height: 'fit-content', p: 1 }}
                            >
                                <DeleteIcon sx={{ fontSize: '1.25rem', color: 'black' }} />
                            </Button>
                        </Box>

                        {mode === 'shared' ? (
                            <TriggerPair
                                boundary={sharedList[index] || {}}
                                onPatch={(patch) => patchBoundary(index, patch)}
                                showTail
                                secondsError={!!issueFor(index, 'seconds')}
                                messagesError={!!issueFor(index, 'messages')}
                                segmentError={!!issueFor(index, 'segment')}
                                showSegment={isSegmented}
                            />
                        ) : (
                            <>
                                <Box
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'row',
                                        gap: '24px',
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    {/* Per-agent schedule but an empty roster: no columns to show. */}
                                    {roster.length === 0 && (
                                        <Typography style={{ fontSize: '0.75rem', color: CAPTION_COLOR }}>
                                            {PICK_AGENTS_HINT}
                                        </Typography>
                                    )}
                                    {roster.map((agent) => (
                                        <TriggerPair
                                            key={agent._id}
                                            heading={agentLabel(agent)}
                                            boundary={boundariesForAgent(value, String(agent._id))[index] || {}}
                                            onPatch={(patch) => patchBoundary(index, patch, String(agent._id))}
                                            showTail={false}
                                            secondsError={!!issueFor(index, 'seconds', String(agent._id))}
                                            messagesError={!!issueFor(index, 'messages', String(agent._id))}
                                            segmentError={!!issueFor(index, 'segment', String(agent._id))}
                                            showSegment={isSegmented}
                                        />
                                    ))}
                                </Box>
                                <Typography style={{ fontSize: '0.75rem', color: CAPTION_COLOR }}>
                                    Whichever threshold is met first starts the phase, per agent. Leave one blank
                                    to use only the other.
                                </Typography>
                            </>
                        )}

                        {rowIssues.map((issue, i) => (
                            <Typography
                                key={i}
                                style={{
                                    fontSize: '0.75rem',
                                    // Amber for a still-empty row, red for a real error.
                                    color: issue.field === 'row' ? WARNING_COLOR : '#d32f2f',
                                }}
                            >
                                {issue.message}
                            </Typography>
                        ))}
                    </Box>
                );
            })}

            {rows > 0 && (
                <Typography style={{ fontSize: '0.75rem', color: CAPTION_COLOR, marginBottom: '4px' }}>
                    A phase starts as soon as EITHER threshold is met. Leave one blank to use only the other — a
                    time-only phase still fires for a participant who has gone quiet, which is exactly what an
                    excluded participant does.
                </Typography>
            )}

            {/* type="button": see the Remove button above. */}
            <Button
                type="button"
                variant="outlined"
                onClick={addPhase}
                style={{ alignSelf: 'flex-start', marginTop: '4px' }}
            >
                {rows === 0 ? 'Add phase' : `Add phase ${rows + 2}`}
            </Button>

            {roster.map((agent) => {
                const advisory = textAdvisory(agent, boundariesForAgent(value, String(agent._id)).length);
                if (!advisory) return null;
                return (
                    <Typography
                        key={agent._id}
                        style={{
                            fontSize: '0.75rem',
                            color: advisory.warn ? WARNING_COLOR : CAPTION_COLOR,
                            marginTop: '4px',
                        }}
                    >
                        {advisory.text}
                    </Typography>
                );
            })}
        </Box>
    );
};

interface PhaseScheduleEditorProps {
    control: any;
    // The experiment's agents in roster order, as full documents (titles and phases are needed).
    rosterAgents: AgentType[];
    // Whether the study is split into chat blocks. Block triggers never fire otherwise.
    isSegmented?: boolean;
}

// Phases apply to every agent mode, so phaseSchedule is exempt from the group-field
// stripping in ExperimentForm's handleSave.
export const PhaseScheduleEditor: React.FC<PhaseScheduleEditorProps> = ({
    control,
    rosterAgents,
    isSegmented = false,
}) => (
    <Controller
        name="phaseSchedule"
        control={control}
        render={({ field }) => (
            <ScheduleBody
                value={field.value}
                onChange={field.onChange}
                rosterAgents={rosterAgents}
                isSegmented={isSegmented}
            />
        )}
    />
);

export default PhaseScheduleEditor;

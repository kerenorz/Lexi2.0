import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Box, Button, Checkbox, FormControlLabel, Grid, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { Controller } from 'react-hook-form';
import { SegmentQuotaRow, SegmentsFormValue, liveRows, parseNumberInput } from './segmentsConfig';

// Settings for a survey-embedded study: the chat is split into blocks with survey pages between
// them. Logic lives in segmentsConfig.ts (React-free); re-exported here.

export type { SegmentQuotaRow, SegmentsFormValue, SegmentsIssue } from './segmentsConfig';
export { parseNumberInput, validateSegments, normalizeSegments } from './segmentsConfig';

const Body: React.FC<{ value?: SegmentsFormValue; onChange: (v: SegmentsFormValue) => void }> = ({
    value,
    onChange,
}) => {
    const v: SegmentsFormValue = value ?? {};
    const rows = v.quotas ?? [{}];
    const templates = v.defaultKnowledgeTemplates ?? [];
    const count = parseNumberInput(v.count);
    // 1 = embedded but not split; labels change. Blank counts as split.
    const isSingle = count === 1;
    // Gaps between blocks; none for a single chat.
    const gaps = Math.max(0, (count ?? 2) - 1);
    // Only rows that have a block, the same set validated and saved.
    const shown = liveRows(rows, count);
    // A blank or unreadable count doesn't limit rows, as in liveRows.
    const canAddRow = typeof count !== 'number' || rows.length < count;

    const set = (patch: Partial<SegmentsFormValue>) => onChange({ ...v, ...patch });
    const setRow = (index: number, patch: SegmentQuotaRow) => {
        const next = [...rows];
        next[index] = { ...next[index], ...patch };
        set({ quotas: next });
    };

    return (
        <Box style={{ marginTop: 12, marginBottom: 8 }}>
            <FormControlLabel
                control={
                    <Checkbox
                        size="small"
                        checked={!!v.enabled}
                        onChange={(e) => set({ enabled: e.target.checked })}
                    />
                }
                label={
                    <Tooltip title="Run this chat inside a survey platform (Qualtrics and similar). The participant comes from your survey rather than registering with Lexi, and your survey learns when the chat is finished. Optionally split the chat across several survey pages, returning to the same conversation each time.">
                        <Typography variant="body2">Used inside a survey (Qualtrics and similar)</Typography>
                    </Tooltip>
                }
            />

            {v.enabled && (
                <Box style={{ paddingLeft: 12, borderLeft: '2px solid #eee' }}>
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 8 }}>
                        {isSingle
                            ? 'The participant chats once and your survey carries on afterwards. The chat takes its participant from your survey rather than asking for a nickname, and tells your survey when it is finished.'
                            : 'The chat is split into blocks. Between blocks the participant answers your survey questions and then returns to the same conversation, exactly where they left it.'}{' '}
                        Paste the embed kit from this experiment&apos;s details row into your survey.
                    </Typography>

                    <TextField
                        size="small"
                        label="Number of chat blocks"
                        helperText="1 for one continuous chat"
                        value={v.count ?? ''}
                        onChange={(e) => set({ count: e.target.value })}
                        style={{ width: 200, marginBottom: 12 }}
                    />

                    <Typography variant="body2" style={{ marginBottom: 4 }}>
                        {isSingle ? 'When is the chat finished? (optional)' : 'How long is each block? (optional)'}
                    </Typography>
                    {/* Limits are optional: the survey paces the study by default. */}
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 8 }}>
                        Leave these blank and your survey decides — its Next button is available straight away, and
                        the {isSingle ? 'chat' : 'block'} closes when the participant moves on. Set a minimum to hold
                        Next back until they have really taken part; set a maximum to end the{' '}
                        {isSingle ? 'chat' : 'block'} on its own.
                        {!isSingle && ' A blank field carries down from the row above.'}
                    </Typography>

                    {shown.map((row, index) => (
                        <Grid container spacing={1} key={index} alignItems="center" style={{ marginBottom: 4 }}>
                            <Grid item style={{ width: 70 }}>
                                <Typography variant="body2">{isSingle ? 'The chat' : `Block ${index + 1}`}</Typography>
                            </Grid>
                            {(
                                [
                                    ['minUserMessages', 'Min messages'],
                                    ['minSeconds', 'Min seconds'],
                                    ['maxUserMessages', 'Max messages'],
                                    ['maxSeconds', 'Max seconds'],
                                ] as const
                            ).map(([key, label]) => (
                                <Grid item key={key}>
                                    <TextField
                                        size="small"
                                        label={label}
                                        value={(row as any)?.[key] ?? ''}
                                        onChange={(e) => setRow(index, { [key]: e.target.value } as SegmentQuotaRow)}
                                        style={{ width: 130 }}
                                    />
                                </Grid>
                            ))}
                            <Grid item>
                                <IconButton
                                    size="small"
                                    onClick={() => set({ quotas: rows.filter((_, i) => i !== index) })}
                                    disabled={shown.length <= 1}
                                >
                                    <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                            </Grid>
                        </Grid>
                    ))}
                    {/* No button once every block has a row; an extra row would be dropped. */}
                    {canAddRow && (
                        <Button size="small" startIcon={<AddIcon />} onClick={() => set({ quotas: [...rows, {}] })}>
                            Add block
                        </Button>
                    )}

                    <TextField
                        size="small"
                        fullWidth
                        label="What the participant sees when a block ends"
                        placeholder="Thanks — please continue with the survey."
                        value={v.endOfSegmentNotice ?? ''}
                        onChange={(e) => set({ endOfSegmentNotice: e.target.value })}
                        style={{ marginTop: 16, marginBottom: 12 }}
                    />

                    {/* Answers are injected only in gaps after a block, so none for a single chat. */}
                    {gaps > 0 && (
                        <>
                    <Typography variant="body2" style={{ marginBottom: 4 }}>
                        What the agents learn from your survey answers
                    </Typography>
                    {/* Keep this guidance: a careless template can reveal the survey link and spoil the study. */}
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 8 }}>
                        Optional. Write it as something the agent simply knows — &quot;You know they have been
                        feeling {'{{mood}}'} lately&quot; — not as a report of a questionnaire, which tells the agent
                        a survey happened. Use {'{{placeholders}}'} for your survey&apos;s question IDs; any sentence
                        whose answer is missing is dropped rather than left blank.
                        <br />
                        <strong>Keep it narrow and oblique.</strong> An agent that reveals something the participant
                        never told it is how they work out the chat is wired to the survey. Individual agents can
                        override this on their own form, so one can know things another does not.
                    </Typography>
                    {Array.from({ length: gaps }).map((_, gap) => (
                        <TextField
                            key={gap}
                            size="small"
                            fullWidth
                            multiline
                            label={`After block ${gap + 1}`}
                            value={templates[gap] ?? ''}
                            onChange={(e) => {
                                const next = [...templates];
                                while (next.length <= gap) next.push('');
                                next[gap] = e.target.value;
                                set({ defaultKnowledgeTemplates: next });
                            }}
                            style={{ marginBottom: 8 }}
                        />
                    ))}
                        </>
                    )}
                </Box>
            )}
        </Box>
    );
};

export const SegmentsEditor: React.FC<{ control: any }> = ({ control }) => (
    <Controller
        name="segments"
        control={control}
        render={({ field }) => <Body value={field.value} onChange={field.onChange} />}
    />
);

export default SegmentsEditor;

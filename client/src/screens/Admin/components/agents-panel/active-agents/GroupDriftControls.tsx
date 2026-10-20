// Scene, Thread control and Memory window: settings that keep agent-to-agent talk from
// drifting off topic. All are seeded, so runs still replay. Group mode only. Has its own
// heading because the Scene applies in every phase. Copy suggests; it never prescribes prompts.
import FieldInfo from '@components/common/FieldInfo';
import { MAX_MOVE_CHANCE } from '@DAL/constants';
import { Box, FormControl, InputAdornment, Slider, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { Controller } from 'react-hook-form';

// In draw order. `fallback` must match the server's DEFAULT_CHANCES. Exported for GroupAgents,
// which seeds these paths even when this component is hidden.
export const MOVE_SLIDERS = [
    {
        field: 'groundChance',
        label: 'Ground chance',
        fallback: 0.2,
        info: 'Say something concrete a real person in this setting would say, rather than extending the previous idea.',
    },
    {
        field: 'shiftChance',
        label: 'Shift chance',
        fallback: 0.15,
        info: 'Move on to something else within the setting, without building on the previous message.',
    },
    {
        field: 'returnChance',
        label: 'Return chance',
        fallback: 0.05,
        info: 'Pick the thread back up from something said earlier in the conversation.',
    },
    {
        field: 'closeChance',
        label: 'Close chance',
        fallback: 0.08,
        info: 'End the round here and hand back. A dangling direct question is still answered first.',
    },
] as const;

interface GroupDriftControlsProps {
    control: any;
    watch: any;
}

export const GroupDriftControls: React.FC<GroupDriftControlsProps> = ({ control, watch }) => {
    const threadControlOn = !!watch('turnTaking.threadControl.enabled');

    return (
        <Box style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Typography
                style={{ color: 'grey', marginBottom: '4px', marginTop: '12px', borderBottom: '1px solid grey' }}
            >
                Agent-to-agent behaviour (Group only):
                <FieldInfo text="Left alone, two agents tend to agree with and build on each other until the conversation has drifted away from the study. These three settings give it something to come back to. All of them are decided from the conversation seed, so runs still reproduce. They are not phase settings — they apply the same way in every phase." />
            </Typography>

            <Box style={{ width: '100%' }}>
                <Controller
                    name="turnTaking.scene"
                    control={control}
                    defaultValue=""
                    render={({ field }) => (
                        <TextField
                            {...field}
                            value={field.value ?? ''}
                            label="Scene (optional)"
                            multiline
                            rows={2}
                            fullWidth
                            size="small"
                            margin="dense"
                            placeholder="A casual three-way group chat between friends about how people spend their free time and what makes a place good to live in."
                            helperText="Where this conversation is happening and what it is about, in a sentence or two. The agents see it at the end of their context on every turn, in every phase, so it never fades and never needs restating in a phase prompt."
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                                        <FieldInfo text="Sent to every agent as the last thing in its context, on every turn. Leave it blank and nothing is added." />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    )}
                />
            </Box>

            {/* Thread control — the seeded move drawn before each agent-to-agent reply. */}
            <Box style={{ width: '100%' }}>
                <FormControl
                    margin="dense"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>
                        Thread control:
                        <FieldInfo
                            text={
                                'Before each agent-to-agent reply, one of these moves is drawn from the conversation’s seed — the same way Silence chance works — so the rhythm reproduces exactly. ' +
                                'Ground: "Keep this concrete: say something a real person in this setting would actually say, tied to a specific detail, rather than extending the previous idea further." ' +
                                'Shift: "Move the thread on to something else within the setting; do not build on the previous message." ' +
                                'Return: "Pick the thread back up from something said earlier in the conversation." ' +
                                'Close ends the round. A thread that starts repeating itself closes on its own. Set a chance to 0 to never use that move. None of the moves says anything about who the agents address.'
                            }
                        />
                    </Typography>
                    <Controller
                        name="turnTaking.threadControl.enabled"
                        control={control}
                        defaultValue={false}
                        render={({ field }) => (
                            <Switch
                                checked={!!field.value}
                                onChange={(e) => field.onChange(e.target.checked)}
                                size="small"
                            />
                        )}
                    />
                </FormControl>
                <Typography style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.6)', marginLeft: '8px' }}>
                    Only agent-to-agent turns are steered. A reply that answers the participant is never
                    touched.
                </Typography>
                {threadControlOn &&
                    MOVE_SLIDERS.map((move) => (
                        <Controller
                            key={move.field}
                            name={`turnTaking.threadControl.${move.field}`}
                            control={control}
                            defaultValue={move.fallback}
                            render={({ field }) => (
                                <Box style={{ maxWidth: '360px', marginLeft: '8px' }}>
                                    <Typography gutterBottom>
                                        {move.label}: {field.value ?? move.fallback}
                                        <FieldInfo text={move.info} />
                                    </Typography>
                                    <Slider
                                        value={typeof field.value === 'number' ? field.value : move.fallback}
                                        onChange={(e, v) => field.onChange(v)}
                                        min={0}
                                        max={MAX_MOVE_CHANCE}
                                        step={0.01}
                                        valueLabelDisplay="auto"
                                    />
                                </Box>
                            )}
                        />
                    ))}
            </Box>

            {/* Memory window — bounded agent context. */}
            <Box style={{ width: '100%' }}>
                <FormControl
                    margin="dense"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>
                        Memory window:
                        <FieldInfo text="After 30 messages the agents keep the opening, everything the participant ever said, and the last 30 messages; older agent-to-agent messages drop out of their context. Nothing is summarised and nothing is invented — messages are only selected — so the conversation still reproduces exactly." />
                    </Typography>
                    <Controller
                        name="turnTaking.memoryWindow"
                        control={control}
                        defaultValue={false}
                        render={({ field }) => (
                            <Switch
                                checked={!!field.value}
                                onChange={(e) => field.onChange(e.target.checked)}
                                size="small"
                            />
                        )}
                    />
                </FormControl>
                <Typography style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.6)', marginLeft: '8px' }}>
                    Off: every agent sees the whole transcript on every turn.
                </Typography>
            </Box>
        </Box>
    );
};

export default GroupDriftControls;

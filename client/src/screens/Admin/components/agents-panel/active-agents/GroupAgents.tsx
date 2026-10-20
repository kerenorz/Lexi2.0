import FieldInfo from '@components/common/FieldInfo';
import { defaultTurnTaking } from '@DAL/constants';
import { AgentType } from '@models/AppModels';
import {
    Box,
    FormControl,
    InputAdornment,
    MenuItem,
    Select,
    Slider,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { AgentPicker, agentLabel } from '../../shared/AgentPicker';
import { MOVE_SLIDERS } from './GroupDriftControls';

interface GroupAgentsProps {
    agents: AgentType[];
    control: any;
    setValue: any;
    watch: any;
    getValues: any;
}

// Dedupe truthy ids without relying on Set iteration (client targets < ES2015).
const uniqueIds = (ids: string[]): string[] => ids.filter((id, i) => !!id && ids.indexOf(id) === i);

// Scene, thread control and memory window are in GroupDriftControls, but the seed below still
// writes them (via the shared MOVE_SLIDERS) so they exist even when not on screen.

const sectionHeader = (text: string, info?: string) => (
    <Typography
        style={{ color: 'grey', marginBottom: '4px', marginTop: '12px', borderBottom: '1px solid grey' }}
    >
        {text}
        {info && <FieldInfo text={info} />}
    </Typography>
);

// Group mode: pick 1 or 2 agents and configure turn-taking.
export const GroupAgents: React.FC<GroupAgentsProps> = ({ agents, control, setValue, watch, getValues }) => {
    const [agent1, setAgent1] = useState<string>(() => getValues('groupAgents')?.[0] || '');
    const [agent2, setAgent2] = useState<string>(() => getValues('groupAgents')?.[1] || '');

    // Seed turnTaking defaults for a new experiment only; a saved one keeps its values.
    // Leaf paths are set too: only a setValue on the exact path reaches an already-registered
    // Controller, so setting the parent alone is silently ignored.
    useEffect(() => {
        const current = getValues('turnTaking');
        if (current && current.policy) return;
        setValue('turnTaking', defaultTurnTaking);
        setValue('turnTaking.scene', defaultTurnTaking.scene ?? '');
        setValue('turnTaking.memoryWindow', defaultTurnTaking.memoryWindow ?? false);
        setValue('turnTaking.threadControl.enabled', defaultTurnTaking.threadControl?.enabled ?? false);
        for (const move of MOVE_SLIDERS) {
            setValue(`turnTaking.threadControl.${move.field}`, defaultTurnTaking.threadControl?.[move.field] ?? move.fallback);
        }
    }, []);

    useEffect(() => {
        setValue('groupAgents', uniqueIds([agent1, agent2]));
    }, [agent1, agent2, setValue]);

    const policy = watch('turnTaking.policy') || 'rules';
    const selectedIds = uniqueIds([agent1, agent2]);
    const selectedAgents = selectedIds
        .map((id) => agents.find((a) => a._id === id))
        .filter(Boolean) as AgentType[];

    return (
        <Box style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sectionHeader(
                'Group Agents (choose 1 or 2):',
                'The one or two agents in the group conversation; give each a Display Name so participants can tell them apart.',
            )}
            <Box style={{ display: 'flex', flexDirection: 'row', gap: '32px', alignItems: 'center' }}>
                <FormControl
                    margin="normal"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>Agent 1:</Typography>
                    <AgentPicker
                        agents={agents}
                        value={agent1}
                        onChange={setAgent1}
                        excludeId={agent2}
                        minWidth={280}
                        placeholder="Type an agent name…"
                    />
                </FormControl>
                <FormControl
                    margin="normal"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>Agent 2:</Typography>
                    <AgentPicker
                        agents={agents}
                        value={agent2}
                        onChange={setAgent2}
                        excludeId={agent1}
                        minWidth={280}
                        placeholder="Type an agent name…"
                    />
                </FormControl>
            </Box>

            <FormControl
                margin="dense"
                size="small"
                sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
            >
                <Typography>
                    First message from:
                    <FieldInfo text="Which agent posts the opening message: Agent 1, Agent 2, or Both (default). Only the chosen agent's first chat sentence is shown to start the conversation." />
                </Typography>
                <Controller
                    name="firstMessageSender"
                    control={control}
                    defaultValue="both"
                    render={({ field }) => (
                        <Select {...field} size="small" style={{ minWidth: '160px' }}>
                            <MenuItem value="agent1">Agent 1</MenuItem>
                            <MenuItem value="agent2">Agent 2</MenuItem>
                            <MenuItem value="both">Both</MenuItem>
                        </Select>
                    )}
                />
            </FormControl>

            {sectionHeader('Turn-Taking:')}
            <FormControl
                margin="dense"
                size="small"
                sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
            >
                <Typography>
                    Policy:
                    <FieldInfo text="How the next speaker is chosen: Rules (fixed round-robin), Probabilistic (chance-based, can stay silent), or LLM (a model decides who's next). Note: LLM asks a moderator model to choose, which the conversation's seed cannot reproduce — use Probabilistic or Rules for studies that need reproducible runs." />
                </Typography>
                <Controller
                    name="turnTaking.policy"
                    control={control}
                    defaultValue="rules"
                    render={({ field }) => (
                        <Select {...field} size="small" style={{ minWidth: '180px' }}>
                            <MenuItem value="rules">Rules (round-robin)</MenuItem>
                            <MenuItem value="probabilistic">Probabilistic</MenuItem>
                            <MenuItem value="llm">LLM moderator</MenuItem>
                        </Select>
                    )}
                />
            </FormControl>

            {/* Agent-to-agent replies (default Off) */}
            <Box style={{ width: '100%' }}>
                <FormControl
                    margin="dense"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>
                        Agent-to-agent replies:
                        <FieldInfo text="How much the agents keep talking to each other after you speak: Off (each replies once), Medium (one extra reply from a random agent), or Extended (each replies twice)." />
                    </Typography>
                    <Controller
                        name="turnTaking.autonomousLevel"
                        control={control}
                        defaultValue="off"
                        render={({ field }) => (
                            <Select {...field} size="small" style={{ minWidth: '160px' }}>
                                <MenuItem value="off">Off</MenuItem>
                                <MenuItem value="brief">Medium</MenuItem>
                                <MenuItem value="extended">Extended</MenuItem>
                            </Select>
                        )}
                    />
                </FormControl>
                <Typography style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.6)', marginLeft: '8px' }}>
                    After answering the participant, how much the agents keep talking with each other before handing
                    back.
                </Typography>
            </Box>

            {/* Autonomous follow-up rounds while the participant is silent (default 0 = off) */}
            <Box style={{ width: '100%' }}>
                <FormControl
                    margin="dense"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>
                        Agent-only follow-up rounds while you are silent (0 = off):
                        {/* "up to": a round can end itself and produce nothing. */}
                        <FieldInfo text="After you stop, the agents keep talking among themselves for up to this many extra rounds before handing back. A round can end early — sooner if a thread closes — so this is a ceiling, not a count." />
                    </Typography>
                    <Controller
                        name="turnTaking.autonomousRounds"
                        control={control}
                        defaultValue={0}
                        render={({ field }) => (
                            <TextField
                                {...field}
                                type="number"
                                size="small"
                                inputProps={{ min: 0, max: 5, step: 1 }}
                                value={field.value ?? 0}
                                onChange={(e) =>
                                    field.onChange(e.target.value === '' ? 0 : Number(e.target.value))
                                }
                                style={{ minWidth: '160px' }}
                            />
                        )}
                    />
                </FormControl>
                <Typography style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.6)', marginLeft: '8px' }}>
                    After you stop, the agents keep talking for up to this many rounds.
                </Typography>
            </Box>

            {/* Identify the human participant to the agents (default Off = illusion-safe) */}
            <Box style={{ width: '100%' }}>
                <FormControl
                    margin="dense"
                    size="small"
                    sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
                >
                    <Typography>
                        Tell agents which participant is the human:
                        <FieldInfo text="When on, the agents' instructions name the human participant (by username) so they know who is human. Off keeps all participants as names only." />
                    </Typography>
                    <Controller
                        name="turnTaking.identifyHumanParticipant"
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
                    Off: agents see all participants by name only, with no human/AI distinction.
                </Typography>
            </Box>

            {/* Probabilistic only */}
            {policy === 'probabilistic' && (
                <Box style={{ width: '100%' }}>
                    <Controller
                        name="turnTaking.silenceChance"
                        control={control}
                        defaultValue={0}
                        render={({ field }) => (
                            <Box style={{ maxWidth: '360px' }}>
                                <Typography gutterBottom>
                                    Silence chance: {field.value ?? 0}
                                    <FieldInfo text="The odds each agent speaks on a turn, and the chance nobody does." />
                                </Typography>
                                <Slider
                                    value={typeof field.value === 'number' ? field.value : 0}
                                    onChange={(e, v) => field.onChange(v)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    valueLabelDisplay="auto"
                                />
                                {/* 0 is the default and means rounds always run to the turn cap, so say so. */}
                                {!(field.value > 0) && (
                                    <Typography style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.6)' }}>
                                        At 0 the agents never fall silent on their own — every round
                                        runs until the reply-level turn cap is reached.
                                    </Typography>
                                )}
                            </Box>
                        )}
                    />
                    {selectedAgents.length === 0 && (
                        <Typography style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.6)' }}>
                            Pick agents above to set their speaking probabilities.
                        </Typography>
                    )}
                    {selectedAgents.map((agent) => (
                        <Controller
                            key={agent._id}
                            name={`turnTaking.perAgentProbability.${agent._id}`}
                            control={control}
                            defaultValue={0.7}
                            render={({ field }) => (
                                <Box style={{ maxWidth: '360px' }}>
                                    <Typography gutterBottom>
                                        {agentLabel(agent)} — P(speak): {field.value ?? 0.7}
                                    </Typography>
                                    <Slider
                                        value={typeof field.value === 'number' ? field.value : 0.7}
                                        onChange={(e, v) => field.onChange(v)}
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        valueLabelDisplay="auto"
                                    />
                                </Box>
                            )}
                        />
                    ))}
                </Box>
            )}

            {/* LLM only */}
            {policy === 'llm' && (
                <Controller
                    name="turnTaking.moderatorPrompt"
                    control={control}
                    defaultValue=""
                    render={({ field }) => (
                        <TextField
                            {...field}
                            value={field.value ?? ''}
                            label="Moderator prompt (optional)"
                            multiline
                            rows={3}
                            fullWidth
                            size="small"
                            margin="dense"
                            helperText="Guidance for the moderator; leave blank to use the built-in scaffolding."
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                                        <FieldInfo text="Instructions for the model that picks the next speaker — say when each agent should jump in or stay quiet." />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    )}
                />
            )}
        </Box>
    );
};

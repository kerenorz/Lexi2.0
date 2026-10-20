import { Divider, Grid, List, ListItem, ListItemText, Typography } from '@mui/material';

// Lists only the prompts a phase sets; blank fields inherit from the previous phase.
const phaseSummary = (phase) => {
    const changed = [
        ['System Starter Prompt', phase?.systemStarterPrompt],
        ['Before User Sentence Prompt', phase?.beforeUserSentencePrompt],
        ['After User Sentence Prompt', phase?.afterUserSentencePrompt],
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    return changed.length
        ? changed.map(([label, value]) => `${label}: ${value}`).join('\n')
        : "No prompt changes — keeps the previous phase's text.";
};

export const AgentDetails = ({ agent }) => (
    <Grid container spacing={2} style={{ padding: '20px', paddingTop: '4px' }}>
        <Grid item xs={12} md={6} style={{ borderRight: '2px solid #eee' }}>
            <Typography variant="h6" gutterBottom>
                Chat Agent Details
            </Typography>
            <Divider style={{ marginBottom: '10px' }} />
            <List>
                {agent.displayName && (
                    <ListItem>
                        <ListItemText primary="Display Name" secondary={agent.displayName} />
                    </ListItem>
                )}
                <ListItem>
                    <ListItemText primary="First Chat Sentence" secondary={agent.firstChatSentence} />
                </ListItem>
                <ListItem>
                    <ListItemText primary="Chat Model" secondary={agent.model} />
                </ListItem>
                {agent.systemStarterPrompt && (
                    <ListItem>
                        <ListItemText primary="System Starter Prompt" secondary={agent.systemStarterPrompt} />
                    </ListItem>
                )}
                {agent.beforeUserSentencePrompt && (
                    <ListItem>
                        <ListItemText
                            primary="Before User Sentence Prompt"
                            secondary={agent.beforeUserSentencePrompt}
                        />
                    </ListItem>
                )}
                {agent.afterUserSentencePrompt && (
                    <ListItem>
                        <ListItemText
                            primary="After User Sentence Prompt"
                            secondary={agent.afterUserSentencePrompt}
                        />
                    </ListItem>
                )}
                {/* Phase timing lives on the experiment. Phase 1 is the base prompts, so numbering starts at 2. */}
                {Array.isArray(agent.phases) && agent.phases.length > 0 && (
                    <ListItem>
                        <ListItemText
                            primary="Conversation Phases"
                            secondary="Phase 1 is the prompts above; when every later phase starts is set on the experiment."
                        />
                    </ListItem>
                )}
                {Array.isArray(agent.phases) &&
                    agent.phases.map((phase, index) => (
                        <ListItem key={index} style={{ paddingLeft: '32px' }}>
                            <ListItemText
                                primary={`Phase ${index + 2}${phase?.label ? ` — ${phase.label}` : ''}`}
                                secondary={phaseSummary(phase)}
                                secondaryTypographyProps={{ style: { whiteSpace: 'pre-line' } }}
                            />
                        </ListItem>
                    ))}
                {agent.inverseTimeDelay && (
                    <ListItem>
                        <ListItemText
                            primary="Inverse Time Delay"
                            secondary={agent.inverseTimeDelay}
                        />
                    </ListItem>
                )}
            </List>
        </Grid>
        <Grid item xs={12} md={6} style={{ paddingLeft: 0 }}>
            <Typography variant="h6" gutterBottom style={{ paddingLeft: '12px' }}>
                Configuration
            </Typography>
            <Divider style={{ marginBottom: '10px' }} />
            <List style={{ paddingLeft: '24px' }}>
                <ListItem>
                    <ListItemText
                        primary="Temperature"
                        secondary={agent.temperature !== null ? agent.temperature : 'Not Active'}
                    />
                </ListItem>

                <ListItem>
                    <ListItemText
                        primary="Max Tokens"
                        secondary={agent.maxTokens !== null ? agent.maxTokens : 'Not Active'}
                    />
                </ListItem>
                <ListItem>
                    <ListItemText primary="Top P" secondary={agent.topP !== null ? agent.topP : 'Not Active'} />
                </ListItem>
                <ListItem>
                    <ListItemText
                        primary="Frequency Penalty"
                        secondary={agent.frequencyPenalty !== null ? agent.frequencyPenalty : 'Not Active'}
                    />
                </ListItem>
                <ListItem>
                    <ListItemText
                        primary="Presence Penalty"
                        secondary={agent.presencePenalty !== null ? agent.presencePenalty : 'Not Active'}
                    />
                </ListItem>
                <ListItem>
                    <ListItemText
                        primary="Audio Input"
                        secondary={agent.audioInput !== null ? agent.audioInput : 'Not Active'}
                    />
                </ListItem>
                <ListItem>
                    <ListItemText
                        primary="Stop Sequences"
                        secondary={agent.stopSequences.length ? agent.stopSequences.join(', ') : 'Not Active'}
                    />
                </ListItem>
            </List>
        </Grid>
    </Grid>
);

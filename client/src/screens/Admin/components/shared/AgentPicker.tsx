// Type-ahead agent picker for every agent selector in the experiment form.
// Value in and out is the agent `_id` ('' for none).
import { AgentType } from '@models/AppModels';
import SearchIcon from '@mui/icons-material/Search';
import { Autocomplete, InputAdornment, TextField, Typography } from '@mui/material';
import React from 'react';
import { agentLabel } from './agentLabel';

// Re-exported for existing callers; defined in a React-free module.
export { agentLabel };

// Text searched when finding an agent.
const agentHaystack = (agent: AgentType): string =>
    [agent.displayName, agent.title, agent.summary, agent.model].filter(Boolean).join(' ').toLowerCase();

interface AgentPickerProps {
    agents: AgentType[];
    // Selected agent `_id`; '' / null / undefined when nothing is picked.
    value: any;
    onChange: (id: string) => void;
    // Hide an agent already picked in a sibling field (Group mode's second slot).
    excludeId?: string;
    // false => the clear "x" is hidden and the field cannot be emptied once set.
    allowEmpty?: boolean;
    minWidth?: number;
    placeholder?: string;
    error?: boolean;
    disabled?: boolean;
}

export const AgentPicker: React.FC<AgentPickerProps> = ({
    agents,
    value,
    onChange,
    excludeId,
    allowEmpty = true,
    minWidth = 280,
    placeholder = 'Type an agent name…',
    error = false,
    disabled = false,
}) => {
    const list = agents || [];
    const options = excludeId ? list.filter((agent) => agent._id !== excludeId) : list;

    // Old forms may hold an agent object here; only a string id counts. Resolved against the
    // full list so an excluded-but-selected agent still shows.
    const selectedId = typeof value === 'string' ? value : '';
    const selected = selectedId ? list.filter((agent) => agent._id === selectedId)[0] || null : null;

    return (
        <Autocomplete
            options={options}
            value={selected}
            disabled={disabled}
            onChange={(_, option: AgentType | null) => onChange(option ? option._id : '')}
            getOptionLabel={agentLabel}
            isOptionEqualToValue={(option, val) => option._id === (val && val._id)}
            // Matches name, chat persona, summary and model, not just the label.
            filterOptions={(opts, state) => {
                const query = state.inputValue.trim().toLowerCase();
                if (!query) return opts;
                return opts.filter((agent) => agentHaystack(agent).indexOf(query) !== -1);
            }}
            disableClearable={!allowEmpty}
            // Stop Enter from submitting the surrounding <form>: MUI only swallows it when
            // an option is highlighted. autoHighlight picks the top match; the guard covers no match.
            autoHighlight
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
            }}
            size="small"
            sx={{ minWidth }}
            noOptionsText="No matching agents"
            // Select the text on focus so typing replaces it.
            selectOnFocus
            handleHomeEndKeys
            renderOption={(props, agent) => (
                <li {...props} key={agent._id}>
                    <span>
                        {agentLabel(agent)}
                        {/* Chat persona as a subtitle when it differs from the name. */}
                        {agent.displayName && agent.title && agent.displayName !== agent.title && (
                            <Typography component="span" variant="caption" color="text.secondary">
                                {` — shown in chat as "${agent.displayName}"`}
                            </Typography>
                        )}
                    </span>
                </li>
            )}
            renderInput={(params) => (
                <TextField
                    {...params}
                    placeholder={placeholder}
                    error={error}
                    InputProps={{
                        ...params.InputProps,
                        // Magnifier signals the field is searchable once the placeholder is gone.
                        startAdornment: (
                            <>
                                <InputAdornment position="start" sx={{ mr: 0 }}>
                                    <SearchIcon fontSize="small" color="disabled" />
                                </InputAdornment>
                                {params.InputProps.startAdornment}
                            </>
                        ),
                    }}
                />
            )}
        />
    );
};

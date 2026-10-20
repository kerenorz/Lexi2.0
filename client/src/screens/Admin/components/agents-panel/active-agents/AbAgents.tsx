import FieldInfo from '@components/common/FieldInfo';
import { AgentType } from '@models/AppModels';
import { Box, FormControl, Typography } from '@mui/material';
import { useEffect } from 'react';
import { Controller, FieldErrors, FieldValues, UseFormGetValues, UseFormSetValue } from 'react-hook-form';
import { getFormErrorMessage } from '../../../../../utils/commonFunctions';
import { AgentPicker } from '../../shared/AgentPicker';
import { distributionFromTypedA, distributionFromTypedB, initialAbDistribution } from './abDistribution';

interface AbAgentsFormData {
    abAgents: {
        agentA: string;
        agentB: string;
        distA: number;
        distB: number;
    };
}

interface AbAgentsProps {
    agents: AgentType[];
    control: any;
    setValue: UseFormSetValue<FieldValues>;
    getValues: UseFormGetValues<FieldValues>;
    errors: FieldErrors<AbAgentsFormData>;
    isRow?: boolean;
}

export const AbAgents: React.FC<AbAgentsProps> = ({
    agents,
    control,
    setValue,
    getValues,
    isRow = true,
    errors,
}) => {
    // Keep the saved split (normalized); default to 50/50 only when there is none.
    // Set the leaf paths: a setValue on parent `abAgents` doesn't reliably reach the Controllers.
    useEffect(() => {
        const { distA, distB } = initialAbDistribution(getValues('abAgents'));
        setValue('abAgents.distA', distA);
        setValue('abAgents.distB', distB);
    }, [getValues, setValue]);

    return (
        <Box
            style={{
                display: 'flex',
                flexDirection: isRow ? 'row' : 'column',
                gap: isRow ? '32px' : 0,
                alignItems: 'start',
            }}
        >
            <FormControl
                margin="normal"
                size="small"
                sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
            >
                <Typography>
                    Agent A:
                    <FieldInfo text="Pick two agents and a percentage split; each participant is randomly assigned one. The two percentages must total 100." />
                </Typography>
                <Controller
                    name="abAgents.agentA"
                    control={control}
                    defaultValue={agents.length ? agents[0] : ''}
                    rules={{ required: 'Agent A is required.' }}
                    render={({ field }) => (
                        <AgentPicker
                            agents={agents}
                            value={field.value}
                            onChange={field.onChange}
                            minWidth={280}
                            placeholder="Type an agent name…"
                            error={!!errors.abAgents?.agentA}
                        />
                    )}
                />
                {errors.abAgents?.agentA && (
                    <Typography color="error">{getFormErrorMessage(errors.abAgents.agentA)}</Typography>
                )}
                <Controller
                    name="abAgents.distA"
                    control={control}
                    defaultValue={50}
                    render={({ field }) => (
                        <input
                            {...field}
                            type="number"
                            style={{ width: '40px' }}
                            defaultValue={50}
                            onChange={(e) => {
                                const { distA, distB } = distributionFromTypedA(e.target.value);
                                field.onChange(distA);
                                setValue('abAgents.distB', distB);
                            }}
                        />
                    )}
                />
            </FormControl>
            <FormControl
                margin="normal"
                size="small"
                sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}
            >
                <Typography>Agent B:</Typography>
                <Controller
                    name="abAgents.agentB"
                    control={control}
                    defaultValue={agents.length ? agents[0] : ''}
                    rules={{ required: 'Agent B is required.' }}
                    render={({ field }) => (
                        <AgentPicker
                            agents={agents}
                            value={field.value}
                            onChange={field.onChange}
                            minWidth={280}
                            placeholder="Type an agent name…"
                            error={!!errors.abAgents?.agentB}
                        />
                    )}
                />
                {errors.abAgents?.agentB && (
                    <Typography color="error">{getFormErrorMessage(errors.abAgents.agentB)}</Typography>
                )}
                <Controller
                    name="abAgents.distB"
                    control={control}
                    defaultValue={50}
                    render={({ field }) => (
                        <input
                            {...field}
                            type="number"
                            style={{ width: '40px' }}
                            onChange={(e) => {
                                const { distA, distB } = distributionFromTypedB(e.target.value);
                                field.onChange(distB);
                                setValue('abAgents.distA', distA);
                            }}
                            defaultValue={50}
                        />
                    )}
                />
            </FormControl>
        </Box>
    );
};

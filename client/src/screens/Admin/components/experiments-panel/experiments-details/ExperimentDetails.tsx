import { useAppSelector } from '@DAL/redux/store';
import { AgentLeanType, AgentsModes, ExperimentType } from '@models/AppModels';
import { Box, CircularProgress, Grid, Link } from '@mui/material';
import React, { useState } from 'react';
import { getAgentLean } from '../../../../../DAL/server-requests/agents';
import { extractError } from '../../../../../DAL/extractError';
import { SnackbarStatus, useSnackbar } from '../../../../../contexts/SnackbarProvider';
import useEffectAsync from '../../../../../hooks/useEffectAsync';
import { getExperimentUrl } from '../../../../../utils/commonFunctions';
import { AdressContainer, GridContainerStyled, GridItemStyled, TypographyStyled } from './ExperimentsDetails.s';

interface ExperimentDetailsProps {
    row: ExperimentType;
    experimentAgentDetails: {
        activeAgent: AgentLeanType | null;
        abAgents: { agentA: AgentLeanType; agentB: AgentLeanType } | null;
        groupAgents?: AgentLeanType[] | null;
    };
    setExperimentAgentDetails: (experimentAgentDetails) => void;
}

export const ExperimentDetails: React.FC<ExperimentDetailsProps> = ({
    row,
    experimentAgentDetails,
    setExperimentAgentDetails,
}) => {
    const { openSnackbar } = useSnackbar();
    const activeUser = useAppSelector((state) => state.activeUser);
    const [isLoading, setIsLoading] = useState(!experimentAgentDetails);

    useEffectAsync(async () => {
        if (
            !experimentAgentDetails ||
            (experimentAgentDetails.activeAgent && experimentAgentDetails.activeAgent._id !== row?.activeAgent) ||
            experimentAgentDetails.abAgents?.agentA?._id !== row?.abAgents?.agentA ||
            experimentAgentDetails.abAgents?.agentB?._id !== row?.abAgents?.agentB
        ) {
            setIsLoading(true);
            try {
                if (row.agentsMode === AgentsModes.SINGLE) {
                    const agent = await getAgentLean(row.activeAgent);
                    setExperimentAgentDetails({ activeAgent: agent, abAgents: null, groupAgents: null });
                } else if (row.agentsMode === AgentsModes.GROUP) {
                    const groupAgents = await Promise.all((row.groupAgents || []).map((id) => getAgentLean(id)));
                    setExperimentAgentDetails({ groupAgents, activeAgent: null, abAgents: null });
                } else {
                    const [agentA, agentB] = await Promise.all([
                        getAgentLean(row.abAgents.agentA),
                        getAgentLean(row.abAgents.agentB),
                    ]);
                    setExperimentAgentDetails({ abAgents: { agentA, agentB }, activeAgent: null, groupAgents: null });
                }
            } catch (error) {
                const fallback = `Failed to get ${row.agentsMode === AgentsModes.SINGLE ? 'active agent' : 'agents'}`;
                const { message } = extractError(error, fallback);
                openSnackbar(message, SnackbarStatus.ERROR);
            }
            setIsLoading(false);
        }
    }, [row]);

    if (isLoading) {
        return (
            <Box display={'flex'} justifyContent={'center'} width={'100%'} padding={2}>
                <CircularProgress size={32} />;
            </Box>
        );
    }

    return (
        <Box>
            <GridContainerStyled container spacing={2} justifyContent="center" alignItems="center">
                {activeUser?.role === 'admin' && row.ownerUsername && (
                    <Grid item>
                        <TypographyStyled variant="subtitle1" color="textSecondary">
                            Created by: <strong>{row.ownerUsername}</strong>
                        </TypographyStyled>
                    </Grid>
                )}
                <Grid item>
                    <TypographyStyled variant="subtitle1" color="textSecondary">
                        Mode: <strong>{row.agentsMode}</strong>
                    </TypographyStyled>
                </Grid>
                {row.agentsMode === AgentsModes.SINGLE ? (
                    <Grid item>
                        <TypographyStyled variant="subtitle1" color="textSecondary">
                            Active Agent: <strong>{experimentAgentDetails?.activeAgent?.title}</strong>
                        </TypographyStyled>
                    </Grid>
                ) : row.agentsMode === AgentsModes.GROUP ? (
                    <GridItemStyled item>
                        <Grid item>
                            <TypographyStyled variant="subtitle1" color="textSecondary">
                                Agents:
                                <strong>
                                    {` ${(experimentAgentDetails?.groupAgents || [])
                                        .map((agent) => agent?.title)
                                        .filter(Boolean)
                                        .join(', ')}`}
                                </strong>
                            </TypographyStyled>
                        </Grid>
                        <Grid>
                            <TypographyStyled variant="subtitle1" color="textSecondary">
                                Turn-taking: <strong>{row.turnTaking?.policy || 'rules'}</strong>
                            </TypographyStyled>
                        </Grid>
                    </GridItemStyled>
                ) : (
                    <GridItemStyled item>
                        <Grid item>
                            <TypographyStyled variant="subtitle1" color="textSecondary">
                                Agent A:
                                <strong>{`${experimentAgentDetails?.abAgents?.agentA.title} (${row.abAgents.distA}%)`}</strong>
                            </TypographyStyled>
                        </Grid>
                        <Grid>
                            <TypographyStyled variant="subtitle1" color="textSecondary">
                                Agent B:
                                <strong>{`${experimentAgentDetails?.abAgents?.agentB.title} (${row.abAgents.distB}%)`}</strong>
                            </TypographyStyled>
                        </Grid>
                    </GridItemStyled>
                )}
            </GridContainerStyled>
            <AdressContainer>
                <TypographyStyled variant="subtitle1" color="textSecondary">
                    Experiment Address:
                    <Link
                        href={getExperimentUrl(row._id.toString())}
                        target="_blank"
                        rel="noopener"
                    >
                        <strong> {getExperimentUrl(row._id.toString())}</strong>
                    </Link>
                </TypographyStyled>
            </AdressContainer>
        </Box>
    );
};

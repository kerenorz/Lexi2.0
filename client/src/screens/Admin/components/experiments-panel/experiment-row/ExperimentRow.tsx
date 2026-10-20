import { MoreOptionsMenu } from '@components/common/MoreOptionsMenu';
import { AgentLeanType, ExperimentType } from '@models/AppModels';
import ErrorIcon from '@mui/icons-material/Error';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Box, Chip, Collapse, IconButton, MenuItem, TableCell, TableRow, Tooltip, Typography } from '@mui/material';
import theme from '@root/Theme';
import React, { useState } from 'react';
import { ExperimentDetails } from '../experiments-details/ExperimentDetails';
import { ActiveExpSelect, ExpInfo, TableRowStyled } from './ExperimentRow.s';

interface ExperimentRowProps {
    row: ExperimentType;
    onStatusChange: (id: string, isActive: boolean) => void;
    handleMenuAction: (action: string, row: ExperimentType) => void;
    // Per-owner color bar in 'Users' grouping; undefined in flat sort modes.
    groupColor?: string;
}

export const ExperimentRow: React.FC<ExperimentRowProps> = ({ row, onStatusChange, handleMenuAction, groupColor }) => {
    const [open, setOpen] = useState(false);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [experimentAgentDetails, setExperimentAgentDetails] = useState<{
        activeAgent: AgentLeanType | null;
        abAgents: { agentA: AgentLeanType; agentB: AgentLeanType } | null;
        groupAgents?: AgentLeanType[] | null;
    }>(null);

    const timeAgo = (timestamp: number) => {
        const now = Date.now();
        const elapsed = now - timestamp;
        const seconds = Math.floor(elapsed / 1000);
        if (seconds < 60) {
            return 'now';
        }

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes} min ago`;
        }

        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours} hr ago`;
        }

        const days = Math.floor(hours / 24);
        if (days < 30) {
            return `${days} days ago`;
        }

        const months = Math.floor(days / 30);
        if (months < 12) {
            return `${months} months ago`;
        }

        const years = Math.floor(months / 12);
        return `${years} years ago`;
    };

    const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const handleStatusChange = (event) => {
        const newStatus = event.target.value === 'Active';
        onStatusChange(row._id, newStatus);
    };

    return (
        <React.Fragment>
            <TableRowStyled>
                <TableCell sx={groupColor ? { borderLeft: `4px solid ${groupColor}` } : undefined}>
                    <IconButton aria-label="expand row" size="small" onClick={() => setOpen(!open)}>
                        {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                    </IconButton>
                </TableCell>
                <TableCell component="th" scope="row">
                    <Box display="flex" alignItems="center" gap={1}>
                        <span>{row.title}</span>
                        <Chip
                            size="small"
                            variant="outlined"
                            label={`${row.numberOfParticipants ?? 0} participants`}
                        />
                    </Box>
                </TableCell>
                <TableCell>
                    <Tooltip title={row.description} placement="bottom">
                        <span
                            style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {row.description}
                        </span>
                    </Tooltip>
                </TableCell>
                <TableCell component="th" scope="row">
                    <Box display={'flex'} justifyContent={'left'} paddingLeft={4}>
                        <Typography color={theme.palette.secondary.main}>{row.numberOfParticipants}</Typography>
                    </Box>
                </TableCell>
                <TableCell component="th" scope="row">
                    <Box display={'flex'} justifyContent={'left'} paddingLeft={4}>
                        <Typography color={theme.palette.secondary.main}>{row.totalSessions}</Typography>
                    </Box>
                </TableCell>
                <TableCell component="th" scope="row">
                    <Box display={'flex'} justifyContent={'left'} paddingLeft={4}>
                        <Typography color={theme.palette.secondary.main}>{row.openSessions}</Typography>
                    </Box>
                </TableCell>
                <TableCell>{timeAgo(row.timestamp)}</TableCell>
                <TableCell>
                    <Box display="flex" alignItems="center" gap={0.5}>
                        {/* Config warning (e.g. deleted agents) beside the status, which is
                            deliberately not auto-deactivated. A button so touch and keyboard reach it. */}
                        {row.configIssue && (
                            <Tooltip title={row.configIssue.message} placement="top" enterTouchDelay={0}>
                                <IconButton
                                    size="small"
                                    aria-label={row.configIssue.message}
                                    sx={{ padding: '2px' }}
                                >
                                    <ErrorIcon sx={{ color: '#ed6c02', fontSize: '1.1rem' }} />
                                </IconButton>
                            </Tooltip>
                        )}
                        <ActiveExpSelect
                            isActive={row.isActive}
                            MenuProps={{
                                PaperProps: {
                                    sx: {
                                        '& .MuiMenuItem-root': {
                                            fontSize: '0.875rem',
                                        },
                                    },
                                },
                            }}
                            value={row.isActive ? 'Active' : 'Inactive'}
                            onChange={handleStatusChange}
                            size="small"
                        >
                            <MenuItem value="Active">Active</MenuItem>
                            <MenuItem value="Inactive">Inactive</MenuItem>
                        </ActiveExpSelect>
                    </Box>
                </TableCell>
                <TableCell>
                    <IconButton onClick={handleMenuClick}>
                        <MoreVertIcon />
                    </IconButton>
                    <MoreOptionsMenu
                        anchorEl={anchorEl}
                        onMenuClose={handleMenuClose}
                        handleMenuAction={(action) => handleMenuAction(action, row)}
                        showEmbedKit={Boolean(row.segments?.enabled)}
                    />
                </TableCell>
            </TableRowStyled>
            <TableRow>
                <ExpInfo colSpan={10}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        <ExperimentDetails
                            row={row}
                            experimentAgentDetails={experimentAgentDetails}
                            setExperimentAgentDetails={setExperimentAgentDetails}
                        />
                    </Collapse>
                </ExpInfo>
            </TableRow>
        </React.Fragment>
    );
};

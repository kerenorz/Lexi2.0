import {
    downloadExperimentJSON,
    downloadExperimentXLSX,
    downloadPilotRunsXLSX,
} from '@DAL/server-requests/dataAggregation';
import { extractError } from '@DAL/extractError';
import AsyncButton from '@components/common/AsyncButton';
import { SnackbarStatus, useSnackbar } from '@contexts/SnackbarProvider';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    IconButton,
    InputAdornment,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import { saveAs } from 'file-saver';
import { Fragment, useState } from 'react';
import {
    buildEmbedKitDoc,
    embedKitFilename,
} from '../experiments-details/embedKitDoc';
import { useAppSelector } from '@DAL/redux/store';
import { ExperimentType } from '../../../../../models/AppModels';
import { getExperimentUrl } from '../../../../../utils/commonFunctions';
import { ExperimentRow } from '../experiment-row/ExperimentRow';
import { filterByText, groupByOwner, ownerColor, sortItems } from '../../shared/listSortGroup';
import { ColumnTitle, ListBox, TablePaper } from './ExperimentsList.s';

const ExperimentsList = ({
    experiments,
    sortMode,
    search = '',
    handleSaveChanges,
    handleStatusChange,
    setIsEditMode,
    modifiedExperiments,
    handleCancelChanges,
    setEditExperiment,
    setOpenExperimentFormDialog,
    isLoadingStatusChange,
    isLoadingExperiments,
    setOpenDeleteExpDialog,
}) => {
    const { openSnackbar } = useSnackbar();
    const activeUser = useAppSelector((state) => state.activeUser);
    const showUsers = activeUser?.role === 'admin';
    const [openShareDialog, setOpenShareDialog] = useState(false);
    const [shareLink, setShareLink] = useState('');
    const handleMenuAction = async (action: string, row: ExperimentType) => {
        if (action === 'edit') {
            setEditExperiment(row);
            setIsEditMode(true);
            setOpenExperimentFormDialog(true);
        } else if (action === 'downloadJSON') {
            try {
                openSnackbar('Downloading JSON...', SnackbarStatus.INFO);
                await downloadExperimentJSON(row._id, row.title);
                openSnackbar('Download JSON Success !', SnackbarStatus.SUCCESS);
            } catch (err) {
                const { message } = extractError(err, 'Failed to Download JSON');
                openSnackbar(message, SnackbarStatus.ERROR);
            }
        } else if (action === 'downloadExcel') {
            try {
                openSnackbar('Downloading Excel...', SnackbarStatus.INFO);
                await downloadExperimentXLSX(row._id, row.title);
                openSnackbar('Download Excel Success !', SnackbarStatus.SUCCESS);
            } catch (err) {
                const { message } = extractError(err, 'Failed to Download Excel');
                openSnackbar(message, SnackbarStatus.ERROR);
            }
        } else if (action === 'downloadPilots') {
            try {
                openSnackbar('Downloading your pilot runs...', SnackbarStatus.INFO);
                await downloadPilotRunsXLSX(row._id, row.title);
                openSnackbar('Pilot runs downloaded', SnackbarStatus.SUCCESS);
            } catch (err) {
                const { message } = extractError(err, 'Failed to download pilot runs');
                openSnackbar(message, SnackbarStatus.ERROR);
            }
        } else if (action === 'downloadEmbedKit') {
            // Built client-side: everything needed is already on the row or in the URL.
            try {
                const doc = buildEmbedKitDoc({
                    title: row.title,
                    experimentId: row._id.toString(),
                    baseUrl: window.location.origin,
                    blocks: Number(row.segments?.count) || 0,
                    generatedAt: new Date(),
                });
                saveAs(new Blob([doc], { type: 'text/plain;charset=utf-8' }), embedKitFilename(row.title));
                openSnackbar('Embed kit downloaded', SnackbarStatus.SUCCESS);
            } catch (err) {
                const { message } = extractError(err, 'Failed to build the embed kit');
                openSnackbar(message, SnackbarStatus.ERROR);
            }
        } else if (action === 'share') {
            setShareLink(getExperimentUrl(row._id));
            setOpenShareDialog(true);
        } else if (action === 'delete') {
            setEditExperiment(row);
            setOpenDeleteExpDialog(true);
        }
    };

    const areExperimentsModified = Object.values(modifiedExperiments).length !== 0;

    const handleCopyLink = () => {
        navigator.clipboard.writeText(shareLink);
        openSnackbar('Link copied to clipboard', SnackbarStatus.SUCCESS);
    };

    // Usage = participants; newest = launch timestamp (fallback createdAt); owner = creator.
    const getUsage = (e: ExperimentType) => e.numberOfParticipants ?? 0;
    const getTime = (e: ExperimentType) => e.timestamp || (e.createdAt ? new Date(e.createdAt).getTime() : 0);
    const getOwner = (e: ExperimentType) => e.ownerUsername || 'Unknown';

    // Display-only: the parent keeps the full list, so toggles on hidden rows survive.
    const visibleExperiments = filterByText<ExperimentType>(experiments, search, (e) => [
        e.title,
        e.description,
        e.ownerUsername,
    ]);

    const renderRows = () => {
        if (sortMode === 'users' && showUsers) {
            return groupByOwner(visibleExperiments, getOwner, getTime).map((group) => {
                const color = ownerColor(group.owner);
                return (
                    <Fragment key={`group-${group.owner}`}>
                        <TableRow>
                            <TableCell
                                colSpan={9}
                                sx={{ borderLeft: `4px solid ${color}`, backgroundColor: 'rgba(0,0,0,0.03)', py: 0.5 }}
                            >
                                <Typography variant="subtitle2" fontWeight={600}>
                                    {group.owner}
                                </Typography>
                            </TableCell>
                        </TableRow>
                        {group.items.map((experiment) => (
                            <ExperimentRow
                                key={experiment._id}
                                row={experiment}
                                handleMenuAction={handleMenuAction}
                                onStatusChange={handleStatusChange}
                                groupColor={color}
                            />
                        ))}
                    </Fragment>
                );
            });
        }
        return sortItems(visibleExperiments, sortMode, getUsage, getTime).map((experiment) => (
            <ExperimentRow
                key={experiment._id}
                row={experiment}
                handleMenuAction={handleMenuAction}
                onStatusChange={handleStatusChange}
            />
        ));
    };

    return (
        <ListBox style={{ marginTop: '1vh' }}>
            <TablePaper>
                <Box display={'flex'} justifyContent={'space-between'} padding={2} sx={{ paddingBottom: 0 }}>
                    {areExperimentsModified ? (
                        <Box>
                            <AsyncButton
                                sx={{ mr: 1 }}
                                style={{ marginBottom: 0 }}
                                variant="contained"
                                isLoading={isLoadingStatusChange}
                                color="primary"
                                onClick={handleSaveChanges}
                                disabled={!areExperimentsModified}
                                size="small"
                            >
                                Save Changes
                            </AsyncButton>
                            <Button
                                variant="outlined"
                                color="primary"
                                onClick={handleCancelChanges}
                                disabled={!areExperimentsModified}
                                size="small"
                                style={{ marginBottom: 0 }}
                            >
                                Cancel
                            </Button>
                        </Box>
                    ) : (
                        <Box />
                    )}
                </Box>
                <TableContainer>
                    <Table aria-label="collapsible experiments table">
                        <TableHead>
                            <TableRow>
                                <TableCell style={{ width: '3%' }} />
                                <ColumnTitle style={{ width: '10%' }}>Title</ColumnTitle>
                                <ColumnTitle style={{ width: '22%' }}>Description</ColumnTitle>
                                <ColumnTitle style={{ width: '6%' }}>Participants</ColumnTitle>
                                <ColumnTitle style={{ width: '6%' }}>Sessions</ColumnTitle>
                                <ColumnTitle style={{ width: '6%' }}>Open Sessions</ColumnTitle>
                                <ColumnTitle style={{ width: '10%' }}>Launch Time</ColumnTitle>
                                <ColumnTitle style={{ width: '8%' }}>Status</ColumnTitle>
                                <TableCell style={{ width: '2%' }} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {isLoadingExperiments ? (
                                <TableRow>
                                    <TableCell colSpan={10} align="center">
                                        <CircularProgress />
                                    </TableCell>
                                </TableRow>
                            ) : visibleExperiments.length ? (
                                renderRows()
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={10} align="center">
                                        <Typography variant="body1">
                                            <b>
                                                {search
                                                    ? `No experiments match "${search}"`
                                                    : 'No experiments found'}
                                            </b>
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </TablePaper>
            <Dialog open={openShareDialog} onClose={() => setOpenShareDialog(false)}>
                <DialogContent>
                    <Typography variant="body1" color="textPrimary" gutterBottom>
                        For sharing your experiment with participants, send them the following link:
                    </Typography>
                    <TextField
                        fullWidth
                        value={shareLink}
                        variant="outlined"
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        onClick={handleCopyLink}
                                        color="primary"
                                        aria-label="Copy link to clipboard"
                                    >
                                        <FileCopyIcon />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenShareDialog(false)} color="primary">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </ListBox>
    );
};

export default ExperimentsList;

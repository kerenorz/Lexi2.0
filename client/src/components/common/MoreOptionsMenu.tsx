import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import IntegrationInstructionsOutlinedIcon from '@mui/icons-material/IntegrationInstructionsOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import SimCardDownloadOutlinedIcon from '@mui/icons-material/SimCardDownloadOutlined';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';

export const MoreOptionsMenu = ({
    anchorEl,
    onMenuClose,
    handleMenuAction,
    showEmbedKit = false,
}: {
    anchorEl: null | HTMLElement;
    onMenuClose: () => void;
    handleMenuAction;
    // Only survey-embedded studies have an embed kit.
    showEmbedKit?: boolean;
}) => (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onMenuClose}>
        <MenuItem
            onClick={() => {
                onMenuClose();
                handleMenuAction('share');
            }}
        >
            <ListItemIcon>
                <ShareOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Share</ListItemText>
        </MenuItem>
        <MenuItem
            onClick={() => {
                onMenuClose();
                handleMenuAction('edit');
            }}
        >
            <ListItemIcon>
                <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem
            onClick={() => {
                onMenuClose();
                handleMenuAction('downloadJSON');
            }}
        >
            <ListItemIcon>
                <SimCardDownloadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download JSON</ListItemText>
        </MenuItem>
        <MenuItem
            onClick={() => {
                onMenuClose();
                handleMenuAction('downloadExcel');
            }}
        >
            <ListItemIcon>
                <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download Excel</ListItemText>
        </MenuItem>
        {/* Separate from "Download Excel": the participant export excludes the researcher's own runs. */}
        <MenuItem
            onClick={() => {
                onMenuClose();
                handleMenuAction('downloadPilots');
            }}
        >
            <ListItemIcon>
                <ScienceOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download My Pilot Runs</ListItemText>
        </MenuItem>
        {/* No "Download Action Units" entry: its route allowed path traversal and was removed. */}
        {/* With the exports: it is also a download. */}
        {showEmbedKit && (
            <MenuItem
                onClick={() => {
                    onMenuClose();
                    handleMenuAction('downloadEmbedKit');
                }}
            >
                <ListItemIcon>
                    <IntegrationInstructionsOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Qualtrics Embed Kit</ListItemText>
            </MenuItem>
        )}
        <MenuItem
            onClick={() => {
                onMenuClose();
                handleMenuAction('delete');
            }}
        >
            <ListItemIcon>
                <DeleteIcon fontSize="small" sx={{ color: 'red' }} />
            </ListItemIcon>
            <ListItemText primary="Delete" primaryTypographyProps={{ sx: { color: 'red' } }} />
        </MenuItem>
    </Menu>
);

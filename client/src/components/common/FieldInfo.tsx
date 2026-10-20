import { Tooltip, IconButton } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

interface FieldInfoProps {
    text: string;
}

const FieldInfo = ({ text }: FieldInfoProps) => (
    <Tooltip title={text} arrow>
        <IconButton size="small" tabIndex={-1} sx={{ p: 0.25, ml: 0.5, verticalAlign: 'middle' }}>
            <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        </IconButton>
    </Tooltip>
);

export default FieldInfo;

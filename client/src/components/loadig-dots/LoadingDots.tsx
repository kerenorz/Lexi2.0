import { Box } from '@mui/material';
import theme from '@root/Theme';
import './LoadingDots.css';

// `color` tints the indicator bubble for the current group speaker. Default
// (undefined) keeps the existing assistant color, so single-agent and the
// network-wait state are byte-identical.
const LoadingDots = ({ color }: { color?: string }) => (
    <Box
        sx={{
            margin: 1.5,
            padding: 2,
            borderRadius: '12px',
            background: color ?? theme.palette.assistantMessage.main,
            maxWidth: '80%',
            display: 'inline-block',
            clear: 'both',
            float: 'left',
        }}
    >
        <Box className="loadingDots">
            <span />
            <span />
            <span />
        </Box>
    </Box>
);

export default LoadingDots;

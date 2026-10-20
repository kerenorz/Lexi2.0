import { Grid } from '@mui/material';
import { styled } from '@mui/material/styles';
import { Container } from '@mui/system';

export const MainContainer = styled(Grid)({
    backgroundColor: 'white',
});

export const SectionContainer = styled(Container)({
    justifyContent: 'center',
    height: 'fit-content',
    padding: 0,
    maxWidth: '100%',
    width: '100%',
    display: 'flex',
});

// `dvh` because mobile `vh` ignores the URL bar and keyboard, hiding the composer; `93vh` is
// the fallback. Minus `--lexi-chrome-height` (set by ProtectedExperimentRoute for its TopBar,
// 0 when embedded), or the composer is cropped inside the non-scrolling 100vh wrapper.
export const SectionInnerContainer = styled(Grid)({
    height: '93vh',
    minHeight: '93vh',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ['@supports (height: 100dvh)' as any]: {
        height: 'calc(100dvh - var(--lexi-chrome-height, 0px))',
        minHeight: 0,
    },
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
});

export const EmptySection = styled('div')({
    borderLeft: '1px solid #ccc',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px',
});

export const MessageListContainer = styled(Grid)({
    flex: 1,
    overflow: 'auto',
    // Stops scroll chaining to the host survey page when the list hits its top.
    overscrollBehavior: 'contain',
    // Momentum scrolling inside an iframe on iOS; a no-op elsewhere.
    WebkitOverflowScrolling: 'touch',
    marginBottom: '8px',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
});

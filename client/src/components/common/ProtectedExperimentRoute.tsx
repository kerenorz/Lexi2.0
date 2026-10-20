import { Pages } from '@app/App';
import useActiveUser from '@hooks/useActiveUser';
import { Box } from '@mui/system';
import { useLayoutEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';

const PrivateExperimentRoute = ({ TopBar, setIsOpen }) => {
    const { activeUser } = useActiveUser();
    const { experimentId } = useParams();

    // TopBar height, exposed as `--lexi-chrome-height` so the chat fits below it; otherwise the
    // composer is cropped. Measured rather than hardcoded so it can't drift from the TopBar.
    const chromeRef = useRef<HTMLDivElement>(null);
    const [chromeHeight, setChromeHeight] = useState(0);

    useLayoutEffect(() => {
        const el = chromeRef.current;
        if (!el) return undefined;
        const measure = () => setChromeHeight(el.getBoundingClientRect().height);
        measure();
        // The bar is sized in vh, so it changes with the window and on an orientation flip.
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const hasValidSessionForExperiment =
        !!activeUser &&
        (activeUser.role !== 'participant' || activeUser.experimentId === experimentId);

    if (!hasValidSessionForExperiment) {
        return <Navigate to={`${Pages.EXPERIMENT_LOGIN.replace(':experimentId', experimentId)}`} replace />;
    }

    return (
        <Box
            style={{
                overflow: 'hidden',
                maxHeight: '100vh',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ['--lexi-chrome-height' as any]: `${chromeHeight}px`,
            }}
        >
            {/* Wrapped for measuring; the static AppBar takes real layout space. */}
            <div ref={chromeRef}>
                <TopBar setIsOpen={setIsOpen} />
            </div>
            <Outlet />
        </Box>
    );
};

export default PrivateExperimentRoute;

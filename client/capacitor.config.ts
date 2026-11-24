import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a thin shell around the live Lexi site: it opens APP_START_URL and shows it
// full screen, so the app always runs the deployed client and talks to the deployed server, with
// no separate build or API settings. Point it at an experiment link (https://<host>/e/<id>) to
// build a study app that opens straight to that study's sign-up.
//
// Set it for one build without editing this file (PowerShell):
//   $env:LEXI_APP_URL="https://bgulexi.com/e/<experimentId>"; npx cap sync android
const APP_START_URL = process.env.LEXI_APP_URL || 'https://bgulexi.com';

const config: CapacitorConfig = {
    appId: 'com.lexi.app',
    appName: 'Lexi',
    // Only used as the offline fallback page; the app loads APP_START_URL.
    webDir: 'build',
    server: {
        url: APP_START_URL,
    },
};

export default config;

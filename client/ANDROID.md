# Lexi as an Android app

The app in `android/` is a thin [Capacitor](https://capacitorjs.com) shell around the live Lexi site.
It opens one address full screen and runs the deployed client against the deployed server, so it needs
no API settings of its own and picks up every deploy without a new build.

The address is set in `capacitor.config.ts` (`APP_START_URL`). By default it opens `https://bgulexi.com`.
For a study, point it at the experiment link so participants land straight on its sign-up.

## Build an APK (Windows)

Needs Node 22 and [Android Studio](https://developer.android.com/studio).

```powershell
cd client
npm install
npm run build
$env:LEXI_APP_URL="https://bgulexi.com/e/<experimentId>"
npx cap sync android
npx cap open android
```

In Android Studio: **Build → Generate App Bundles or APKs → Generate APKs**. The file is written to
`client/android/app/build/outputs/apk/debug/app-debug.apk`. Participants install it from a link
(Android asks them to allow installs from that source once).

To try it without a phone, press the green Run button in Android Studio to start the emulator.

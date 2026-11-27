# Daymark Office Attendance

This Expo application connects to the Daymark Flask backend. Admin and Employee accounts share the same login screen; authorization and attendance rules remain enforced by the backend. `src/config/api.ts` is the centralized API client and reads `EXPO_PUBLIC_API_URL`.

## Local development

For local development only, set `EXPO_PUBLIC_API_URL` to a development backend address reachable by the device (a LAN address may be needed on a physical phone). Start the app with:

```powershell
npm install
npx expo start
```

All EAS-generated APKs must use a public HTTPS backend URL from their selected EAS environment (`preview` or `production`). The app configuration rejects missing, HTTP, loopback, and private/LAN URLs for every EAS build. Local Expo development can still use a reachable development server address; installed EAS APKs cannot use the laptop's address.

## Production APK prerequisites

Before building:

1. Provision the Render service and managed PostgreSQL database using the root `render.yaml`. Complete the separately approved schema/data migration before real users switch to the new backend. The SQLite database is not production storage.
2. Sign in to the Expo account that owns the existing project ID in `app.json`; verify the project with `npx eas-cli@latest project:info`.
3. In the linked Expo project's `production` environment, configure:
   - `EXPO_PUBLIC_API_URL`: the actual Render public HTTPS service URL (no trailing slash required). Do not use a guessed URL, localhost, or a laptop LAN IP.
   - `GOOGLE_MAPS_API_KEY` (optional): a key restricted to `com.haripriya01.attendance` and its Android signing certificate, if Admin map tiles are required.

Do not put production database credentials or secret keys in `.env`, source code, or version control. The backend URL is public and is embedded in the APK. The production API client and Expo app configuration reject missing or non-public HTTP backend URLs. Existing login, admin, employee, geofencing, leave, attendance history, badges, and post-check-in nickname behavior remain in the app.

## Build and install

From this directory, build an internally distributable Android APK using the production HTTPS environment:

```powershell
npx eas-cli@latest build --platform android --profile production-apk
```

EAS prompts for Android signing credentials if the Expo project does not already have them. Wait for the build to complete successfully, then download the APK from the build URL printed by EAS or the project's Expo build page. On an Android phone, open the downloaded APK and allow installation from that source if prompted. For a connected phone with Android platform tools installed, you can instead install it with:

```powershell
adb install path\to\attendance.apk
```

The EAS build is not complete until Expo reports a successful build and provides an APK artifact.

## Attendance and location

An Admin sets the office location from **More → Profile & settings** while at the actual office. The allowed radius defaults to 200 metres. Employees grant foreground location permission when checking in; the Flask server validates their coordinates and applies the existing radius and Present/Late rules. Location is not requested for check-out. Current-location capture uses `expo-location`; only standalone Admin map tiles need the optional Google Maps key.

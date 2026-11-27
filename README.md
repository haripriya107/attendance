# Daymark Office Attendance

Daymark is a Flask office attendance system with a vanilla JavaScript web interface and an Expo Android app. It uses one sign-in page for both roles and redirects users to the dashboard authorized for their account. Employee accounts are created by an administrator; there is no public registration endpoint. Local development defaults to `backend\attendance.db`; production uses PostgreSQL through `DATABASE_URL`. The SQLite file has not been modified or migrated.

## Run locally

From the project directory in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PORT = "5000"
$env:OFFICE_TIMEZONE = "Asia/Kolkata"
$env:OFFICIAL_CHECK_IN_TIME = "09:30"
flask --app backend.app run --port $env:PORT
```

Without `DATABASE_URL`, local development uses the existing SQLite file. Do not run PostgreSQL migrations or the `create-admin` command against that file. For a separate, empty local PostgreSQL database, set `DATABASE_URL` in the process environment and run `python -m alembic upgrade head` before starting Flask. Create an initial administrator with `flask --app backend.app create-admin` only when that PostgreSQL database is empty. Never put database credentials or a production secret key in source control or command history.

## Render deployment preparation

`render.yaml` defines a free Render web service using the existing Gunicorn command and public `/api/health` check. Render provides HTTPS and a stable public service URL. `DATABASE_URL` is intentionally supplied as a secret in the Render dashboard, so the blueprint does not create a paid (or expiring free Render) database. The lowest-cost option is Render Free for Flask plus Neon Free PostgreSQL.

Both free tiers have limits and are not an uptime-guaranteed production setup. Render spins down an idle free web service after 15 minutes; waking it can take about one minute, and its local filesystem is ephemeral. Neon Free compute scales to zero and has usage/storage limits and no production SLA. Do not store application data on the Render filesystem. A stable HTTPS URL does not guarantee that the first request after idle will respond quickly enough for the current APK. For always-on service and production-grade availability, paid hosting is required.

The environment is configured for production sessions (`Secure`, `HttpOnly`, `SameSite=Lax`). `CORS_ALLOWED_ORIGINS` is optional and should contain exact HTTPS origins only if a browser-based client is hosted on another origin. The Android app uses native requests and does not need CORS. The hosted web interface and API share one origin by default.

### Required accounts and values

- A Render account and a private GitHub/GitLab repository Render can access. The root `.gitignore` excludes local databases, APKs, signing keys, local environment files, IDE metadata, and generated build output.
- A Neon account and a free PostgreSQL project. Keep its connection string private and enter it as `DATABASE_URL` in the Render dashboard.
- An Expo account for EAS APK builds. `mobile_app\app.json` already contains an EAS project ID and the existing Android package ID is `com.haripriya01.attendance`.
- The real Render service URL (available only after provisioning); set that exact `https://...` URL as `EXPO_PUBLIC_API_URL` in the Expo project's `production` environment. Do not guess it or send it to the app before the backend exists.
- Confirm `OFFICE_TIMEZONE` and `OFFICIAL_CHECK_IN_TIME` for the office. The blueprint defaults to `Asia/Kolkata` and `09:30`.
- A separate exact HTTPS web origin only if a web client will be hosted on a different domain. No CORS origin is required for the native APK or same-origin web app.
- Optionally, a Google Maps Android API key restricted to the package ID and signing certificate if the Admin map tiles are needed.

Do not send account passwords, `FLASK_SECRET_KEY`, or database credentials in chat. Render generates and stores the Flask secret. Store the Neon connection string only in Render's `DATABASE_URL` environment variable. `EXPO_PUBLIC_API_URL` is public and is bundled into the APK.

### Deployment sequence

1. Keep `backend\attendance.db` private and unchanged. This deployment setup never copies or modifies the SQLite file.
2. Create a Neon Free PostgreSQL project. The Render Blueprint prompts for `DATABASE_URL`; enter Neon's connection string there and keep it out of source control and chat.
3. In Render, create a Blueprint from the repository and confirm the web service is on the Free plan. The Blueprint no longer creates a Render database or any paid resource.
4. Before allowing users to sign in, separately review the SQLite-to-PostgreSQL import plan below. Only after explicit approval, initialize the new PostgreSQL schema. Do not migrate or change any records as part of deployment without approval.
5. After Render deploys, obtain the actual HTTPS service URL from its dashboard and verify `/api/health` returns HTTP 200 and JSON status `success`. Do not guess or invent the URL. This health check confirms database connectivity only; it does not prove that existing SQLite records were imported.
6. Add the actual URL to the Expo project's `production` environment as `EXPO_PUBLIC_API_URL`. Build a fresh APK only after the real endpoint passes its health check; then inspect and test that APK.

### SQLite inspection and safe migration plan

The existing database was inspected read-only: `PRAGMA integrity_check` returned `ok`. It contains 3 employee rows (including admin/employee accounts), 7 attendance rows, 2 leave rows, 0 department rows, 2 notification rows, 0 announcement rows, and 1 office-location settings row. The schema also includes `employees`, `attendance`, `leaves`, `departments`, `announcements`, `notifications`, and `office_location_settings`.

The original PostgreSQL baseline omitted `announcements` and `notifications`; the new additive Alembic revision adds those tables and their constraints/indexes. No migration or import was run. For a safe cutover:

1. Make a separate verified backup copy of the SQLite database without replacing or editing `backend\attendance.db`; temporarily stop writes during the final snapshot.
2. Apply the schema to a fresh/staging PostgreSQL database first. Transfer every table, preserving primary keys, foreign keys, employee roles, password hashes, attendance and leave values, notification event keys/read flags, announcements, and the configured office coordinates/radius. The baseline seeds an unconfigured office-location row with ID 1; update that row with the SQLite settings rather than trying to insert a second row. Do not reset passwords or import only a subset.
3. Because IDs are copied explicitly, advance PostgreSQL identity sequences past each table's maximum imported ID.
4. Compare per-table row counts, foreign-key consistency, key unique values, office-location settings, and password-hash format between source and destination. Test sign-in with existing accounts and exercise admin, attendance/geofencing, leave, history, and mobile check-in/nickname flows in staging.
5. Obtain approval before importing to production or switching the live APK/users. Keep the SQLite source untouched and establish a recovery plan for writes made after cutover; do not use destructive downgrades.

`backend\postgres.py` provides bounded SQLAlchemy pooling and psycopg 3. Alembic reads `DATABASE_URL` only from the process environment. Optional pool settings are `DATABASE_POOL_SIZE` (default `4`), `DATABASE_MAX_OVERFLOW` (default `0`), `DATABASE_POOL_TIMEOUT` seconds (default `30`), and `DATABASE_POOL_RECYCLE` seconds (default `1800`).

## Sessions and dashboard access

Flask authentication uses a signed browser cookie. Tabs in the same browser profile share that cookie and therefore share one signed-in account; signing in as another user replaces the active account in all those tabs. Sign out before switching accounts. A user who manually opens the other role's dashboard receives an access-denied response, while successful login redirects to the dashboard for the user's database role.

## Included features

- Role-checked admin and employee dashboards behind a shared login.
- Admin employee and department management, attendance reports with date and employee filters, complete filtered CSV export, and leave review.
- Employee profile contact updates, daily check-in/check-out, hours, attendance history, and leave requests. New employee accounts must change their temporary password before using protected workspace features.
- Employees change a password by verifying the current password. If they cannot sign in or have forgotten it, they must contact an administrator; admins can set a new temporary password, which is hashed and required to be changed at next sign-in.
- Employee profile updates write to the existing `employees` row, so the Admin directory and employee dashboard share the same source of truth. Employees can update their name and phone number; employment details remain admin-managed.
- Password hashing, parameterized PostgreSQL queries, inactive-account blocking, duplicate daily attendance prevention, and first-login password-change enforcement.
- JSON REST endpoints under `/api/auth`, `/api/admin`, `/api/employee`, and `/api/attendance`.

Office hours are 09:00–17:00. Attendance dates, times, and overview period boundaries use `OFFICE_TIMEZONE` (an IANA timezone such as `Asia/Kolkata`). If unset, the server's local timezone is used. Set the same value for every app worker. The configurable check-in cutoff uses `OFFICIAL_CHECK_IN_TIME` in 24-hour `HH:MM` format and defaults to `09:30`. Check-ins at or before the cutoff are marked Present; later check-ins are allowed and marked Late. The office end time does not restrict check-out. Change the environment variable before starting the Flask server to adjust the cutoff. The system records attendance when an employee checks in; it does not create automatic absentee records.

Run the PostgreSQL regression suite with `ATTENDANCE_TEST_DATABASE_URL` set in the current process. The test URL is accepted only when its scheme is `postgresql+psycopg`, host is `127.0.0.1`, port is `5432`, database is `attendance_test`, username is `attendance_test_user`, and it has no query parameters or fragment. Do not copy a production `DATABASE_URL` into the test variable. Each test creates a UUID-named schema, passes that schema to Alembic and the Flask test app, and drops only that generated schema during cleanup:

```powershell
python -m unittest backend.tests.test_app -v
```

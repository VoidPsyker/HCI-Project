# Hosted participant collection

Vercel serves the study URL and forwards requests to a single study server with persistent disk. The study server owns the SQLite database, raw event files, and gaze data. Set up the study server first, then deploy the Vercel project.

## Study server

1. Deploy this repository as one service on a container host that supports persistent volumes. Build from `Dockerfile.vercel`. On Railway, set `RAILWAY_DOCKERFILE_PATH=Dockerfile.vercel`.
2. Attach a persistent volume at `/app/data`. This covers the default database, raw event, and gaze paths. Run one replica so all requests use the same SQLite database.
3. Set `MERIDIAN_VERCEL_PROXY=false`, `PORT=8787`, and a unique `ADMIN_PASSWORD` in the host's secret settings. Use the same password when signing in through Vercel.
4. Enable a public HTTPS domain for the service, forwarding to port 8787. Use `/api/health` for the service health check.

## Vercel

Set `STUDY_BACKEND_ORIGIN` in the existing Vercel project's Production environment to the study server's HTTPS origin, with no path. Redeploy the project from the same revision as the study server. The Vercel container requires this setting at startup.

## Verify before collection

On the Vercel URL, sign in to `/admin`, create a rehearsal session, and complete one trial. Confirm the session row and download `events.csv` and `trials.csv`. Restart the study server and redeploy Vercel, then check that the same session and export rows are still present. Keep the disk attached on subsequent deployments and configure volume backups.

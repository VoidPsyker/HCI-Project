# Deploying to Vercel

Vercel builds `Dockerfile.vercel` at the repo root and runs it as a container function.
Default URL: `https://hci-project.vercel.app` (Vercel adds a suffix if that name is taken; the
project's Domains tab shows the real one).

## Steps

1. Sign in at <https://vercel.com> with the GitHub account that can see
   `VoidPsyker/HCI-Project`.
2. **Add New → Project**, pick `HCI-Project`, press **Import**.
3. Leave the framework preset and build settings as detected. Under **Environment
   Variables** add `ADMIN_PASSWORD` with a strong value. Without it, `/admin` accepts the
   public default `pilot-admin`.
4. Press **Deploy**. The first build takes a few minutes.
5. Open `/api/health` on the new URL to check the server, then `/` for the app and `/admin`
   for the researcher console.

Every push to `main` redeploys automatically.

## Limits

Vercel containers are stateless and scale to zero after 5 minutes without traffic. The SQLite
database and gaze files live inside the container, so all sessions are lost when it scales
down or redeploys, and two instances do not share data. Use this deployment to demo the app,
never to collect participant data. Real collection needs the Docker setup in the README, or a
hosted database behind `Repository`.

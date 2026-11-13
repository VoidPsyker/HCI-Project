# Hosted participant collection

The existing Vercel deployment runs `Dockerfile.vercel` as a Fastify proxy. It forwards the study URL to one persistent study server, which serves the API and built web app, including local WebGazer assets. Keep both services on the same revision. Do not configure a second static deployment or SPA rewrite in front of this container.

## Study server

1. Deploy this repository on a container host with persistent volumes, using `Dockerfile.vercel`. On Railway, set `RAILWAY_DOCKERFILE_PATH=Dockerfile.vercel`.
2. Attach a persistent volume at `/app/data` for SQLite, raw events and gaze data. Run one replica. Mount `/app/exports` too if retaining CLI-generated exports.
3. Set `MERIDIAN_VERCEL_PROXY=false`, `HOST=0.0.0.0`, `PORT=8787`, and a unique `ADMIN_PASSWORD` in the host's secret settings. The image defaults to proxy mode; overriding it is required on the persistent server. Never set `VERCEL=1` there (it also selects proxy mode).
4. Enable a public HTTPS domain forwarding to port 8787. Use `/api/health` as the health check. Back up the persistent volume.

For local collection, copy `.env.example` to `.env`, set `ADMIN_PASSWORD`, then run `docker compose up --build`. Compose exposes port 8787 unless `PORT` overrides the host port. HTTP camera access works only on localhost/loopback; a participant opening the host's LAN address needs HTTPS through a TLS reverse proxy.

## Vercel proxy

Set `STUDY_BACKEND_ORIGIN` in the existing project's Production environment to the study server's HTTPS origin, with no path, credentials or query. Keep `MERIDIAN_VERCEL_PROXY=true` (the image default). Redeploy from the same revision as the study server. The proxy does not own participant data and does not need the admin password; researchers authenticate through it using the study server's password.

Keep `VITE_API_BASE` empty when building so browser requests stay on the participant URL. Vite variables are public build-time settings, not a place for secrets. Docker excludes local `.env*` files, so deployment configuration must come from the host's settings.

## Camera and model delivery

The participant URL must use HTTPS. Preserve the backend's `Permissions-Policy: camera=(self)` and Content-Security-Policy through the proxy. The CSP must allow same-origin scripts/connections and `'unsafe-eval'`: MediaPipe's WebAssembly glue builds functions with `new Function`, and `'wasm-unsafe-eval'` alone blocks the face model so the camera never starts. MediaPipe also needs its local scripts and blob workers. Do not add a CDN dependency or allow arbitrary remote model downloads.

WebGazer 3.5.3 is bundled by Vite. `apps/web/scripts/copy-webgazer-assets.mjs` runs before the web build and copies the installed package's MediaPipe graph, loader, binary data and SIMD/non-SIMD WASM files to `apps/web/public/vendor/webgazer/mediapipe/face_mesh/`. Vite copies these into `apps/web/dist/vendor/`; Docker copies that built directory into the runtime image. No separate TensorFlow CDN assets are needed by the configured MediaPipe runtime. The current single-threaded runtime does not require SharedArrayBuffer or COOP/COEP; do not enable cross-origin isolation without verifying a change to the runtime.

Serve `.wasm` as `application/wasm`, `.js` as JavaScript, and `.data`/`.binarypb` as `application/octet-stream`. Vendor URLs are not content hashed: caches must revalidate them on a new deployment, and must not mark them immutable. API responses must remain private/no-store. Missing `/vendor/` or `/assets/` files must return 404, never `index.html`; real participant routes still need the SPA fallback.

## Verify before collection

CI builds the app and runs `deployment-assets.spec.ts` against the built Fastify service on port 8787, separately from the Vite-based scripted UI suite. It compares every shipped model/loader file to the installed WebGazer package, checks MIME types, cache policy, camera/CSP headers, missing asset 404s and participant-route fallback. Run `npm run test:deploy` for configuration regression checks. With a built study server running, run `PW_BASE_URL=http://127.0.0.1:8787 npx playwright test deployment-assets.spec.ts` for the serving contract.

Before admitting participants, repeat that serving test against the HTTPS study URL from the same revision (`PW_BASE_URL=https://your-study-host npx playwright test deployment-assets.spec.ts`), and inspect the browser network panel during camera initialization for failed model requests or CSP violations. This audit does not deploy or certify a remote host's current settings.

Sign in to `/admin`, create a rehearsal session, and complete a trial using a real webcam. Confirm the session and download `events.csv` and `trials.csv`. Restart the study server and redeploy the proxy, then confirm the same session and exports still exist. A successful asset check proves delivery, not participant gaze accuracy: complete the measured calibration and held-out validation before collecting trials.

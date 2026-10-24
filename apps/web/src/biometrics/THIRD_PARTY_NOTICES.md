# Third-party notices — biometrics

## WebGazer.js

- Package: `webgazer@3.5.3`
- Copyright (C) 2016–2026 Brown WebGazer Team
- License: GNU General Public License v3.0 or later (GPL-3.0-or-later)
- Source: https://github.com/brownhci/WebGazer
- npm: https://www.npmjs.com/package/webgazer
- Official maintenance ended 2026-02-24; community support only.

WebGazer is bundled locally and runs entirely in the participant's browser. This
project does not modify WebGazer. If the study build is distributed outside the
research team, GPL source-availability obligations for WebGazer (and the
combined work, to the extent required) must be reviewed by the study's legal
contact. The full license text is in `node_modules/webgazer/LICENSE.md` after
install, is copied to the served build as
`apps/web/public/vendor/webgazer/LICENSE-webgazer.md`, and is available from the
upstream repository.

WebGazer's MediaPipe face-mesh assets are served from
`apps/web/public/vendor/webgazer/mediapipe/face_mesh` and are not fetched from a
CDN at run time. They are copied from `node_modules/webgazer/dist/mediapipe`
by `apps/web/scripts/copy-webgazer-assets.mjs`.

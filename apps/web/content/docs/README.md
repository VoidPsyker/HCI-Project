# Editing participant content

- Edit the JSON file, then rebuild the web app (`npm run build`, or rebuild the Docker image).
- Consent text is a placeholder until ethics approval; bump `version` whenever its wording changes.
- Media: copy the approved clip into `apps/web/public/media/` and set `src` in `media.json`, for
  example `"src": "/media/happy-clip.mp4"`. With `src: null` the bundled placeholder is shown.
  Files must be local; the instrument makes no external requests.

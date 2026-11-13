// getUserMedia failures are identified by DOMException name; their messages differ per browser.
const CAMERA_ERROR_NAMES = new Set([
  "NotAllowedError",
  "SecurityError",
  "NotReadableError",
  "AbortError",
  "NotFoundError",
  "OverconstrainedError"
]);

const BLOCKED = "Camera access is blocked. Allow the camera for this site (camera icon in the address bar) and in your computer's privacy settings, then retry.";
const BUSY = "The camera is busy or was stopped by the computer. Close other apps or tabs that use it, such as Zoom or Teams, then retry.";
const INSECURE = "This page cannot use the camera. Open the study link starting with https:// in a current Chrome, Edge or Firefox.";

const MESSAGES: Record<string, string> = {
  NotAllowedError: BLOCKED,
  SecurityError: BLOCKED,
  NotReadableError: BUSY,
  AbortError: BUSY,
  NotFoundError: "No camera was found. Connect a webcam, then retry.",
  OverconstrainedError: "This camera cannot provide the video size eye tracking needs. Try another webcam.",
  camera_unavailable: INSECURE,
  webgazer_requires_secure_context: INSECURE,
  webgazer_requires_https_or_loopback: INSECURE,
  webgazer_incompatible: "This browser cannot use the camera. Use a current Chrome, Edge or Firefox.",
  gaze_source_stopped: "The camera stopped producing eye-tracking data. Check the camera, then retry."
};

/** Stable code for a failed camera start, so the cause survives to the participant screen. */
export function gazeErrorCode(error: unknown): string {
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  if (typeof name === "string" && CAMERA_ERROR_NAMES.has(name)) return name;
  if (typeof message === "string" && message) return message;
  return String(error);
}

export function describeGazeStartError(code: string): string {
  return MESSAGES[code] ?? `Eye tracking could not start (${code}).`;
}

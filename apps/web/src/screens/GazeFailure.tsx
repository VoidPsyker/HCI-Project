import type { CalibrationReport } from "@meridian/analysis";

function degrees(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "not evaluable" : `${value.toFixed(2)}°`;
}

/** Terminal gate: a mandatory biometric trial cannot start after a failed validation. */
export function GazeFailureScreen({
  report,
  onEnd,
  busy
}: {
  report: CalibrationReport | null;
  onEnd: () => Promise<void>;
  busy: boolean;
}) {
  const missing = report ? report.points.filter((point) => point.observation_count === 0).length : 0;
  const viewportChanged = report?.note === "gaze_viewport_changed";
  return (
    <section className="panel medium" data-testid="gaze-failure-screen">
      <div className="eyebrow">Eye-tracking exclusion</div>
      <h1>The scored trials cannot continue</h1>
      <p className="lede">
        {viewportChanged
          ? "The screen size changed after measurement, so the previous calibration is no longer valid. Eye tracking has stopped."
          : "The eye tracker did not meet the pre-registered validation gate. The study treats this as an exclusion rather than running the scored trials without usable gaze data."}
      </p>
      <div className="warning-box">
        {viewportChanged ? "Ask the researcher to remeasure the screen and start a new session." : <>
          <strong>Measured result:</strong> maximum held-out error {degrees(report?.max_error_deg ?? null)}; gate{" "}
          {degrees(report?.criterion_deg ?? null)}.
          {missing > 0 ? ` ${missing} calibration point${missing === 1 ? "" : "s"} had no prediction.` : ""}
        </>}
      </div>
      <p>
        The researcher will check the camera, lighting, and screen measurement. Your session will end with the normal
        debrief. You can still withdraw your data.
      </p>
      <div className="panel-actions">
        <button type="button" className="button danger" onClick={() => void onEnd()} disabled={busy} data-testid="gaze-failure-end">
          {busy ? "Ending session..." : "End session and debrief"}
        </button>
      </div>
    </section>
  );
}

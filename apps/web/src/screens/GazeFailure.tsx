import type { CalibrationReport } from "@meridian/analysis";

export function GazeFailureScreen({ report, onContinue, onRetry }: {
  report: CalibrationReport | null;
  onContinue: () => void;
  onRetry?: () => void;
}) {
  return (
    <section className="panel medium" data-testid="gaze-failure-screen">
      <h1>Eye tracking is unavailable</h1>
      <p className="lede">
        {report?.note === "gaze_viewport_changed" ? "The window size changed during eye tracking. " : ""}
        You can still complete the searches and questionnaires.
      </p>
      {report && report.note !== "gaze_viewport_changed" ? (
        <p role="status">
          {report.max_error_deg === null ? "Validation could not measure an error for every point." : `Maximum held-out error: ${report.max_error_deg.toFixed(2)}°. Gate: ${report.criterion_deg.toFixed(2)}°.`}
          {onRetry ? " Adjust your lighting and position, keep your head still, then try calibration again." : ""}
        </p>
      ) : null}
      <div className="panel-actions">
        {onRetry ? <button type="button" className="button secondary" onClick={onRetry}>Recalibrate</button> : null}
        <button type="button" className="button primary" onClick={onContinue} data-testid="gaze-failure-continue">
          Continue without eye tracking
        </button>
      </div>
    </section>
  );
}

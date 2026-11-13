import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CalibrationReport, CalibrationTarget } from "@meridian/analysis";
import type { GazeController } from "../gaze/GazeController";
import { describeGazeStartError } from "../gaze/startErrors";

function formatDegrees(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "not evaluable" : `${value.toFixed(2)}°`;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Nine-point explicit calibration followed by held-out validation.
 * Pass 1 trains all 9 points explicitly; Pass 2 measures held-out accuracy on the
 * final model with zero training calls. The dots are presentation only; training
 * clicks are issued by the source, so mouse movements cannot silently train the
 * model. The measured error is stored with the gaze data and never blocks the trials;
 * the cutoff is applied at analysis time. Participants may recalibrate first.
 */
export function GazeCalibrationScreen({
  controller,
  starting,
  startError,
  onRetry,
  onCalibrated,
  onSkip
}: {
  controller: GazeController | null;
  starting: boolean;
  startError: string | null;
  onRetry: () => void;
  onCalibrated: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState<"intro" | "running" | "done">("intro");
  const [phase, setPhase] = useState<"train" | "validate">("train");
  const [targets, setTargets] = useState<CalibrationTarget[]>([]);
  const [index, setIndex] = useState(0);
  const [recorded, setRecorded] = useState<number[]>([]);
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = async () => {
    if (!controller) return;
    setError(null);
    setRecorded([]);
    setReport(null);
    try {
      const list = controller.beginCalibration();
      setTargets(list);
      setStep("running");

      // Pass 1: Train all nine points first
      setPhase("train");
      for (let position = 0; position < list.length; position += 1) {
        if (cancelled.current) return;
        setIndex(position);
        await waitForPaint();
        if (cancelled.current) return;
        await controller.trainCalibrationTarget(list[position]!);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Pass 2: Held-out validation of the final model (zero training calls)
      setPhase("validate");
      const counts: number[] = [];
      for (let position = 0; position < list.length; position += 1) {
        if (cancelled.current) return;
        setIndex(position);
        await waitForPaint();
        if (cancelled.current) return;
        const count = await controller.validateCalibrationTarget(list[position]!);
        counts.push(count);
        setRecorded([...counts]);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      if (cancelled.current) return;
      const result = controller.finishCalibration();
      setReport(result);
      setStep("done");
    } catch (calibrationError) {
      if (!cancelled.current) {
        setError((calibrationError as Error).message);
        setStep("intro");
      }
    }
  };

  if (startError) {
    const sessionUnavailable = startError === "gaze_unauthorized" || startError === "gaze_token_invalid";
    const viewportChanged = startError === "gaze_viewport_changed";
    const terminal = sessionUnavailable || viewportChanged;
    return (
      <section className="panel medium" data-testid="gaze-calibration-screen">
        <div className="eyebrow">Eye tracker unavailable</div>
        <h1>{terminal ? "Ask for a new session link" : "Camera or calibration could not start"}</h1>
        <p className="lede">
          {sessionUnavailable
            ? "Eye tracking cannot resume in this page. Ask the researcher for a fresh session link."
            : viewportChanged
              ? "The screen size changed while the camera was starting. Eye tracking cannot continue in this page; ask the researcher for a fresh session link."
              : describeGazeStartError(startError)}
        </p>
        <p>{terminal ? "You can continue the study without eye tracking." : "You can retry, or continue without eye tracking."}</p>
        <div className="panel-actions">
          {!terminal ? (
            <button type="button" className="button secondary" onClick={onRetry} data-testid="gaze-calibration-retry">
              Retry camera setup
            </button>
          ) : null}
          <button type="button" className="button primary" onClick={onSkip}>
            Continue without eye tracking
          </button>
        </div>
      </section>
    );
  }

  if (starting || !controller) {
    return (
      <section className="panel medium" data-testid="gaze-calibration-screen">
        <div className="eyebrow">Preparing the eye tracker</div>
        <h1>Starting the camera</h1>
        <div className="spinner" />
        <p className="small-note">The camera was authorised by your separate gaze consent. It is not recording video.</p>
      </section>
    );
  }

  if (step === "intro") {
    return (
      <section className="panel medium" data-testid="gaze-calibration-screen">
        <div className="eyebrow">Calibration and validation</div>
        <h1>Nine points, then a held-out check</h1>
        <p className="lede">
          Keep your head still and look at the centre of each ring as it appears. Leave the mouse still. The rings
          advance automatically through nine training points and then nine accuracy checks.
        </p>
        <div className="warning-box soft">
          The accuracy check is stored with your eye-tracking data. Whatever the result, you then continue to the
          searches with eye tracking on.
        </div>
        {error ? (
          <div className="warning-box" role="alert">
            {error}
          </div>
        ) : null}
        <div className="panel-actions">
          <span className="small-note">Keep this browser window the same size until the study ends.</span>
          <button type="button" className="button primary big" onClick={() => void run()} data-testid="gaze-calibration-start">
            Begin calibration
          </button>
        </div>
      </section>
    );
  }

  if (step === "running") {
    const target = targets[index];
    const isTraining = phase === "train";
    return (
      <section className="panel medium" data-testid="gaze-calibration-screen">
        <div className="eyebrow">Calibration — {isTraining ? "Pass 1: Training" : "Pass 2: Validation"}</div>
        <h1>
          Point {index + 1} of {targets.length}
        </h1>
        <p className="lede">
          Look at the centre of the ring. Keep the mouse still and wait for the next ring.
        </p>
        <div className="small-note">
          {isTraining
            ? `Training point ${index + 1} of ${targets.length}. All points are trained before validation.`
            : `Validated ${recorded.length} point${recorded.length === 1 ? "" : "s"}.${
                recorded[index] === 0 ? " No prediction was captured for the last point; it is recorded as missing." : ""
              }`}
        </div>
        {target ? createPortal(
          <div
            aria-hidden="true"
            style={{
              position: "fixed",
              left: target.x_px,
              top: target.y_px,
              width: 34,
              height: 34,
              marginLeft: -17,
              marginTop: -17,
              border: "3px solid #0f766e",
              borderRadius: "50%",
              background: "rgba(15, 118, 110, 0.18)",
              boxShadow: "0 0 0 10px rgba(15, 118, 110, 0.08)",
              pointerEvents: "none",
              zIndex: 50
            }}
            data-testid="gaze-calibration-target"
          />,
          document.body
        ) : null}
      </section>
    );
  }

  const missing = report ? report.points.filter((point) => point.observation_count === 0).length : 0;
  return (
    <section className="panel medium" data-testid="gaze-calibration-result">
      <div className="eyebrow">Validation result</div>
      <h1>Calibration complete</h1>
      {report ? (
        <>
          <p className="lede">
            Maximum held-out error: <strong>{formatDegrees(report.max_error_deg)}</strong>. Mean held-out error:{" "}
            <strong>{formatDegrees(report.mean_error_deg)}</strong>. Analysis cutoff: {report.criterion_deg.toFixed(2)}°.
          </p>
          <div className="small-note">
            {report.points.length - missing} of {report.points.length} points had observations. Eye tracking stays on
            whatever the error; recalibrate first if your position or lighting was poor.
          </div>
        </>
      ) : null}
      <div className="panel-actions">
        <button type="button" className="button secondary" onClick={() => void run()}>
          Recalibrate
        </button>
        <button
          type="button"
          className="button primary big"
          onClick={onCalibrated}
          disabled={!report}
          data-testid="gaze-calibration-continue"
        >
          Continue to scored trials
        </button>
      </div>
    </section>
  );
}

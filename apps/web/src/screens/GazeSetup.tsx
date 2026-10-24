import { useEffect, useState } from "react";
import type { ScreenGeometry, Viewport } from "@meridian/analysis";

function currentViewport(): Viewport {
  return { width_px: window.innerWidth, height_px: window.innerHeight };
}

/**
 * Measures the physical area that the browser viewport occupies. There are no
 * default millimetres: the participant or researcher must measure. Fullscreen
 * is preferred so the viewport cannot change during trials; when the browser
 * cannot enter fullscreen, an explicit windowed measurement is required.
 */
export function GazeSetupScreen({
  onSubmit,
  busy,
  error
}: {
  onSubmit: (geometry: ScreenGeometry) => void;
  busy: boolean;
  error: string | null;
}) {
  const [viewport, setViewport] = useState<Viewport>(() => currentViewport());
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [widthMm, setWidthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [distanceMm, setDistanceMm] = useState("");
  const [measured, setMeasured] = useState(false);
  const [windowedConfirmed, setWindowedConfirmed] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setViewport(currentViewport());
      setFullscreen(Boolean(document.fullscreenElement));
      setMeasured(false);
      setWindowedConfirmed(false);
      setWidthMm("");
      setHeightMm("");
    };
    window.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", update);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", update);
    };
  }, []);

  const fullscreenAvailable = Boolean(document.documentElement.requestFullscreen);
  const valuesValid =
    Number(widthMm) > 0 && Number(heightMm) > 0 && Number(distanceMm) > 0 && Number.isFinite(Number(widthMm));
  const canSubmit = valuesValid && measured && (fullscreen || windowedConfirmed) && !busy;

  const requestFullscreen = async () => {
    setFullscreenError(null);
    try {
      await document.documentElement.requestFullscreen();
    } catch (fullscreenFailure) {
      setFullscreenError((fullscreenFailure as Error).message || "Fullscreen was refused.");
    }
  };

  return (
    <section className="panel medium" data-testid="gaze-setup-screen">
      <div className="eyebrow">Measured screen geometry</div>
      <h1>Set up the eye tracker</h1>
      <p className="lede">
        Eye-tracking error is reported in degrees, so the study needs the real size of the area showing this page and
        your viewing distance. These are measurements, not device defaults. Ask the researcher if you are unsure.
      </p>
      <div className="warning-box soft">
        <strong>Capture area: {viewport.width_px} × {viewport.height_px} px.</strong>{" "}
        {fullscreen
          ? "Fullscreen is active. Keep it active for the whole session."
          : "Enter fullscreen before measuring, or measure this exact browser viewport and confirm below."}
      </div>
      {!fullscreen ? (
        <div className="panel-actions">
          <button type="button" className="button secondary" onClick={() => void requestFullscreen()} data-testid="gaze-fullscreen">
            {fullscreenAvailable ? "Enter fullscreen" : "Fullscreen unavailable"}
          </button>
          {fullscreenError ? <span className="small-note">{fullscreenError}</span> : null}
        </div>
      ) : null}
      {error ? (
        <div className="warning-box" role="alert">
          {error}
        </div>
      ) : null}
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          const current = currentViewport();
          onSubmit({
            width_px: current.width_px,
            height_px: current.height_px,
            width_mm: Number(widthMm),
            height_mm: Number(heightMm),
            viewing_distance_mm: Number(distanceMm)
          });
        }}
      >
        <label className="field">
          <span>Visible width (mm)</span>
          <input
            type="number"
            min={50}
            max={5000}
            step={1}
            inputMode="numeric"
            value={widthMm}
            onChange={(event) => setWidthMm(event.target.value)}
            required
            data-testid="gaze-width-mm"
          />
        </label>
        <label className="field">
          <span>Visible height (mm)</span>
          <input
            type="number"
            min={50}
            max={5000}
            step={1}
            inputMode="numeric"
            value={heightMm}
            onChange={(event) => setHeightMm(event.target.value)}
            required
            data-testid="gaze-height-mm"
          />
        </label>
        <label className="field span-2">
          <span>Viewing distance from eyes to screen (mm)</span>
          <input
            type="number"
            min={100}
            max={3000}
            step={10}
            inputMode="numeric"
            value={distanceMm}
            onChange={(event) => setDistanceMm(event.target.value)}
            required
            data-testid="gaze-distance-mm"
          />
          <small>Measure from your eyes to the screen surface while sitting in the trial position.</small>
        </label>
        <label className="check-row span-2">
          <input
            type="checkbox"
            checked={measured}
            onChange={(event) => setMeasured(event.target.checked)}
            data-testid="gaze-measured-confirm"
          />
          <span>I measured the illuminated area showing this page, not the monitor bezel or a manufacturer spec.</span>
        </label>
        {!fullscreen ? (
          <label className="check-row span-2">
            <input
              type="checkbox"
              checked={windowedConfirmed}
              onChange={(event) => setWindowedConfirmed(event.target.checked)}
              data-testid="gaze-windowed-confirm"
            />
            <span>I measured this exact windowed viewport and will not resize the window during the trials.</span>
          </label>
        ) : null}
        <div className="panel-actions span-2">
          <span className="small-note">No millimetre values are inferred from the screen model or pixel size.</span>
          <button type="submit" className="button primary" disabled={!canSubmit} data-testid="gaze-setup-continue">
            {busy ? "Saving measurement..." : "Continue to demographics"}
          </button>
        </div>
      </form>
    </section>
  );
}

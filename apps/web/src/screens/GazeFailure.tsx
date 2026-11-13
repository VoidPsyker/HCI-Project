export function GazeFailureScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="panel medium" data-testid="gaze-failure-screen">
      <h1>Eye tracking is unavailable</h1>
      <p className="lede">
        The window size changed during eye tracking. You can still complete the searches and questionnaires.
      </p>
      <div className="panel-actions">
        <button type="button" className="button primary" onClick={onContinue} data-testid="gaze-failure-continue">
          Continue without eye tracking
        </button>
      </div>
    </section>
  );
}

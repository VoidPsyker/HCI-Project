import { useState } from "react";
import { reportedState } from "@meridian/scoring";
import { BASELINE_ITEMS, STATE_ITEMS } from "../content";
import type { CheckinPayload } from "../types";

function Scale({
  legend,
  value,
  onChange,
  min,
  max,
  low,
  high,
  testId
}: {
  legend: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  low: string;
  high: string;
  testId: string;
}) {
  return (
    <fieldset className="scale" data-testid={testId}>
      <legend>{legend}</legend>
      <div className="scale-row">
        <span className="scale-end">{low}</span>
        <div className="scale-options" role="radiogroup" aria-label={legend}>
          {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((number) => (
            <button
              key={number}
              type="button"
              role="radio"
              aria-checked={value === number}
              className={value === number ? "scale-button selected" : "scale-button"}
              onClick={() => onChange(number)}
              data-testid={`${testId}-${number}`}
            >
              {number}
            </button>
          ))}
        </div>
        <span className="scale-end">{high}</span>
      </div>
    </fieldset>
  );
}

export function CheckinScreen({
  phase,
  onSubmit,
  busy
}: {
  phase: "baseline" | "post_induction" | "post_trials";
  onSubmit: (payload: CheckinPayload) => Promise<void>;
  busy: boolean;
}) {
  const [valence, setValence] = useState(5);
  const [arousal, setArousal] = useState(5);
  const [states, setStates] = useState<Record<"happy" | "frustrated" | "confused" | "bored", number>>({
    happy: 3,
    frustrated: 2,
    confused: 2,
    bored: 2
  });
  const [distress, setDistress] = useState(1);
  const [fatigue, setFatigue] = useState(2);
  const stateValues = STATE_ITEMS.map((item) => states[item.id]);
  const dominant = reportedState({ ...states, valence, arousal });
  const intensity = Math.max(...stateValues);
  const distressHigh = distress > 6;
  const title =
    phase === "baseline"
      ? "How do you feel right now?"
      : phase === "post_induction"
        ? "Check in after the scenario"
        : "Check in after the three trials";
  const subtitle =
    phase === "baseline"
      ? "There are no right answers. This is the baseline before any menu practice."
      : phase === "post_induction"
        ? "We are checking the scenario, not you. Be honest even if the feeling was mild."
        : "Notice how the last three trials affected you. A neutral reset follows.";

  return (
    <section className="panel wide checkin-panel" data-testid="checkin-screen">
      <div className="eyebrow">{phase === "baseline" ? "Baseline" : phase === "post_induction" ? "Manipulation check" : "Fatigue check"}</div>
      <h1>{title}</h1>
      <p className="lede">{subtitle}</p>
      <div className="checkin-grid">
        <div className="checkin-column">
          {BASELINE_ITEMS.map((item) => (
            <Scale
              key={item.id}
              legend={item.label}
              value={item.id === "valence" ? valence : arousal}
              onChange={item.id === "valence" ? setValence : setArousal}
              min={item.min}
              max={item.max}
              low={item.low}
              high={item.high}
              testId={item.id}
            />
          ))}
        </div>
        <div className="checkin-column">
          {STATE_ITEMS.map((item) => (
            <Scale
              key={item.id}
              legend={item.label}
              value={states[item.id]}
              onChange={(value) => setStates((current) => ({ ...current, [item.id]: value }))}
              min={1}
              max={7}
              low="Not at all"
              high="Very much"
              testId={`state-${item.id}`}
            />
          ))}
        </div>
        <div className="checkin-column">
          <Scale
            legend="Distress / discomfort"
            value={distress}
            onChange={setDistress}
            min={0}
            max={10}
            low="None"
            high="Severe"
            testId="distress"
          />
          <Scale
            legend="Mental fatigue"
            value={fatigue}
            onChange={setFatigue}
            min={1}
            max={7}
            low="Fresh"
            high="Exhausted"
            testId="fatigue"
          />
          {distressHigh ? (
            <div className="warning-box" role="alert" data-testid="distress-warning">
              <strong>Distress above 6/10.</strong> The session will stop immediately and go to the debrief. The
              researcher will check on you.
            </div>
          ) : null}
        </div>
      </div>
      <div className="panel-actions">
        <span className="small-note">Your answer is logged with the check-in time and block.</span>
        <button
          type="button"
          className={distressHigh ? "button danger" : "button primary"}
          disabled={busy}
          onClick={() =>
            void onSubmit({
              phase,
              valence,
              arousal,
              happy: states.happy,
              frustrated: states.frustrated,
              confused: states.confused,
              bored: states.bored,
              distress,
              fatigue,
              dominant_state: dominant,
              intensity
            })
          }
          data-testid="checkin-continue"
        >
          {distressHigh ? "Stop and go to debrief" : phase === "post_induction" ? "Continue to trials" : "Continue"}
        </button>
      </div>
    </section>
  );
}

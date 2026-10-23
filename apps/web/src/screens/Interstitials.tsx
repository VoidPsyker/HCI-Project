import { useEffect, useState } from "react";
import { STATE_COPY } from "../content";
import type { StateLabel } from "@meridian/scoring";

export function InstructionsScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="panel wide" data-testid="instructions-screen">
      <div className="eyebrow">How the session works</div>
      <h1>Four short scenarios, twelve searches</h1>
      <p className="lede">
        You will practice all six menu layouts once, then complete four blocks. Each block starts with a short
        scenario, a check-in, and three search trials using three different menus. Every menu appears exactly twice.
      </p>
      <div className="instruction-columns">
        <div className="instruction-card">
          <span className="instruction-number">1</span>
          <h3>Think aloud</h3>
          <p>Say what you are looking for and what you notice. The researcher may prompt you but will not help you find products.</p>
        </div>
        <div className="instruction-card">
          <span className="instruction-number">2</span>
          <h3>Search naturally</h3>
          <p>Use the menu as you would in a real shop. There is no time pressure beyond the 120-second trial limit.</p>
        </div>
        <div className="instruction-card">
          <span className="instruction-number">3</span>
          <h3>Check in honestly</h3>
          <p>After each scenario, rate how you feel. If distress is above 6/10, the session stops immediately.</p>
        </div>
        <div className="instruction-card">
          <span className="instruction-number">4</span>
          <h3>Stop anytime</h3>
          <p>The visible Stop control is always available. You do not need to give a reason.</p>
        </div>
      </div>
      <div className="procedure-strip">
        <span>Consent</span>
        <span>Practice ×6</span>
        <span>4 × (scenario → check-in → 3 trials)</span>
        <span>Questionnaires</span>
        <span>Debrief</span>
      </div>
      <div className="panel-actions">
        <span className="small-note">Estimated total: 45–75 minutes. Maximum 100 minutes.</span>
        <button type="button" className="button primary big" onClick={onStart} data-testid="start-practice">
          Start the six practice trials
        </button>
      </div>
    </section>
  );
}

export function BlockIntroScreen({
  blockIndex,
  state,
  onStart
}: {
  blockIndex: number;
  state: Exclude<StateLabel, "mixed">;
  onStart: () => void;
}) {
  const copy = STATE_COPY[state];
  const titles: Record<Exclude<StateLabel, "mixed">, string> = {
    happy: "A pleasant browsing moment",
    frustrated: "The search that will not cooperate",
    confused: "Which category is right?",
    bored: "The very repetitive catalogue check"
  };
  return (
    <section className="panel medium block-intro" data-testid="block-intro">
      <div className="eyebrow" style={{ color: copy.colour }}>
        Block {blockIndex + 1} of 4
      </div>
      <h1>{titles[state]}</h1>
      <p className="lede">
        The next scenario lasts up to 90 seconds. It is designed to create a mild version of one everyday browsing
        feeling. It is not a test of you.
      </p>
      <div className="block-timeline">
        <div>
          <strong>Scenario</strong>
          <span>up to 90 s</span>
        </div>
        <div>
          <strong>Check-in</strong>
          <span>about 1 min</span>
        </div>
        <div>
          <strong>Three searches</strong>
          <span>up to 6 min</span>
        </div>
        <div>
          <strong>Neutral reset</strong>
          <span>60 s</span>
        </div>
      </div>
      <div className="warning-box soft">
        If you feel uncomfortable at any point, use the Stop control or the stop button inside the scenario. The
        session will go straight to the debrief.
      </div>
      <div className="panel-actions">
        <span className="small-note">The check-in after the scenario is the manipulation check.</span>
        <button type="button" className="button primary big" onClick={onStart} data-testid="start-induction">
          Start scenario
        </button>
      </div>
    </section>
  );
}

export function NeutralResetScreen({ fastMode, onContinue }: { fastMode: boolean; onContinue: () => void }) {
  const duration = fastMode ? 1_000 : 60_000;
  const [remaining, setRemaining] = useState(duration);
  useEffect(() => {
    const start = performance.now();
    const interval = setInterval(() => {
      setRemaining(Math.max(0, duration - (performance.now() - start)));
    }, 200);
    return () => clearInterval(interval);
  }, [duration]);
  const done = remaining <= 0;
  return (
    <section className="neutral-layout" data-testid="neutral-reset">
      <div className="neutral-card">
        <div className="eyebrow">Neutral reset</div>
        <h1>Look away. Breathe slowly.</h1>
        <p>Let the scenario fade. Roll your shoulders, look at something in the room, and wait for the timer.</p>
        <div className="breath-orb" aria-hidden="true">
          <div className="breath-orb-inner">{done ? "Ready" : Math.ceil(remaining / 1000)}</div>
        </div>
        <button type="button" className="button primary" disabled={!done} onClick={onContinue} data-testid="reset-continue">
          {done ? "Continue to the next block" : "Reset in progress…"}
        </button>
      </div>
    </section>
  );
}

export function CompleteScreen({ code, aborted }: { code: string | null; aborted: boolean }) {
  return (
    <section className="panel narrow complete-screen" data-testid="complete-screen">
      <div className="complete-mark" aria-hidden="true">
        ✓
      </div>
      <div className="eyebrow">{aborted ? "Session closed" : "Session complete"}</div>
      <h1>{aborted ? "Thank you for taking part" : "Thank you — you are finished"}</h1>
      <p className="lede">
        {aborted
          ? "The session has been stopped. The researcher has the debrief record and will check on you."
          : "Your responses and interaction log have been saved on the research computer. The researcher will explain the next steps."}
      </p>
      {code && !aborted ? (
        <div className="completion-code">
          <span>Completion code</span>
          <strong>{code}</strong>
        </div>
      ) : null}
      <p className="small-note">You may close this window. No further data will be collected.</p>
    </section>
  );
}

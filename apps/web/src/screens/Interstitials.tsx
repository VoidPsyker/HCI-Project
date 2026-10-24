import { useEffect, useState } from "react";
import { INDUCTIONS, INSTRUCTIONS, MEDIA, STATE_COPY, type InductionState } from "../content";
import { LocalClip } from "../components/LocalClip";

export function InstructionsScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="panel wide" data-testid="instructions-screen">
      <div className="eyebrow">{INSTRUCTIONS.eyebrow}</div>
      <h1>{INSTRUCTIONS.title}</h1>
      <p className="lede">{INSTRUCTIONS.lede}</p>
      <div className="instruction-columns">
        {INSTRUCTIONS.cards.map((card, index) => (
          <div key={card.title} className="instruction-card">
            <span className="instruction-number">{index + 1}</span>
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </div>
        ))}
      </div>
      <div className="procedure-strip">
        {INSTRUCTIONS.procedure.map((step) => (
          <span key={step}>{step}</span>
        ))}
      </div>
      <div className="panel-actions">
        <span className="small-note">{INSTRUCTIONS.estimate}</span>
        <button type="button" className="button primary big" onClick={onStart} data-testid="start-practice">
          {INSTRUCTIONS.start}
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
  state: InductionState;
  onStart: () => void;
}) {
  const copy = STATE_COPY[state];
  return (
    <section className="panel medium block-intro" data-testid="block-intro">
      <div className="eyebrow" style={{ color: copy.colour }}>
        Block {blockIndex + 1} of 4
      </div>
      <h1>{INDUCTIONS[state].title}</h1>
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

export function NeutralResetScreen({
  fastMode,
  state,
  onContinue
}: {
  fastMode: boolean;
  state: InductionState;
  onContinue: () => void;
}) {
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
        <p className="warning-box soft" data-testid="block-debrief">
          {INDUCTIONS[state].blockDebrief}
        </p>
        <h1>Look away. Breathe slowly.</h1>
        <p>Let the scenario fade. Roll your shoulders, look at something in the room, and wait for the timer.</p>
        <div className="neutral-media">
          <LocalClip slot={MEDIA.neutral_reset_clip} testId="neutral-clip" />
        </div>
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

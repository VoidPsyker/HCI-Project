import { useEffect, useRef, useState } from "react";
import type { StateLabel } from "@meridian/scoring";
import type { EventLogger } from "../logger";
import { INDUCTIONS, STATE_COPY } from "../content";

type InductionState = Exclude<StateLabel, "mixed">;

export function InductionScreen({
  state,
  blockId,
  fastMode,
  logger,
  onComplete,
  onDistressStop
}: {
  state: InductionState;
  blockId: string;
  fastMode: boolean;
  logger: EventLogger;
  onComplete: (durationMs: number) => void;
  onDistressStop: () => void;
}) {
  const definition = INDUCTIONS[state];
  const duration = fastMode ? 1_000 : definition.durationSeconds * 1000;
  const [remaining, setRemaining] = useState(duration);
  const [done, setDone] = useState(false);
  const [query, setQuery] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [confirmedRows, setConfirmedRows] = useState<Set<number>>(new Set());
  const startedRef = useRef(0);
  const endedRef = useRef(false);
  const logStartRef = useRef(false);

  useEffect(() => {
    if (!logStartRef.current) {
      logStartRef.current = true;
      startedRef.current = performance.now();
      logger.log({
        event_type: "induction_start",
        block_id: blockId,
        state_label: state,
        meta: { script: state, max_seconds: definition.durationSeconds, fast_mode: fastMode }
      });
    }
    const interval = setInterval(() => {
      const elapsed = performance.now() - startedRef.current;
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 0) setDone(true);
    }, 200);
    return () => clearInterval(interval);
  }, [blockId, definition.durationSeconds, duration, fastMode, logger, state]);

  useEffect(() => {
    if (!done || endedRef.current) return;
    endedRef.current = true;
    logger.log({
      event_type: "induction_end",
      block_id: blockId,
      state_label: state,
      meta: {
        completed: true,
        duration_ms: Math.round(performance.now() - startedRef.current),
        distress_stop: false
      }
    });
  }, [blockId, done, logger, state]);

  const distressStop = () => {
    if (!endedRef.current) {
      endedRef.current = true;
      logger.log({
        event_type: "induction_end",
        block_id: blockId,
        state_label: state,
        meta: {
          completed: false,
          duration_ms: Math.round(performance.now() - startedRef.current),
          distress_stop: true
        }
      });
    }
    onDistressStop();
  };

  const continueAfter = () => {
    if (!endedRef.current) {
      endedRef.current = true;
      logger.log({
        event_type: "induction_end",
        block_id: blockId,
        state_label: state,
        meta: { completed: true, duration_ms: Math.round(performance.now() - startedRef.current), distress_stop: false }
      });
    }
    onComplete(Math.round(performance.now() - startedRef.current));
  };

  const seconds = Math.ceil(remaining / 1000);
  const progress = 1 - remaining / duration;
  const colour = STATE_COPY[state].colour;

  return (
    <section className="induction-layout" data-testid="induction-screen" data-state={state}>
      <div className="induction-head" style={{ borderColor: colour }}>
        <div>
          <div className="eyebrow" style={{ color: colour }}>
            Emotion induction · {STATE_COPY[state].label}
          </div>
          <h1>{definition.title}</h1>
          <p>{definition.intro}</p>
        </div>
        <div className="induction-timer" aria-live="polite">
          <span className="timer-value">{seconds}</span>
          <span className="timer-label">seconds</span>
        </div>
      </div>
      <div className="induction-progress" aria-hidden="true">
        <div className="induction-progress-fill" style={{ width: `${Math.min(100, progress * 100)}%`, background: colour }} />
      </div>

      <div className="induction-task" style={{ borderColor: colour }}>
        <div className="task-banner">{definition.task}</div>
        {state === "happy" ? (
          <div className="happy-media">
            <img src="/assets/happy-placeholder.svg" alt="Local abstract sunrise placeholder for the pleasant clip" />
            <p className="small-note">Local placeholder. Replace with the approved clip before data collection. No network requests.</p>
          </div>
        ) : null}

        {state === "frustrated" ? (
          <div className="frustration-task">
            <label className="field">
              <span>Search the catalogue</span>
              <div className="search-row">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. 42 mm automatic dive watch blue dial titanium"
                  autoComplete="off"
                  maxLength={120}
                />
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    const next = attempts + 1;
                    setAttempts(next);
                    logger.log({
                      event_type: "search_attempt",
                      block_id: blockId,
                      state_label: state,
                      meta: { attempt: next, query_length: query.length, results: 0 }
                    });
                  }}
                >
                  Search
                </button>
              </div>
            </label>
            {attempts > 0 ? (
              <div className="search-result" role="status">
                <strong>No exact match.</strong> Try a different term. The index is slow to update.
                {attempts >= 3 ? <p>This search index is intentionally unreliable in the pilot. You can wait for the timer.</p> : null}
              </div>
            ) : null}
            <p className="small-note">Attempts: {attempts}/3. The search is designed to be mildly annoying, not impossible.</p>
          </div>
        ) : null}

        {state === "confused" ? (
          <div className="confusion-task">
            <p className="task-copy">Which single category is closest to the target?</p>
            <div className="confusion-grid">
              {([
                ["formal", "Formal / evening", "Dress watches with leather straps"],
                ["outdoor", "Outdoor / active", "Rugged watches for trail and water"],
                ["everyday", "Everyday / smart", "Versatile watches for work and weekends"],
                ["gift", "Gift / statement", "Distinctive watches for special occasions"]
              ] as const).map(([id, label, detail]) => (
                <button
                  key={id}
                  type="button"
                  className={selectedCategory === id ? "confusion-card selected" : "confusion-card"}
                  onClick={() => {
                    setSelectedCategory(id);
                    logger.log({
                      event_type: "node_click",
                      block_id: blockId,
                      state_label: state,
                      level: 0,
                      element_id: `induction:confused:${id}`,
                      element_label: label,
                      meta: { induction: "confused" }
                    });
                  }}
                >
                  <span>{label}</span>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
            <p className="small-note">
              {selectedCategory ? "Selection recorded. No feedback is given in this pilot; you may change your mind." : "No option is clearly correct. That is part of the task."}
            </p>
          </div>
        ) : null}

        {state === "bored" ? (
          <div className="bored-task">
            <p className="task-copy">Confirm the listed price for each strap. The same value repeats.</p>
            <div className="bored-list">
              {Array.from({ length: 30 }, (_, index) => (
                <div key={index} className="bored-row">
                  <span>Strap blank #{String(index + 1).padStart(2, "0")}</span>
                  <span className="bored-price">£240</span>
                  <button
                    type="button"
                    className={confirmedRows.has(index) ? "button tiny confirmed" : "button tiny"}
                    disabled={confirmedRows.has(index)}
                    onClick={() => {
                      setConfirmedRows((current) => new Set(current).add(index));
                      logger.log({
                        event_type: "node_click",
                        block_id: blockId,
                        state_label: state,
                        level: 0,
                        element_id: `induction:bored:${index + 1}`,
                        element_label: `Strap blank ${index + 1}`,
                        meta: { induction: "bored", row: index + 1 }
                      });
                    }}
                  >
                    {confirmedRows.has(index) ? "Confirmed" : "Confirm £240"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="induction-actions">
        <button type="button" className="button danger-ghost" onClick={distressStop} data-testid="induction-stop">
          I feel uncomfortable — stop and debrief
        </button>
        <div className="induction-actions-right">
          <span className="small-note">{done ? "The scenario is over. Continue when ready." : "Continue unlocks when the timer ends."}</span>
          <button type="button" className="button primary" disabled={!done} onClick={continueAfter} data-testid="induction-continue">
            Continue to check-in
          </button>
        </div>
      </div>
    </section>
  );
}

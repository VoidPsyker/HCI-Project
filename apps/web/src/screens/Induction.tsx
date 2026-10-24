import { useEffect, useRef, useState } from "react";
import type { EventLogger } from "../logger";
import { INDUCTIONS, MEDIA, STATE_COPY, type InductionState } from "../content";
import { LocalClip } from "../components/LocalClip";

const FILTER_SIZES = ["Any", "38 mm", "40 mm", "42 mm", "44 mm"];

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
  const [sizeFilter, setSizeFilter] = useState(FILTER_SIZES[0]!);
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

  /** Logs the induction_end for a timed or early finish; a stop is logged by the runner, which owns every stop path. */
  const end = (meta: { completed: boolean; distress_stop: false; early_exit?: boolean }) => {
    if (endedRef.current) return;
    endedRef.current = true;
    logger.log({
      event_type: "induction_end",
      block_id: blockId,
      state_label: state,
      meta: { ...meta, duration_ms: Math.round(performance.now() - startedRef.current) }
    });
  };

  useEffect(() => {
    if (done) end({ completed: true, distress_stop: false });
    // `end` is idempotent; the timer reaching zero is the only trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const distressStop = () => {
    endedRef.current = true;
    onDistressStop();
  };

  const continueAfter = (earlyExit = false) => {
    end(earlyExit ? { completed: false, distress_stop: false, early_exit: true } : { completed: true, distress_stop: false });
    onComplete(Math.round(performance.now() - startedRef.current));
  };

  const frustrated = INDUCTIONS.frustrated;
  const searchesLeft = attempts < frustrated.maxAttempts;

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
            <LocalClip slot={MEDIA.happy_clip} testId="happy-clip" />
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
                <select
                  aria-label="Case size filter"
                  value={sizeFilter}
                  onChange={(event) => setSizeFilter(event.target.value)}
                  data-testid="induction-filter"
                >
                  {FILTER_SIZES.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button primary"
                  disabled={!searchesLeft}
                  data-testid="induction-search"
                  onClick={() => {
                    const next = attempts + 1;
                    setAttempts(next);
                    logger.log({
                      event_type: "search_attempt",
                      block_id: blockId,
                      state_label: state,
                      meta: { induction: "frustrated", attempt: next, query_length: query.length, filter: sizeFilter, results: 0, filter_reset: true }
                    });
                    setSizeFilter(FILTER_SIZES[0]!);
                  }}
                >
                  Search
                </button>
              </div>
            </label>
            {attempts > 0 ? (
              <div className="search-result" role="status" data-testid="induction-search-result">
                <strong>{frustrated.noResults}</strong>
                {!searchesLeft ? <p>{frustrated.afterLastAttempt}</p> : null}
              </div>
            ) : null}
            <p className="small-note">
              Attempts: {attempts}/{frustrated.maxAttempts}.
            </p>
          </div>
        ) : null}

        {state === "confused" ? (
          <div className="confusion-task">
            <p className="task-copy">Which single category is closest to the target?</p>
            <div className="confusion-grid">
              {INDUCTIONS.confused.categories.map(({ id, label, detail }) => (
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
              {Array.from({ length: INDUCTIONS.bored.items }, (_, index) => (
                <div key={index} className="bored-row">
                  <span>Strap blank #{String(index + 1).padStart(2, "0")}</span>
                  <span className="bored-price">{INDUCTIONS.bored.price}</span>
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
                    {confirmedRows.has(index) ? "Confirmed" : `Confirm ${INDUCTIONS.bored.price}`}
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
          {state === "bored" && !done ? (
            <button type="button" className="button secondary" onClick={() => continueAfter(true)} data-testid="induction-early-exit">
              {INDUCTIONS.bored.earlyExit}
            </button>
          ) : null}
          <button type="button" className="button primary" disabled={!done} onClick={() => continueAfter()} data-testid="induction-continue">
            Continue to check-in
          </button>
        </div>
      </div>
    </section>
  );
}

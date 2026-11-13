import { useEffect, useRef, useState } from "react";
import type { EventLogger } from "../logger";
import { INDUCTIONS, MEDIA, STATE_COPY, type InductionState } from "../content";
import { LocalClip } from "../components/LocalClip";
import { StoreSearches, frustrationTasks, type StoreSearchTask } from "./StoreSearch";

/** Frustration and confusion run real searches in a plain shop; happy and bored stay timed. */
function storeSearchesFor(state: InductionState, blockId: string): StoreSearchTask[] | null {
  if (state === "frustrated") return frustrationTasks(blockId, INDUCTIONS.frustrated.searches);
  if (state === "confused") return [{ id: "confused-absent-watch", description: INDUCTIONS.confused.task, targetId: null }];
  return null;
}

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
  const [searches] = useState(() => storeSearchesFor(state, blockId));
  const searchMs = fastMode ? 1_000 : (state === "confused" ? INDUCTIONS.confused.searchSeconds : INDUCTIONS.frustrated.searchSeconds) * 1000;
  const [remaining, setRemaining] = useState(duration);
  const [done, setDone] = useState(false);
  const [confirmedRows, setConfirmedRows] = useState<Set<number>>(new Set());
  const startedRef = useRef(0);
  const advancedRef = useRef(false);
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
        meta: {
          script: state,
          max_seconds: definition.durationSeconds,
          fast_mode: fastMode,
          ...(searches ? { search_task_ids: searches.map((task) => task.id) } : {})
        }
      });
    }
    // Shop searches keep their own per-search countdown and end the scenario themselves.
    if (searches) return;
    const interval = setInterval(() => {
      const elapsed = performance.now() - startedRef.current;
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 0) setDone(true);
    }, 200);
    return () => clearInterval(interval);
  }, [blockId, definition.durationSeconds, duration, fastMode, logger, searches, state]);

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
    if (advancedRef.current) return;
    advancedRef.current = true;
    endedRef.current = true;
    onDistressStop();
  };

  const continueAfter = (earlyExit = false) => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    end(earlyExit ? { completed: false, distress_stop: false, early_exit: true } : { completed: true, distress_stop: false });
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
        {searches ? null : (
          <div className="induction-timer" aria-live="polite">
            <span className="timer-value">{seconds}</span>
            <span className="timer-label">seconds</span>
          </div>
        )}
      </div>
      {searches ? null : (
        <div className="induction-progress" aria-hidden="true">
          <div className="induction-progress-fill" style={{ width: `${Math.min(100, progress * 100)}%`, background: colour }} />
        </div>
      )}

      <div className="induction-task" style={{ borderColor: colour }}>
        {"task" in definition && !searches ? <div className="task-banner">{definition.task}</div> : null}
        {searches ? (
          <StoreSearches state={state} blockId={blockId} tasks={searches} searchMs={searchMs} logger={logger} onFinished={() => setDone(true)} />
        ) : null}
        {state === "happy" ? (
          <div className="happy-media">
            <LocalClip slot={MEDIA.happy_clip} testId="happy-clip" />
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
          <span className="small-note">
            {done ? "The scenario is over. Continue when ready." : searches ? "Continue unlocks when the searches end." : "Continue unlocks when the timer ends."}
          </span>
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

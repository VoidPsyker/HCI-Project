import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { EVENT_TYPES, type EventType, type StateLabel } from "@meridian/scoring";
import { NODE_BY_ID, type ColourMapping, type MenuId, type TaxonomyNode } from "@meridian/taxonomy";
import { SESSION_TIMING } from "../content";
import type { EventLogger } from "../logger";
import { MENU_NAMES, ProductDetail } from "../components/MenuChrome";
import type { GazeTrialHandle } from "../gaze/GazeController";
import { MenuA } from "../menus/MenuA";
import { MenuB } from "../menus/MenuB";
import { MenuC } from "../menus/MenuC";
import { MenuD } from "../menus/MenuD";
import { MenuE } from "../menus/MenuE";
import { MenuF } from "../menus/MenuF";

const POINTER_SAMPLE_INTERVAL_MS = 100;
const MENUS = { A: MenuA, B: MenuB, C: MenuC, D: MenuD, E: MenuE, F: MenuF };

export interface TrialInstruction {
  trialId: string;
  blockId: string;
  menuId: MenuId;
  taskId: string;
  targetId: string;
  taskDescription: string;
  stateLabel: StateLabel;
  practice: boolean;
  trialIndex: number;
  /** Searches in this block, from the session's own design. */
  trialCount: number;
}

type Step = "instruction" | "menu" | "product" | "wrong_product" | "failed" | "timeout";

export function TrialRunner({
  spec,
  colourMapping,
  logger,
  fastMode,
  gaze,
  onComplete
}: {
  spec: TrialInstruction;
  colourMapping: ColourMapping;
  logger: EventLogger;
  fastMode: boolean;
  gaze?: GazeTrialHandle;
  onComplete: (result: { success: boolean }) => void;
}) {
  const [step, setStep] = useState<Step>("instruction");
  const [wrongProduct, setWrongProduct] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [starting, setStarting] = useState(false);
  const [gazeError, setGazeError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const dialogRef = useDialogFocus(step !== "instruction" && step !== "menu", undefined, step);
  const gazeStartedRef = useRef(false);
  const finishedRef = useRef(false);
  const completedRef = useRef(false);
  const lastPointerSample = useRef(-Infinity);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stuckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<Step>("instruction");
  stepRef.current = step;
  const trialLimitSeconds = spec.practice ? SESSION_TIMING.practiceTrialSeconds : SESSION_TIMING.scoredTrialSeconds;
  const Menu = MENUS[spec.menuId];
  const targetLabel = useMemo(() => NODE_BY_ID.get(spec.targetId)?.label ?? spec.targetId, [spec.targetId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (gazeStartedRef.current) {
        gaze?.endActiveTrial?.();
        gazeStartedRef.current = false;
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (stuckRef.current) clearTimeout(stuckRef.current);
    };
  }, []);

  useEffect(() => {
    if (!gaze || step !== "menu" || !gazeStartedRef.current) return;
    let frame = 0;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const capture = () => {
      const root = stageRef.current;
      if (root) gaze.captureAois(root, performance.now());
    };
    const schedule = () => {
      if (typeof requestAnimationFrame !== "function") {
        capture();
        return;
      }
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(capture);
    };
    schedule();
    timers.push(setTimeout(capture, 80), setTimeout(capture, 350));
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-expanded", "data-state", "hidden"]
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [gaze, step]);

  const log = (type: string, payload: Record<string, unknown> = {}) => {
    if (!EVENT_TYPES.includes(type as EventType)) return;
    logger.log({
      event_type: type as EventType,
      menu_id: spec.menuId,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      state_label: spec.stateLabel,
      ...payload
    });
  };

  const capturePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (finishedRef.current || event.pointerType !== "mouse") return;
    if (step !== "menu" && step !== "wrong_product") return;
    const now = performance.now();
    if (now - lastPointerSample.current < POINTER_SAMPLE_INTERVAL_MS) return;
    lastPointerSample.current = now;
    log("pointer_move", { x: event.clientX, y: event.clientY, input_type: "mouse" });
  };

  const capturePointerClick = (event: MouseEvent<HTMLElement>) => {
    if (finishedRef.current || event.detail === 0) return;
    if (step !== "menu" && step !== "wrong_product") return;
    const pointerType = (event.nativeEvent as globalThis.PointerEvent).pointerType;
    log("pointer_click", { x: event.clientX, y: event.clientY, input_type: pointerType === "touch" ? "touch" : "mouse" });
  };

  useEffect(() => {
    if (step !== "wrong_product") return;
    const onBack = () => {
      if (finishedRef.current || stepRef.current !== "wrong_product") return;
      log("back", { meta: { from: "product", correct: false, source: "browser" } });
      setStep("menu");
      setWrongProduct(null);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [step]);

  const finish = (success: boolean, terminal: "product" | "give_up" | "timeout") => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (stuckRef.current) clearTimeout(stuckRef.current);
    const endMs = performance.now();
    if (gaze && gazeStartedRef.current) {
      try {
        gaze.endTrial({ trial_id: spec.trialId, end_ms: endMs });
      } catch (endError) {
        setGazeError((endError as Error).message);
        gaze.endActiveTrial?.();
      } finally {
        gazeStartedRef.current = false;
      }
    }
    log("trial_end", {
      elapsed_ms: Math.round(endMs - startedAtRef.current),
      meta: {
        practice: spec.practice,
        trial_index: spec.trialIndex,
        success,
        terminal,
        stuck_60s: stuck,
        menu_label: MENU_NAMES[spec.menuId]
      }
    });
    logger.finishTrial();
    setCorrect(success);
  };

  const startedAtRef = useRef(0);

  const start = async () => {
    if (startingRef.current || finishedRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setGazeError(null);
    let startMs = performance.now();
    try {
      if (gaze) {
        const result = await gaze.beginTrial({
          trial_id: spec.trialId,
          menu_id: spec.menuId,
          target_product_id: spec.targetId
        });
        if (!mountedRef.current) {
          gaze.endTrial({ trial_id: spec.trialId, end_ms: performance.now() });
          return;
        }
        startMs = result.start_ms;
        gazeStartedRef.current = true;
      }
    } catch (gazeStartError) {
      startingRef.current = false;
      if (!mountedRef.current) return;
      setGazeError((gazeStartError as Error).message);
      setStarting(false);
      return;
    }
    startedAtRef.current = startMs;
    logger.beginTrial({
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      condition: "static"
    });
    log("trial_start", { elapsed_ms: 0, meta: { practice: spec.practice, trial_index: spec.trialIndex, limit_ms: trialLimitSeconds * 1000, protocol_version: SESSION_TIMING.protocolVersion, viewport_width: window.innerWidth, viewport_height: window.innerHeight } });
    setStep("menu");
    startingRef.current = false;
    setStarting(false);
    const timeoutMs = trialLimitSeconds * 1000;
    timeoutRef.current = setTimeout(() => {
      if (finishedRef.current) return;
      log("timeout", { meta: { practice: spec.practice, limit_ms: timeoutMs } });
      finish(false, "timeout");
      setStep("timeout");
    }, timeoutMs);
    const stuckMs = fastMode ? 5_000 : 60_000;
    stuckRef.current = setTimeout(() => setStuck(true), stuckMs);
  };

  const handleLeaf = (leaf: TaxonomyNode, inputType?: "keyboard" | "mouse") => {
    if (finishedRef.current) return;
    const resolvedInputType =
      inputType ??
      (typeof window !== "undefined" && window.event && "detail" in window.event && (window.event as UIEvent).detail === 0
        ? "keyboard"
        : "mouse");
    log("leaf_select", {
      level: 3,
      element_id: leaf.id,
      element_label: leaf.label,
      parent_id: leaf.parentId,
      input_type: resolvedInputType,
      meta: { correct: leaf.productId === spec.targetId }
    });
    if (leaf.productId === spec.targetId) {
      log("product_view", {
        level: 3,
        element_id: leaf.id,
        element_label: leaf.label,
        input_type: resolvedInputType,
        meta: { correct: true, product_id: leaf.productId }
      });
      finish(true, "product");
      setStep("product");
      return;
    }
    log("product_view", {
      level: 3,
      element_id: leaf.id,
      element_label: leaf.label,
      input_type: resolvedInputType,
      meta: { correct: false, product_id: leaf.productId }
    });
    setWrongProduct(leaf.productId ?? null);
    setStep("wrong_product");
  };

  const giveUp = () => {
    if (finishedRef.current) return;
    log("give_up", { meta: { practice: spec.practice, stuck_60s: stuck } });
    finish(false, "give_up");
    setStep("failed");
  };

  const complete = (success: boolean) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete({ success });
  };

  if (step === "instruction") {
    return (
      <section className="trial-intro" data-testid="trial-intro">
        <div className="intro-card">
          <div className="eyebrow">{spec.practice ? "Practice trial" : `Trial ${spec.trialIndex + 1} of ${spec.trialCount}`} · Menu {spec.menuId}</div>
          <h2>{spec.practice ? "Try the menu once" : "Find this watch"}</h2>
          <p className="task-text">{spec.taskDescription}</p>
          <div className="intro-meta">
            <span>{MENU_NAMES[spec.menuId]}</span>
            <span>{spec.practice ? "Not scored" : "Scored"}</span>
            <span>Up to {trialLimitSeconds} seconds</span>
          </div>
          <p className="instruction-note">
            Start when you are ready. The task stays hidden while you search. If you cannot find the product, use the
            visible “I can’t find it” button rather than guessing.
          </p>
          {gazeError ? (
            <div className="warning-box" role="alert">
              Eye tracking could not start: {gazeError}. The scored trial has not started. Ask the researcher before
              retrying.
            </div>
          ) : null}
          <button type="button" className="button primary big" onClick={() => void start()} disabled={starting} data-testid="start-trial">
            {starting ? "Starting eye tracker..." : "Start trial"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="trial-stage"
      data-testid="trial-stage"
      data-trial-id={spec.trialId}
      ref={stageRef}
      onPointerMoveCapture={capturePointerMove}
      onClickCapture={capturePointerClick}
    >
      {gazeError ? (
        <div className="warning-box" role="alert">
          Eye-tracking warning: {gazeError}
        </div>
      ) : null}
      <div className={step === "product" || step === "wrong_product" || step === "failed" || step === "timeout" ? "trial-menu-wrap trial-menu-dim" : "trial-menu-wrap"}>
        <Menu
          menuId={spec.menuId}
          colourMapping={colourMapping}
          onLeafSelect={handleLeaf}
          onEvent={log}
          disabled={step !== "menu"}
        />
        <div className="trial-toolbar">
          <div className="trial-task">
            <span className="task-label">Find</span>
            <span>{spec.taskDescription}</span>
          </div>
          <div className="trial-tools">
            {stuck ? <span className="stuck-note">Still searching? The researcher will note this.</span> : null}
            <button
              type="button"
              className="button quiet"
              onClick={giveUp}
              disabled={step !== "menu"}
              data-testid="give-up"
            >
              I can’t find it
            </button>
          </div>
        </div>
      </div>

      {step === "product" && correct ? (
        <div ref={dialogRef} tabIndex={-1} className="product-overlay" role="dialog" aria-modal="true" aria-label="Product detail">
          <ProductDetail
            productId={spec.targetId}
            onBack={() => undefined}
            allowBack={false}
            onNext={() => complete(true)}
            nextLabel={spec.practice ? "Next practice" : "Next trial"}
          />
        </div>
      ) : null}

      {step === "wrong_product" && wrongProduct ? (
        <div ref={dialogRef} tabIndex={-1} className="product-overlay" role="dialog" aria-modal="true" aria-label="Wrong product">
          <ProductDetail
            productId={wrongProduct}
            correct={false}
            onBack={() => {
              log("back", { meta: { from: "product", correct: false } });
              setStep("menu");
              setWrongProduct(null);
            }}
            nextLabel=""
          />
        </div>
      ) : null}

      {step === "failed" ? (
        <div ref={dialogRef} tabIndex={-1} className="product-overlay" role="dialog" aria-modal="true" aria-label="Trial ended">
          <div className="result-card">
            <div className="eyebrow">Trial ended</div>
            <h2>You chose to stop searching.</h2>
            <p>
              The target was <strong>{targetLabel}</strong>. In the main trials this is recorded as a give-up; it is
              better than guessing.
            </p>
            <button type="button" className="button primary" onClick={() => complete(false)}>
              {spec.practice ? "Next practice" : "Next trial"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "timeout" ? (
        <div ref={dialogRef} tabIndex={-1} className="product-overlay" role="dialog" aria-modal="true" aria-label="Trial timed out">
          <div className="result-card">
            <div className="eyebrow">Time limit</div>
            <h2>The {trialLimitSeconds}-second limit was reached.</h2>
            <p>
              The target was <strong>{targetLabel}</strong>. The trial is recorded as a timeout. Take a breath and
              continue when ready.
            </p>
            <button type="button" className="button primary" onClick={() => complete(false)}>
              {spec.practice ? "Next practice" : "Next trial"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { EVENT_TYPES, type EventType, type StateLabel } from "@meridian/scoring";
import { NODE_BY_ID, type ColourMapping, type MenuId, type TaxonomyNode } from "@meridian/taxonomy";
import type { EventLogger } from "../logger";
import { MENU_NAMES, ProductDetail } from "../components/MenuChrome";
import { MenuA } from "../menus/MenuA";
import { MenuB } from "../menus/MenuB";
import { MenuC } from "../menus/MenuC";
import { MenuD } from "../menus/MenuD";
import { MenuE } from "../menus/MenuE";
import { MenuF } from "../menus/MenuF";

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
}

type Step = "instruction" | "menu" | "product" | "wrong_product" | "failed" | "timeout";

export function TrialRunner({
  spec,
  colourMapping,
  logger,
  fastMode,
  onComplete
}: {
  spec: TrialInstruction;
  colourMapping: ColourMapping;
  logger: EventLogger;
  fastMode: boolean;
  onComplete: (result: { success: boolean }) => void;
}) {
  const [step, setStep] = useState<Step>("instruction");
  const [wrongProduct, setWrongProduct] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [correct, setCorrect] = useState(false);
  const finishedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stuckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<Step>("instruction");
  stepRef.current = step;
  const Menu = MENUS[spec.menuId];
  const targetLabel = useMemo(() => NODE_BY_ID.get(spec.targetId)?.label ?? spec.targetId, [spec.targetId]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (stuckRef.current) clearTimeout(stuckRef.current);
    };
  }, []);

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

  const finish = (success: boolean, terminal: "product" | "give_up" | "timeout") => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (stuckRef.current) clearTimeout(stuckRef.current);
    log("trial_end", {
      elapsed_ms: Math.round(performance.now() - startedAtRef.current),
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

  const start = () => {
    startedAtRef.current = performance.now();
    logger.beginTrial({
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      condition: "static"
    });
    log("trial_start", { elapsed_ms: 0, meta: { practice: spec.practice, trial_index: spec.trialIndex } });
    setStep("menu");
    const timeoutMs = fastMode ? 30_000 : 120_000;
    timeoutRef.current = setTimeout(() => {
      if (finishedRef.current) return;
      log("timeout", { meta: { practice: spec.practice, limit_ms: timeoutMs } });
      finish(false, "timeout");
      setStep("timeout");
    }, timeoutMs);
    const stuckMs = fastMode ? 5_000 : 60_000;
    stuckRef.current = setTimeout(() => setStuck(true), stuckMs);
  };

  const handleLeaf = (leaf: TaxonomyNode) => {
    if (finishedRef.current) return;
    log("leaf_select", {
      level: 3,
      element_id: leaf.id,
      element_label: leaf.label,
      parent_id: leaf.parentId,
      meta: { correct: leaf.productId === spec.targetId }
    });
    if (leaf.productId === spec.targetId) {
      log("product_view", {
        level: 3,
        element_id: leaf.id,
        element_label: leaf.label,
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

  if (step === "instruction") {
    return (
      <section className="trial-intro" data-testid="trial-intro">
        <div className="intro-card">
          <div className="eyebrow">{spec.practice ? "Practice trial" : `Trial ${spec.trialIndex + 1} of 3`} · Menu {spec.menuId}</div>
          <h2>{spec.practice ? "Try the menu once" : "Find this watch"}</h2>
          <p className="task-text">{spec.taskDescription}</p>
          <div className="intro-meta">
            <span>{MENU_NAMES[spec.menuId]}</span>
            <span>{spec.practice ? "Not scored" : "Scored"}</span>
            <span>Up to 120 seconds</span>
          </div>
          <p className="instruction-note">
            Start when you are ready. The task stays hidden while you search. If you cannot find the product, use the
            visible “I can’t find it” button rather than guessing.
          </p>
          <button type="button" className="button primary big" onClick={start} data-testid="start-trial">
            Start trial
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="trial-stage" data-testid="trial-stage" data-trial-id={spec.trialId}>
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
        <div className="product-overlay" role="dialog" aria-label="Product detail">
          <ProductDetail
            productId={spec.targetId}
            onBack={() => undefined}
            allowBack={false}
            onNext={() => onComplete({ success: true })}
            nextLabel={spec.practice ? "Next practice" : "Next trial"}
          />
        </div>
      ) : null}

      {step === "wrong_product" && wrongProduct ? (
        <div className="product-overlay" role="dialog" aria-label="Wrong product">
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
        <div className="product-overlay" role="dialog" aria-label="Trial ended">
          <div className="result-card">
            <div className="eyebrow">Trial ended</div>
            <h2>You chose to stop searching.</h2>
            <p>
              The target was <strong>{targetLabel}</strong>. In the main trials this is recorded as a give-up; it is
              better than guessing.
            </p>
            <button type="button" className="button primary" onClick={() => onComplete({ success: false })}>
              {spec.practice ? "Next practice" : "Next trial"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "timeout" ? (
        <div className="product-overlay" role="dialog" aria-label="Trial timed out">
          <div className="result-card">
            <div className="eyebrow">Time limit</div>
            <h2>The 120-second limit was reached.</h2>
            <p>
              The target was <strong>{targetLabel}</strong>. The trial is recorded as a timeout. Take a breath and
              continue when ready.
            </p>
            <button type="button" className="button primary" onClick={() => onComplete({ success: false })}>
              {spec.practice ? "Next practice" : "Next trial"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

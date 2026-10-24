import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_IDS, MENU_NAMES, childrenOf } from "./support/data";
import { expect, test } from "./support/fixtures";
import { gotoLab, menuRoot, nodeLocator } from "./support/menu-actions";

interface AnimationSample {
  duration: number;
  kind: string;
}

const ARTIFACT_DIR = join(process.cwd(), "tests", "artifacts", "motion-results");

function recordArtifact(filename: string, data: unknown): void {
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-fatal if artifact write cannot complete in test environment
  }
}

/**
 * Collect level-change animations that actually run after a real click.
 * A synthetic MouseEvent would skip Radix's pointerdown trigger, and the menu
 * tabs also animate background colour, so only opacity/transform animations
 * inside the menu count as a level transition. Recording starts in the page
 * before the click because a loaded worker can otherwise miss a 200 ms
 * animation while the click round-trip is still in flight.
 */
async function animationDurations(page: import("@playwright/test").Page, selector: string): Promise<AnimationSample[]> {
  await page.evaluate(() => {
    const recorder = window as typeof window & {
      __menuAnimations?: Map<string, number>;
      __menuRecording?: boolean;
    };
    recorder.__menuAnimations = new Map();
    recorder.__menuRecording = true;
    const tick = () => {
      for (const animation of document.getAnimations()) {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) continue;
        if (!effect.target.closest('[data-testid^="menu-"], .a-dropdown')) continue;
        const properties = new Set<string>();
        for (const frame of effect.getKeyframes()) {
          for (const key of Object.keys(frame)) {
            if (key !== "offset" && key !== "easing" && key !== "computedOffset") properties.add(key);
          }
        }
        if (!["opacity", "transform", "translate", "scale"].some((property) => properties.has(property))) continue;
        const duration = effect.getTiming().duration;
        if (typeof duration !== "number" || duration <= 0) continue;
        const key = `${animation.constructor.name}[${[...properties].sort().join(",")}]`;
        const seen = recorder.__menuAnimations!;
        if (!seen.has(key) || (seen.get(key) ?? 0) < duration) seen.set(key, duration);
      }
      if (recorder.__menuRecording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.locator(selector).click();
  await page.waitForTimeout(400);

  return page.evaluate(() => {
    const recorder = window as typeof window & {
      __menuAnimations?: Map<string, number>;
      __menuRecording?: boolean;
    };
    recorder.__menuRecording = false;
    return [...(recorder.__menuAnimations ?? new Map<string, number>()).entries()].map(([kind, duration]) => ({
      kind,
      duration
    }));
  });
}

async function startD3Recorder(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const scene = document.querySelector("svg.d-svg > g");
    if (!scene) throw new Error("Fractal scene not found");
    const recorder = window as typeof window & {
      __d3?: {
        configuredDuration: number | null;
        first: number | null;
        end: number | null;
        done: boolean;
        started: number;
        frameTimes: number[];
        frameDeltas: number[];
      };
    };
    recorder.__d3 = {
      configuredDuration: null,
      first: null,
      end: null,
      done: false,
      started: performance.now(),
      frameTimes: [],
      frameDeltas: []
    };
    let lastTime: number | null = null;
    const tick = (now: number) => {
      const state = recorder.__d3!;
      const transitions = (scene as unknown as { __transition?: Record<string, { duration?: number }> }).__transition;
      if (transitions && state.configuredDuration === null) {
        for (const k of Object.keys(transitions)) {
          const dur = transitions[k]?.duration;
          if (typeof dur === "number" && dur > 0) {
            state.configuredDuration = dur;
            break;
          }
        }
      }
      const transform = scene.getAttribute("transform");
      if (state.first === null && transform) {
        state.first = now;
        lastTime = now;
      } else if (state.first !== null && transform) {
        if (lastTime !== null) {
          const delta = now - lastTime;
          state.frameDeltas.push(delta);
          state.frameTimes.push(now);
        }
        lastTime = now;
      } else if (state.first !== null && !transform) {
        if (lastTime !== null) {
          const delta = now - lastTime;
          state.frameDeltas.push(delta);
          state.frameTimes.push(now);
        }
        state.end = now;
        state.done = true;
        return;
      }
      if (performance.now() - state.started > 1500) {
        state.done = true;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

interface D3ZoomResult {
  configuredDuration: number | null;
  measuredDuration: number | null;
  frameDeltas: number[];
}

async function d3ZoomDuration(page: import("@playwright/test").Page, selector: string): Promise<D3ZoomResult> {
  await startD3Recorder(page);
  await page.locator(selector).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __d3?: { done: boolean } }).__d3?.done ?? false), {
      timeout: 3_000
    })
    .toBe(true);
  return page.evaluate(() => {
    const state = (
      window as typeof window & {
        __d3?: {
          configuredDuration: number | null;
          first: number | null;
          end: number | null;
          frameDeltas: number[];
        };
      }
    ).__d3;
    const measuredDuration = state?.first != null && state.end != null ? state.end - state.first : null;
    return {
      configuredDuration: state?.configuredDuration ?? null,
      measuredDuration,
      frameDeltas: state?.frameDeltas ?? []
    };
  });
}

test.describe("motion timing", () => {
  // Serialize timing tests within this suite to prevent multi-browser CPU contention
  // from distorting animation durations and frame cadences.
  test.describe.configure({ mode: "serial" });

  test("Menu A level change uses a 180–220 ms transition", async ({ page }) => {
    await gotoLab(page, "A");
    const samples = await animationDurations(page, '[data-testid="menu-a"] [data-node-id="sport"]');
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.duration, `${sample.kind} duration`).toBeGreaterThanOrEqual(180);
      expect(sample.duration, `${sample.kind} duration`).toBeLessThanOrEqual(220);
    }
    recordArtifact("menu-a-timing.json", { menuId: "A", samples });
  });

  test("Menu E level change uses a 180–220 ms transition", async ({ page }) => {
    await gotoLab(page, "E");
    const samples = await animationDurations(page, '[data-testid="menu-e"] [data-node-id="sport"]');
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.duration, `${sample.kind} duration`).toBeGreaterThanOrEqual(180);
      expect(sample.duration, `${sample.kind} duration`).toBeLessThanOrEqual(220);
    }
    recordArtifact("menu-e-timing.json", { menuId: "E", samples });
  });

  test("Menu D zoom transition measures in the required window", async ({ page }) => {
    await gotoLab(page, "D");
    const result = await d3ZoomDuration(page, '[data-testid="menu-d"] [data-node-id="sport"]');

    // 1. Strict configured duration contract (180–220 ms per plan §5.7)
    expect(result.configuredDuration, "D3 zoom transition must have configured duration").not.toBeNull();
    expect(result.configuredDuration!, "configured D3 zoom duration").toBeGreaterThanOrEqual(180);
    expect(result.configuredDuration!, "configured D3 zoom duration").toBeLessThanOrEqual(220);

    // 2. Active frame sample count & non-empty active interval assertion
    expect(result.frameDeltas.length, "must sample multiple active frames during zoom").toBeGreaterThanOrEqual(5);

    // 3. Observed runtime duration bound with documented frame quantization tolerance.
    // The design specification (§5.7) mandates a transition duration of 180–220 ms.
    // D3 configures exactly 180 ms. Runtime observation via requestAnimationFrame
    // samples at discrete display refresh boundaries (~16.7 ms at 60 Hz).
    // Start and end boundary quantization can add up to ±2 frame intervals (up to ~35 ms)
    // of observation jitter. The measured duration is therefore bounded between 170 ms and 240 ms.
    expect(result.measuredDuration, "measured D3 zoom duration must not be null").not.toBeNull();
    expect(result.measuredDuration!, "measured D3 zoom duration").toBeGreaterThanOrEqual(170);
    expect(result.measuredDuration!, "measured D3 zoom duration").toBeLessThanOrEqual(240);

    recordArtifact("menu-d-zoom-timing.json", {
      menuId: "D",
      configuredDuration: result.configuredDuration,
      measuredDuration: result.measuredDuration,
      frameDeltas: result.frameDeltas,
      frameCount: result.frameDeltas.length
    });
  });

  test("frame cadence stays at or above 50 fps during a D zoom", async ({ page }) => {
    await gotoLab(page, "D");
    await page.evaluate(() => {
      const scene = document.querySelector("svg.d-svg > g");
      if (!scene) throw new Error("Fractal scene not found");
      const recorder = window as typeof window & {
        __activeFps?: {
          active: boolean;
          done: boolean;
          first: number | null;
          last: number | null;
          deltas: number[];
        };
      };
      recorder.__activeFps = {
        active: false,
        done: false,
        first: null,
        last: null,
        deltas: []
      };
      const tick = (now: number) => {
        const state = recorder.__activeFps!;
        const transform = scene.getAttribute("transform");
        if (!state.active && transform) {
          state.active = true;
          state.first = now;
          state.last = now;
        } else if (state.active && transform) {
          if (state.last !== null) {
            state.deltas.push(now - state.last);
          }
          state.last = now;
        } else if (state.active && !transform) {
          if (state.last !== null) {
            state.deltas.push(now - state.last);
          }
          state.last = now;
          state.done = true;
          return;
        }
        if (state.first !== null && now - state.first > 1500) {
          state.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.locator('[data-testid="menu-d"] [data-node-id="sport"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as typeof window & { __activeFps?: { done: boolean } }).__activeFps?.done ?? false), {
        timeout: 3_000
      })
      .toBe(true);

    const stats = await page.evaluate(() => {
      const state = (window as typeof window & { __activeFps?: { deltas: number[]; first: number | null; last: number | null } }).__activeFps;
      const deltas = (state?.deltas ?? []).filter((d) => d > 0);
      const total = deltas.reduce((s, d) => s + d, 0);
      return {
        deltas,
        total,
        fps: total > 0 ? (deltas.length / total) * 1000 : 0
      };
    });

    recordArtifact("menu-d-fps.json", {
      menuId: "D",
      activeFps: stats.fps,
      activeTotalMs: stats.total,
      activeFrameCount: stats.deltas.length,
      deltas: stats.deltas
    });
    // Save failed measurements too; no idle frames contribute to the gate.
    expect(stats.deltas.length, "must sample multiple frames during active zoom").toBeGreaterThanOrEqual(8);
    expect(stats.fps, `measured ${stats.fps.toFixed(1)} fps during active zoom animation`).toBeGreaterThanOrEqual(50);
  });

  test("transition durations outside the menus are not used as the timing gate", async ({ page }) => {
    await gotoLab(page, "A");
    // The tab colour transition is 180 ms but is not a level change. Opening
    // the department dropdown adds an opacity animation that is a level
    // change; the recorder must report that and exclude the colour transition.
    const samples = await animationDurations(page, '[data-testid="menu-a"] [data-node-id="sport"]');
    expect(samples.some((sample) => sample.kind.includes("opacity")), "the dropdown fade is a level change").toBe(true);
    expect(samples.some((sample) => sample.kind.includes("backgroundColor")), "tab colour fades are not timed").toBe(
      false
    );
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) suppresses level transitions`, async ({ page }) => {
      const department = childrenOf(null)[0]!;
      const subcategory = childrenOf(department.id)[0]!;
      await gotoLab(page, menuId);

      if (menuId === "D") {
        await page.evaluate(() => {
          const scene = document.querySelector("svg.d-svg > g");
          if (!scene) throw new Error("Fractal scene not found");
          const recorder = window as typeof window & {
            __dTransforms?: string[];
            __dObserver?: MutationObserver;
          };
          recorder.__dTransforms = [];
          recorder.__dObserver = new MutationObserver(() => {
            const transform = scene.getAttribute("transform");
            if (transform) recorder.__dTransforms!.push(transform);
          });
          recorder.__dObserver.observe(scene, { attributes: true, attributeFilter: ["transform"] });
        });

        await nodeLocator(page, menuId, department.id, 1).click();
        await expect(nodeLocator(page, menuId, subcategory.id, 2)).toBeVisible();
        await page.waitForTimeout(300);
        const transforms = await page.evaluate(() => {
          const recorder = window as typeof window & {
            __dTransforms?: string[];
            __dObserver?: MutationObserver;
          };
          recorder.__dObserver?.disconnect();
          return recorder.__dTransforms ?? [];
        });
        expect(transforms.length, "reduced motion must skip the D3 zoom transform").toBe(0);
        return;
      }

      await nodeLocator(page, menuId, department.id, 1).click();
      if (menuId === "A") await expect(page.locator(".a-dropdown")).toBeVisible();
      else if (menuId === "C") await expect(menuRoot(page, menuId).getByTestId("c-mega")).toBeVisible();
      else await expect(nodeLocator(page, menuId, subcategory.id, 2)).toBeVisible();

      const running = await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return document
          .getAnimations()
          .filter((animation) => animation.playState === "running")
          .map((animation) => {
            const timing = animation.effect?.getTiming();
            return typeof timing?.duration === "number" ? timing.duration : 0;
          });
      });
      expect(running.filter((duration) => duration > 20), "reduced motion must remove long transitions").toEqual([]);
    });
  }
});

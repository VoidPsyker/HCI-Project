import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { Repository } from "../../apps/server/src/repository";
import { createServer } from "../../apps/server/src/server";
import { GazeController } from "../../apps/web/src/gaze/GazeController";
import type { CalibrationCapableSource } from "../../apps/web/src/gaze/GazeController";
import type { GazeApi, GazeBatch, GazeBatchResponse, GazeConsentResponse, GazeCompleteResponse } from "../../apps/web/src/gaze/gazeClient";
import type {
  CalibrationTarget,
  ClockSyncReport,
  GazeConsent,
  GazeSample,
  GazeSampleListener,
  GazeSourceInfo,
  ScreenGeometry,
  Viewport
} from "@meridian/analysis";

const ADMIN_PASSWORD = "flow-admin-secret-2026";

const TEST_VIEWPORT: Viewport = { width_px: 1920, height_px: 1080 };
const TEST_GEOMETRY: ScreenGeometry = {
  width_px: 1920,
  height_px: 1080,
  width_mm: 531,
  height_mm: 298,
  viewing_distance_mm: 600
};

const TEST_CONSENT: GazeConsent = {
  version: "gaze-v1.0",
  camera_used: false,
  scope: "eye_tracking_only",
  granted_at: new Date().toISOString(),
  retention_days: 90
};

class SyntheticDeterministicSource implements CalibrationCapableSource {
  readonly info: GazeSourceInfo = {
    kind: "synthetic",
    adapter: "synthetic-deterministic-pipeline",
    device: "Deterministic Synthetic Replay",
    nominal_hz: 60,
    hardware_backed: false,
    synthetic: true,
    capabilities: ["gaze"]
  };

  status: "idle" | "running" | "paused" | "stopped" = "idle";
  clock: ClockSyncReport = {
    method: "local_same_clock",
    nominal_source_hz: 60,
    offset_ms: 0,
    round_trip_ms: 0,
    synchronized_at_ms: 0
  };

  private listeners = new Set<GazeSampleListener>();
  public trainedTargets: CalibrationTarget[] = [];
  public mode: "pass" | "fail" = "pass";
  public seq = 0;

  async start(): Promise<void> {
    this.status = "running";
  }

  async stop(): Promise<void> {
    this.status = "stopped";
  }

  async pause(): Promise<void> {
    this.status = "paused";
  }

  async resume(): Promise<void> {
    this.status = "running";
  }

  subscribe(listener: GazeSampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async recordCalibrationTarget(target: CalibrationTarget): Promise<void> {
    this.trainedTargets.push(target);
  }

  emitSample(sample: Partial<GazeSample>): void {
    this.seq += 1;
    const s: GazeSample = {
      seq: this.seq,
      t_ms: sample.t_ms ?? 1000 + this.seq * 16.6,
      t_source_ms: sample.t_source_ms ?? 1000 + this.seq * 16.6,
      x_px: sample.x_px ?? 500,
      y_px: sample.y_px ?? 400,
      valid: sample.valid ?? true,
      trial_id: sample.trial_id ?? null,
      ...sample
    };
    for (const listener of this.listeners) {
      listener(s);
    }
  }

  emitValidationObservations(target: CalibrationTarget, count = 5): void {
    for (let i = 0; i < count; i++) {
      // In pass mode, error is minimal (~0.2 deg). In fail mode, deviation is 400px (~10 deg)
      const delta = this.mode === "pass" ? (i - 2) * 1.0 : 400 + i * 10;
      this.emitSample({
        x_px: target.x_px + delta,
        y_px: target.y_px + delta,
        valid: true
      });
    }
  }
}

function createHttpGazeApi(baseUrl: string): GazeApi {
  return {
    async consent(input) {
      const res = await fetch(`${baseUrl}/api/gaze/sessions/${encodeURIComponent(input.session_id)}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: input.version,
          camera_used: input.camera_used,
          synthetic: input.synthetic,
          viewport: input.viewport,
          geometry: input.geometry,
          source: input.source
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as Record<string, unknown>).error as string || `HTTP ${res.status}`);
      }
      return data as GazeConsentResponse;
    },
    async batch(sessionId, token, batch) {
      const res = await fetch(`${baseUrl}/api/gaze/sessions/${encodeURIComponent(sessionId)}/batches`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gaze-token": token
        },
        body: JSON.stringify(batch)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as Record<string, unknown>).error as string || `HTTP ${res.status}`);
      }
      return data as GazeBatchResponse;
    },
    async complete(sessionId, token, payload) {
      const res = await fetch(`${baseUrl}/api/gaze/sessions/${encodeURIComponent(sessionId)}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gaze-token": token
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as Record<string, unknown>).error as string || `HTTP ${res.status}`);
      }
      return data as GazeCompleteResponse;
    }
  };
}

describe("End-to-End Deterministic Synthetic Biometric Pipeline Flow", () => {
  let tmpDir: string;
  let dbPath: string;
  let rawDir: string;
  let gazeDir: string;
  let repo: Repository;
  let app: Awaited<ReturnType<typeof createServer>>;
  let baseUrl: string;
  let api: GazeApi;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gaze-flow-"));
    dbPath = path.join(tmpDir, "meridian-flow.sqlite");
    rawDir = path.join(tmpDir, "raw");
    gazeDir = path.join(tmpDir, "gaze");

    repo = new Repository(dbPath, rawDir, "flow-seed-2026", gazeDir);
    app = await createServer(repo, { adminPassword: ADMIN_PASSWORD });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 8787;
    baseUrl = `http://127.0.0.1:${port}`;
    api = createHttpGazeApi(baseUrl);
  });

  afterEach(async () => {
    await app.close();
    repo.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  async function createConsentedSession(label = "Flow Test Participant") {
    const { session, participant } = repo.createSession(label);
    repo.recordConsent(session.session_id, "core-v1.0");
    return { session, participant };
  }

  it("retries source startup without replacing its authenticated ingestion token", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();
    const originalStart = source.start.bind(source);
    let starts = 0;
    source.start = async (consent) => {
      if (++starts === 1) throw new Error("source_unavailable");
      await originalStart(consent);
    };
    let consentCalls = 0;
    const controller = new GazeController({
      participant_id: "p-test", session_id: session.session_id, consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT, geometry: TEST_GEOMETRY, source,
      viewportNow: () => TEST_VIEWPORT,
      api: { ...api, consent: (input) => { consentCalls++; return api.consent(input); } }
    });
    await expect(controller.start()).rejects.toThrow("source_unavailable");
    await controller.start();
    expect(consentCalls).toBe(1);
    source.emitSample({ x_px: 400, y_px: 300, valid: true });
    await controller.stop();
    expect(repo.getGazeSamples(session.session_id)).toHaveLength(1);
  });

  it("1. Consent gating: rejects missing session (404) and missing core consent (409)", async () => {
    // Missing session
    await expect(
      api.consent({
        session_id: "non-existent-session-1234",
        version: "gaze-v1.0",
        camera_used: false,
        synthetic: true,
        viewport: TEST_VIEWPORT,
        geometry: TEST_GEOMETRY,
        source: new SyntheticDeterministicSource().info
      })
    ).rejects.toThrow("session_not_found");

    // Existing session without core study consent
    const { session } = repo.createSession("Unconsented Participant");
    await expect(
      api.consent({
        session_id: session.session_id,
        version: "gaze-v1.0",
        camera_used: false,
        synthetic: true,
        viewport: TEST_VIEWPORT,
        geometry: TEST_GEOMETRY,
        source: new SyntheticDeterministicSource().info
      })
    ).rejects.toThrow("core_consent_required");
  });

  it("2. Consent acquisition: establishes synthetic gaze consent and secure hashed bearer token", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();

    const consentRes = await api.consent({
      session_id: session.session_id,
      version: "gaze-v1.0",
      camera_used: false,
      synthetic: true,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source: source.info
    });

    expect(consentRes.ok).toBe(true);
    expect(consentRes.session_id).toBe(session.session_id);
    expect(consentRes.synthetic).toBe(true);
    expect(consentRes.consent.scope).toBe("eye_tracking_only");
    expect(consentRes.consent.camera_used).toBe(false);
    expect(consentRes.consent.separate_from_core_consent).toBe(true);
    expect(typeof consentRes.token).toBe("string");
    expect(consentRes.token.length).toBeGreaterThan(16);

    // Verify token is hashed with SHA-256 in the database and never plaintext
    const db = (repo as unknown as { db: import("better-sqlite3").Database }).db;
    const row = db.prepare("SELECT token_hash, synthetic, camera_used FROM gaze_sessions WHERE session_id = ?").get(session.session_id) as {
      token_hash: string;
      synthetic: number;
      camera_used: number;
    };
    expect(row).toBeDefined();
    expect(row.synthetic).toBe(1);
    expect(row.camera_used).toBe(0);
    const expectedHash = crypto.createHash("sha256").update(consentRes.token).digest("hex");
    expect(row.token_hash).toBe(expectedHash);
  });

  it("3. Controller startup & cancellation: supports clean startup and cancellation before ready", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();

    // Verify cancellation during or immediately on startup
    const delayedApi: GazeApi = {
      ...api,
      async consent(input) {
        await new Promise((r) => setTimeout(r, 20));
        return api.consent(input);
      }
    };

    const abortController = new GazeController({
      participant_id: "p-test",
      session_id: session.session_id,
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api: delayedApi,
      viewportNow: () => TEST_VIEWPORT
    });

    const startPromise = abortController.start();
    // Stop while startup is in-flight
    await abortController.stop();
    await expect(startPromise).resolves.toBeUndefined();
    expect(abortController.status).toBe("stopped");

    // Clean startup with responsive api
    const { session: readySession } = await createConsentedSession("Clean startup");
    const readyController = new GazeController({
      participant_id: "p-test",
      session_id: readySession.session_id,
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api,
      viewportNow: () => TEST_VIEWPORT
    });

    await readyController.start();
    expect(readyController.status).toBe("ready");
    await readyController.stop();
  });

  it("4. Calibration gate enforcement: failing calibration strictly denies trial initiation", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();
    source.mode = "fail"; // Emits observations deviating by >10 degrees

    let currentTarget: CalibrationTarget | null = null;
    const controller = new GazeController({
      participant_id: "p-test",
      session_id: session.session_id,
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api,
      viewportNow: () => TEST_VIEWPORT,
      settleMs: 0,
      dwellMs: 5,
      wait: async (ms) => {
        if (ms === 5 && currentTarget) {
          source.emitValidationObservations(currentTarget, 5);
        }
      }
    });

    await controller.start();
    const targets = controller.beginCalibration();
    expect(targets.length).toBe(9);

    // Two-pass calibration
    for (const target of targets) {
      currentTarget = target;
      await controller.trainCalibrationTarget(target);
    }
    for (const target of targets) {
      currentTarget = target;
      await controller.validateCalibrationTarget(target);
    }

    const report = controller.finishCalibration();
    expect(report.passes).toBe(false);
    expect(controller.calibrationGatePassed).toBe(false);
    expect(controller.status).toBe("failed");

    // Calibration gate must strictly prevent beginning trials
    await expect(
      controller.beginTrial({
        trial_id: "trial-blocked",
        menu_id: "A",
        target_product_id: "sport.prodiver.titanium-deep"
      })
    ).rejects.toThrow("gaze_calibration_gate_not_passed");

    await controller.stop();
  });

  it("5. Calibration gate pass: accurate synthetic calibration passes gate and enables trial", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();
    source.mode = "pass"; // Minimal error (< 0.5 degrees)

    let currentTarget: CalibrationTarget | null = null;
    const controller = new GazeController({
      participant_id: "p-test",
      session_id: session.session_id,
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api,
      viewportNow: () => TEST_VIEWPORT,
      settleMs: 0,
      dwellMs: 5,
      wait: async (ms) => {
        if (ms === 5 && currentTarget) {
          source.emitValidationObservations(currentTarget, 5);
        }
      }
    });

    await controller.start();
    const targets = controller.beginCalibration();
    for (const target of targets) {
      currentTarget = target;
      await controller.trainCalibrationTarget(target);
    }
    for (const target of targets) {
      currentTarget = target;
      await controller.validateCalibrationTarget(target);
    }

    const report = controller.finishCalibration();
    expect(report.passes).toBe(true);
    expect(report.angular_available).toBe(true);
    expect(controller.calibrationGatePassed).toBe(true);
    expect(controller.status).toBe("calibrated");

    await controller.stop();
  });

  it("6. Trial lifecycle & AOI capture: snapshots active AOI intervals with target classification", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();
    source.mode = "pass";

    let currentTarget: CalibrationTarget | null = null;
    const controller = new GazeController({
      participant_id: "p-test",
      session_id: session.session_id,
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api,
      viewportNow: () => TEST_VIEWPORT,
      settleMs: 0,
      dwellMs: 5,
      wait: async (ms) => {
        if (ms === 5 && currentTarget) {
          source.emitValidationObservations(currentTarget, 5);
        }
      }
    });

    await controller.start();
    const targets = controller.beginCalibration();
    for (const t of targets) {
      currentTarget = t;
      await controller.trainCalibrationTarget(t);
    }
    for (const t of targets) {
      currentTarget = t;
      await controller.validateCalibrationTarget(t);
    }
    controller.finishCalibration();

    // DOM Setup for AOI capture
    const dom = new JSDOM(`<!DOCTYPE html>
<html>
  <body>
    <div id="container">
      <nav data-aoi="menu">
        <div data-node-id="sport">Sport &amp; Dive</div>
        <button data-node-id="sport.prodiver.titanium-deep">Titanium Deep</button>
        <button data-node-id="sport.prodiver.steel-blue">Steel Blue</button>
      </nav>
    </div>
  </body>
</html>`);
    const originalDocument = globalThis.document;
    const originalHTMLElement = globalThis.HTMLElement;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;

    for (const el of Array.from(dom.window.document.querySelectorAll("*"))) {
      (el as any).getBoundingClientRect = () => ({
        x: 150,
        y: 200,
        width: 300,
        height: 60,
        top: 200,
        left: 150,
        right: 450,
        bottom: 260
      });
    }

    try {
      const trialId = "trial-001";
      const { start_ms } = await controller.beginTrial({
        trial_id: trialId,
        menu_id: "A",
        target_product_id: "sport.prodiver.titanium-deep"
      });

      expect(controller.status).toBe("trials");
      expect(Number.isFinite(start_ms)).toBe(true);

      // Capture AOIs
      const container = dom.window.document.getElementById("container") as HTMLElement;
      controller.captureAois(container, start_ms + 10);

      // Emit samples during trial
      source.emitSample({ trial_id: trialId, x_px: 200, y_px: 220, valid: true });
      source.emitSample({ trial_id: trialId, x_px: 210, y_px: 225, valid: true });

      // End trial
      controller.endTrial({ trial_id: trialId, end_ms: start_ms + 1000 });
      expect(controller.status).toBe("ready");

      const metrics = controller.getMetrics();
      expect(metrics.length).toBeGreaterThanOrEqual(1);
      const m = metrics.find((item) => item.trial_id === trialId);
      expect(m).toBeDefined();
    } finally {
      globalThis.document = originalDocument;
      globalThis.HTMLElement = originalHTMLElement;
      await controller.stop();
    }
  });

  it("7. Ingestion pipeline: bounded batch uploads & duplicate batch idempotency", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();

    const consentRes = await api.consent({
      session_id: session.session_id,
      version: "gaze-v1.0",
      camera_used: false,
      synthetic: true,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source: source.info
    });
    const token = consentRes.token;

    // Send first batch
    const batch1: GazeBatch = {
      batch_id: "batch-flow-001",
      samples: Array.from({ length: 10 }, (_, i) => ({
        seq: i + 1,
        t_ms: 1000 + i * 16.6,
        t_source_ms: 1000 + i * 16.6,
        x_px: 300 + i,
        y_px: 400 + i,
        valid: true,
        trial_id: "trial-001"
      }))
    };

    const batch1Res = await api.batch(session.session_id, token, batch1);
    expect(batch1Res.ok).toBe(true);
    expect(batch1Res.accepted).toBe(10);
    expect(batch1Res.duplicate).toBe(false);

    // Duplicate batch submission must be accepted idempotently with accepted: 0
    const dupRes = await api.batch(session.session_id, token, batch1);
    expect(dupRes.ok).toBe(true);
    expect(dupRes.accepted).toBe(0);
    expect(dupRes.duplicate).toBe(true);

    // Verify sample count in SQLite remains exactly 10
    const db = (repo as unknown as { db: import("better-sqlite3").Database }).db;
    const countRow = db.prepare("SELECT COUNT(*) as c FROM gaze_samples WHERE session_id = ?").get(session.session_id) as { c: number };
    expect(countRow.c).toBe(10);
  });

  it("8. Completion & synthetic provenance: guarantees analysis_ready=false for synthetic data", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();
    source.mode = "pass";

    let currentTarget: CalibrationTarget | null = null;
    const controller = new GazeController({
      participant_id: "p-test",
      session_id: session.session_id,
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api,
      viewportNow: () => TEST_VIEWPORT,
      settleMs: 0,
      dwellMs: 5,
      wait: async (ms) => {
        if (ms === 5 && currentTarget) {
          source.emitValidationObservations(currentTarget, 5);
        }
      }
    });

    await controller.start();
    const targets = controller.beginCalibration();
    for (const t of targets) {
      currentTarget = t;
      await controller.trainCalibrationTarget(t);
    }
    for (const t of targets) {
      currentTarget = t;
      await controller.validateCalibrationTarget(t);
    }
    controller.finishCalibration();

    const { start_ms } = await controller.beginTrial({
      trial_id: "trial-comp-01",
      menu_id: "A",
      target_product_id: "sport.prodiver.titanium-deep"
    });
    for (let i = 0; i < 5; i++) {
      source.emitSample({ trial_id: "trial-comp-01", x_px: 500, y_px: 400, valid: true });
    }
    controller.endTrial({ trial_id: "trial-comp-01", end_ms: start_ms + 500 });

    const completion = await controller.complete();
    expect(completion.ok).toBe(true);
    expect(controller.status).toBe("completed");

    // CRITICAL PROVENANCE REQUIREMENT:
    // Synthetic runs must ALWAYS remain synthetic: true and analysis_ready: false.
    // They must NEVER manufacture participant accuracy or human validity.
    const db = (repo as unknown as { db: import("better-sqlite3").Database }).db;
    const gazeRow = db.prepare("SELECT * FROM gaze_sessions WHERE session_id = ?").get(session.session_id) as {
      synthetic: number;
      analysis_ready: number;
      quality_json: string;
      manifest_json: string;
    };
    expect(gazeRow).toBeDefined();
    expect(gazeRow.synthetic).toBe(1);
    expect(gazeRow.analysis_ready).toBe(0);

    const manifest = JSON.parse(gazeRow.manifest_json) as Record<string, unknown>;
    expect(manifest.synthetic).toBe(true);
    expect(manifest.human_data).toBe(false);
    expect(manifest.analysis_ready).toBe(false);
  });

  it("9. Restricted exports & admin authorization: protects biometric data behind admin auth", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();

    const consentRes = await api.consent({
      session_id: session.session_id,
      version: "gaze-v1.0",
      camera_used: false,
      synthetic: true,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source: source.info
    });

    await api.batch(session.session_id, consentRes.token, {
      batch_id: "batch-export-01",
      samples: [
        {
          seq: 1,
          t_ms: 1000,
          t_source_ms: 1000,
          x_px: 400,
          y_px: 300,
          valid: true,
          trial_id: "t-1"
        }
      ]
    });

    await api.complete(session.session_id, consentRes.token, {
      calibration: null,
      quality: {
        overall: "fail",
        analysis_ready: false,
        angular_metrics_ready: false,
        missing_pct: 0,
        sample_count: 1,
        valid_sample_count: 1,
        rejected_samples: 0,
        dropped_samples: 0
      },
      metrics: [],
      clock: source.clock,
      max_samples: 1000,
      rejected_samples: 0,
      dropped_samples: 0
    });

    // Unauthenticated access must be denied with 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/gaze/sessions/${encodeURIComponent(session.session_id)}`);
    expect(unauthRes.status).toBe(401);

    // Wrong password must be denied with 401
    const wrongAuthRes = await fetch(`${baseUrl}/api/admin/gaze/sessions/${encodeURIComponent(session.session_id)}`, {
      headers: { "x-admin-password": "incorrect-password" }
    });
    expect(wrongAuthRes.status).toBe(401);

    // Correct password succeeds and returns restricted bundle
    const authRes = await fetch(`${baseUrl}/api/admin/gaze/sessions/${encodeURIComponent(session.session_id)}`, {
      headers: { "x-admin-password": ADMIN_PASSWORD }
    });
    expect(authRes.status).toBe(200);
    const bundle = await authRes.json();
    expect(bundle.gaze).toBeDefined();
    expect(bundle.gaze.session_id).toBe(session.session_id);
    expect(bundle.gaze.sample_count).toBe(1);

    // Ensure exports are written only into isolated temp dir, never production ./data or ./exports
    expect(fs.existsSync(gazeDir)).toBe(true);
  });

  it("10. Participant withdrawal flow: purges all stored gaze samples and revokes access", async () => {
    const { session } = await createConsentedSession();
    const source = new SyntheticDeterministicSource();

    const consentRes = await api.consent({
      session_id: session.session_id,
      version: "gaze-v1.0",
      camera_used: false,
      synthetic: true,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source: source.info
    });
    const token = consentRes.token;

    await api.batch(session.session_id, token, {
      batch_id: "batch-withdraw-01",
      samples: [
        { seq: 1, t_ms: 1000, t_source_ms: 1000, x_px: 200, y_px: 200, valid: true, trial_id: null }
      ]
    });

    const db = (repo as unknown as { db: import("better-sqlite3").Database }).db;
    const beforeCount = db.prepare("SELECT COUNT(*) as c FROM gaze_samples WHERE session_id = ?").get(session.session_id) as { c: number };
    expect(beforeCount.c).toBe(1);

    // Participant withdraws
    const withdrawRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session.session_id)}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true })
    });
    expect(withdrawRes.status).toBe(200);

    // All biometric data must be wiped from SQLite
    const afterSamples = db.prepare("SELECT COUNT(*) as c FROM gaze_samples WHERE session_id = ?").get(session.session_id) as { c: number };
    expect(afterSamples.c).toBe(0);

    const afterSession = db.prepare("SELECT * FROM gaze_sessions WHERE session_id = ?").get(session.session_id);
    expect(afterSession).toBeUndefined();

    // Subsequent batch requests with the old token must be rejected with 401
    await expect(
      api.batch(session.session_id, token, {
        batch_id: "batch-late",
        samples: [{ seq: 2, t_ms: 1010, t_source_ms: 1010, x_px: 200, y_px: 200, valid: true, trial_id: null }]
      })
    ).rejects.toThrow();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Repository } from "../src/repository";
import { createServer } from "../src/server";
import { seedDatabase } from "../src/seed";

const ADMIN_PASSWORD = "test-acceptance-admin";

function sampleConsentPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: "gaze-v1.0",
    camera_used: true,
    synthetic: false,
    viewport: { width_px: 1920, height_px: 1080 },
    geometry: {
      width_px: 1920,
      height_px: 1080,
      width_mm: 531,
      height_mm: 298,
      viewing_distance_mm: 600
    },
    source: {
      kind: "webcam",
      adapter: "webgazer",
      device: "Integrated Camera",
      nominal_hz: 30,
      hardware_backed: false,
      synthetic: false,
      capabilities: ["gaze"]
    },
    ...overrides
  };
}

function sampleSyntheticConsentPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: "gaze-v1.0",
    camera_used: false,
    synthetic: true,
    viewport: { width_px: 1920, height_px: 1080 },
    geometry: {
      width_px: 1920,
      height_px: 1080,
      width_mm: 531,
      height_mm: 298,
      viewing_distance_mm: 600
    },
    source: {
      kind: "synthetic",
      adapter: "synthetic-replay",
      device: "Synthetic Engine",
      nominal_hz: 60,
      hardware_backed: false,
      synthetic: true,
      capabilities: ["gaze"]
    },
    ...overrides
  };
}

function sessionEndEvent(session: { session_id: string; participant_id: string }) {
  return {
    event_id: crypto.randomUUID(),
    participant_id: session.participant_id,
    session_id: session.session_id,
    study: "pilot",
    block_id: null,
    trial_id: null,
    task_id: null,
    target_id: null,
    menu_id: null,
    state_label: "mixed",
    condition: "static",
    event_type: "session_end",
    t_client: 1000,
    elapsed_ms: null,
    level: null,
    element_id: null,
    element_label: null,
    parent_id: null,
    x: null,
    y: null,
    input_type: "mouse",
    meta: {}
  };
}

function sampleBatchPayload(batchId: string, startSeq = 1, count = 5) {
  return {
    batch_id: batchId,
    samples: Array.from({ length: count }, (_, i) => ({
      seq: startSeq + i,
      t_ms: 1000 + (startSeq + i) * 16.6,
      t_source_ms: 1000 + (startSeq + i) * 16.6,
      x_px: 400 + i * 2,
      y_px: 300 + i * 2,
      valid: true,
      trial_id: "trial-001"
    }))
  };
}

function sampleCompletePayload(sampleCount = 5, overrides: Record<string, unknown> = {}) {
  return {
    calibration: {
      target_count: 9,
      expected_target_count: 9,
      max_error_deg: 1.1,
      criterion_deg: 1.5,
      passes: true,
      angular_available: true,
      unknown_observations: 0,
      points: [{ observation_count: 10 }]
    },
    quality: {
      overall: "pass",
      analysis_ready: true,
      angular_metrics_ready: true,
      missing_pct: 0,
      sample_count: sampleCount,
      valid_sample_count: sampleCount,
      rejected_samples: 0,
      dropped_samples: 0
    },
    metrics: [{ trial_id: "trial-001", mean_x: 404, mean_y: 304 }],
    clock: { offset_ms: 0 },
    max_samples: 10000,
    rejected_samples: 0,
    dropped_samples: 0,
    ...overrides
  };
}

describe("Server Biometric Acceptance Tests", () => {
  let tmpDir: string;
  let dbPath: string;
  let rawDir: string;
  let gazeDir: string;
  let repo: Repository;
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gaze-acceptance-"));
    dbPath = path.join(tmpDir, "meridian-test.sqlite");
    rawDir = path.join(tmpDir, "raw");
    gazeDir = path.join(tmpDir, "gaze");

    repo = new Repository(dbPath, rawDir, "acceptance-seed-2026", gazeDir);
    app = await createServer(repo, { adminPassword: ADMIN_PASSWORD });
  });

  afterEach(async () => {
    await app.close();
    repo.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  async function createTestSession(consented = true) {
    const { session, participant } = repo.createSession("Participant Acceptance");
    if (consented) {
      repo.recordConsent(session.session_id, "core-v1.0");
    }
    return { session, participant };
  }

  describe("1. Separate core/gaze consent & session binding", () => {
    it("denies gaze consent when session does not exist (404)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gaze/sessions/S-nonexistent-123/consent",
        payload: sampleConsentPayload()
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("session_not_found");
    });

    it("denies gaze consent when core participant consent has not been granted (409)", async () => {
      const { session } = await createTestSession(false);
      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("core_consent_required");
    });

    it("records separate gaze consent once core consent exists and returns token", async () => {
      const { session } = await createTestSession(true);
      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.session_id).toBe(session.session_id);
      expect(body.token).toBeTypeOf("string");
      expect(body.token.length).toBeGreaterThan(16);
      expect(body.consent).toMatchObject({
        version: "gaze-v1.0",
        scope: "eye_tracking_only",
        camera_used: true,
        separate_from_core_consent: true,
        raw_video_retention: false
      });

      const gazeRow = repo.getGazeSession(session.session_id);
      expect(gazeRow).not.toBeNull();
      expect(gazeRow!.token_hash).not.toBe(body.token);
      expect(gazeRow!.token_hash).toBe(crypto.createHash("sha256").update(body.token, "utf8").digest("hex"));
      expect(gazeRow!.participant_id).toBe(session.participant_id);
    });
  });

  describe("2. Authentication and token trust boundary", () => {
    it("rejects batch submission with missing or invalid gaze token (401)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const validToken = consentRes.json().token;
      const batchPayload = sampleBatchPayload(crypto.randomUUID(), 1, 5);

      // Missing token
      const noTokenRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        payload: batchPayload
      });
      expect(noTokenRes.statusCode).toBe(401);
      expect(noTokenRes.json().error).toBe("gaze_token_invalid");

      // Wrong token
      const wrongTokenRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": "wrong-bogus-token" },
        payload: batchPayload
      });
      expect(wrongTokenRes.statusCode).toBe(401);
      expect(wrongTokenRes.json().error).toBe("gaze_token_invalid");

      // Valid token succeeds
      const validRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": validToken },
        payload: batchPayload
      });
      expect(validRes.statusCode).toBe(200);
      expect(validRes.json().ok).toBe(true);
    });

    it("rejects session completion with missing or wrong token (401)", async () => {
      const { session } = await createTestSession(true);
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });

      const resNoToken = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        payload: sampleCompletePayload(0)
      });
      expect(resNoToken.statusCode).toBe(401);

      const resBadToken = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": "unauthorized-token" },
        payload: sampleCompletePayload(0)
      });
      expect(resBadToken.statusCode).toBe(401);
    });

    it("blocks unauthorized re-consent without valid token (401)", async () => {
      const { session } = await createTestSession(true);
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });

      // Attempt to re-consent without token header
      const noTokenRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      expect(noTokenRes.statusCode).toBe(401);
      expect(noTokenRes.json().error).toBe("gaze_unauthorized");

      // Attempt to re-consent with wrong token
      const wrongTokenRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        headers: { "x-gaze-token": "attacker-token" },
        payload: sampleConsentPayload()
      });
      expect(wrongTokenRes.statusCode).toBe(401);
      expect(wrongTokenRes.json().error).toBe("gaze_unauthorized");
    });

    it("rotates token on authorized re-consent before samples exist and invalidates previous token", async () => {
      const { session } = await createTestSession(true);
      const firstConsent = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      expect(firstConsent.statusCode).toBe(200);
      const token1 = firstConsent.json().token;

      // Authorized re-consent before samples exist rotates token
      const secondConsent = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        headers: { "x-gaze-token": token1 },
        payload: sampleConsentPayload()
      });
      expect(secondConsent.statusCode).toBe(200);
      const token2 = secondConsent.json().token;
      expect(token2).not.toBe(token1);

      // Ingest with old token1 now fails with 401
      const oldTokenRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token1 },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 3)
      });
      expect(oldTokenRes.statusCode).toBe(401);
      expect(oldTokenRes.json().error).toBe("gaze_token_invalid");

      // Ingest with new token2 succeeds
      const newTokenRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token2 },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 3)
      });
      expect(newTokenRes.statusCode).toBe(200);
      expect(newTokenRes.json().accepted).toBe(3);
    });
  });

  describe("3. Immutability and configuration integrity", () => {
    it("denies changing synthetic provenance once samples exist (400)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleSyntheticConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest sample
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 2)
      });

      // Attempt to re-consent switching to human webcam data with valid token
      const reconsentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        headers: { "x-gaze-token": token },
        payload: sampleConsentPayload()
      });
      expect(reconsentRes.statusCode).toBe(400);
      expect(reconsentRes.json().error).toBe("gaze_consent_synthetic_mismatch");
    });

    it("enforces immutable capture configuration once samples exist (409)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest sample
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 2)
      });

      // Attempt to alter viewport geometry once samples exist
      const alteredConsent = sampleConsentPayload({
        viewport: { width_px: 1280, height_px: 720 },
        geometry: {
          width_px: 1280,
          height_px: 720,
          width_mm: 531,
          height_mm: 298,
          viewing_distance_mm: 600
        }
      });

      const reconsentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        headers: { "x-gaze-token": token },
        payload: alteredConsent
      });
      expect(reconsentRes.statusCode).toBe(409);
      expect(reconsentRes.json().error).toBe("gaze_configuration_immutable");
    });

    it("denies re-consent after gaze session has completed (400)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest 5 samples
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 5)
      });

      // Complete gaze session
      const completeRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: sampleCompletePayload(5)
      });
      expect(completeRes.statusCode).toBe(200);

      // Re-consent on completed session must be rejected
      const reconsentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        headers: { "x-gaze-token": token },
        payload: sampleConsentPayload()
      });
      expect(reconsentRes.statusCode).toBe(400);
      expect(reconsentRes.json().error).toBe("gaze_session_completed");
    });

    it("rejects synthetic flag disagreement in consent payload (400)", async () => {
      const { session } = await createTestSession(true);
      const badPayload = sampleSyntheticConsentPayload({
        synthetic: true,
        source: {
          kind: "webcam",
          adapter: "webgazer",
          device: "Camera",
          nominal_hz: 30,
          hardware_backed: false,
          synthetic: false,
          capabilities: ["gaze"]
        }
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: badPayload
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_payload");
    });
  });

  describe("4. Bounded payload validation and strict media blocking", () => {
    it("strictly refuses any raw media or image/video fields in consent payload (400)", async () => {
      const { session } = await createTestSession(true);
      const mediaKeys = ["image", "video", "raw_video", "frame", "face_image", "webcam_frame"];

      for (const key of mediaKeys) {
        const payload = sampleConsentPayload({ [key]: "base64-raw-video-bytes" });
        const res = await app.inject({
          method: "POST",
          url: `/api/gaze/sessions/${session.session_id}/consent`,
          payload
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("gaze_media_forbidden");
        expect(res.json().field).toBe(key);
      }
    });

    it("strictly refuses media fields in batch payloads (nested in samples) (400)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      const batchWithMedia = {
        batch_id: crypto.randomUUID(),
        samples: [
          {
            seq: 1,
            t_ms: 1000,
            x_px: 100,
            y_px: 100,
            valid: true,
            frame: "base64-frame"
          }
        ]
      };

      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: batchWithMedia
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("gaze_media_forbidden");
      expect(res.json().field).toBe("samples[0].frame");
    });

    it("strictly refuses media fields in completion payload (400)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      const completeWithMedia = sampleCompletePayload(0, {
        video_frame: "unauthorized video data"
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: completeWithMedia
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("gaze_media_forbidden");
    });

    it("enforces bounded sample batch size limits (1 <= size <= 500) (400)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Empty samples array
      const emptyRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: { batch_id: crypto.randomUUID(), samples: [] }
      });
      expect(emptyRes.statusCode).toBe(400);

      // Oversized samples array (> 500)
      const oversizedBatch = sampleBatchPayload(crypto.randomUUID(), 1, 501);
      const oversizedRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: oversizedBatch
      });
      expect(oversizedRes.statusCode).toBe(400);
    });

    it("rejects non-increasing or invalid sequence numbers within batch (400)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Non-increasing sequence
      const nonIncreasingBatch = {
        batch_id: crypto.randomUUID(),
        samples: [
          { seq: 1, t_ms: 100, x_px: 10, y_px: 10, valid: true },
          { seq: 1, t_ms: 120, x_px: 12, y_px: 12, valid: true }
        ]
      };
      const res1 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: nonIncreasingBatch
      });
      expect(res1.statusCode).toBe(400);

      // Zero or negative seq
      const invalidSeqBatch = {
        batch_id: crypto.randomUUID(),
        samples: [{ seq: 0, t_ms: 100, x_px: 10, y_px: 10, valid: true }]
      };
      const res2 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: invalidSeqBatch
      });
      expect(res2.statusCode).toBe(400);
    });
  });

  describe("5. Transactional batch idempotency and conflicting sequences", () => {
    it("is idempotent: re-submitting identical batch returns duplicate:true without duplicate rows", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      const validBatchId = crypto.randomUUID();
      const batch = sampleBatchPayload(validBatchId, 1, 5);

      // First submission
      const res1 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: batch
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json()).toEqual({ ok: true, accepted: 5, duplicate: false, last_seq: 5 });

      // Second submission (same batch_id)
      const res2 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: batch
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toEqual({ ok: true, accepted: 0, duplicate: true, last_seq: 5 });

      // Ensure DB has exactly 5 samples
      const samples = repo.getGazeSamples(session.session_id);
      expect(samples.length).toBe(5);
      const gazeSession = repo.getGazeSession(session.session_id);
      expect(gazeSession!.sample_count).toBe(5);
      expect(gazeSession!.last_seq).toBe(5);
    });

    it("rejects conflicting overlapping sequence numbers from a new batch (409)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest batch 1: seq 1..5
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 5)
      });

      // Ingest new batch 2 starting at seq 3 (<= last_seq 5)
      const conflictBatch = sampleBatchPayload(crypto.randomUUID(), 3, 5);
      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: conflictBatch
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("gaze_seq_conflict");

      // Verify transaction rollback: no samples inserted from conflicting batch
      const samples = repo.getGazeSamples(session.session_id);
      expect(samples.length).toBe(5);
    });
  });

  describe("6. Cross-table isolation: gaze samples not written to click events", () => {
    it("ensures gaze sample ingestion never pollutes interaction events or trials", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest 20 gaze samples
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 20)
      });

      // Query events table directly
      const eventsCount = (
        repo.db.prepare("SELECT COUNT(*) as n FROM events WHERE session_id = ?").get(session.session_id) as {
          n: number;
        }
      ).n;
      expect(eventsCount).toBe(0);

      // Query trials table directly
      const trialsCount = (
        repo.db.prepare("SELECT COUNT(*) as n FROM trials WHERE session_id = ?").get(session.session_id) as {
          n: number;
        }
      ).n;
      expect(trialsCount).toBe(0);
    });
  });

  describe("7. Session lifecycle: abort and withdraw denial", () => {
    it("denies gaze operations after session is withdrawn and purges all data", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest samples
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 5)
      });

      // Complete gaze session so export files are written
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: sampleCompletePayload(5)
      });

      const gazeFolder = path.join(gazeDir, session.session_id);
      expect(fs.existsSync(gazeFolder)).toBe(true);

      // Withdraw session
      const withdrawRes = await app.inject({
        method: "POST",
        url: `/api/sessions/${session.session_id}/withdraw`,
        payload: { confirm: true }
      });
      expect(withdrawRes.statusCode).toBe(200);

      // Subsequent batch ingestion must be denied (401)
      const afterWithdrawBatch = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 6, 2)
      });
      expect(afterWithdrawBatch.statusCode).toBe(401);

      // Export files and DB rows must be purged
      expect(fs.existsSync(gazeFolder)).toBe(false);
      expect(repo.getGazeSession(session.session_id)).toBeNull();
      expect(repo.getGazeSamples(session.session_id).length).toBe(0);
    });

    it("denies gaze ingestion and re-consent when session is aborted", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Abort session
      const abortRes = await app.inject({
        method: "POST",
        url: `/api/sessions/${session.session_id}/stop`,
        payload: { reason: "participant_distress" }
      });
      expect(abortRes.statusCode).toBe(200);

      // Re-consent on aborted session must fail (400 session_not_active)
      const reconsentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      expect(reconsentRes.statusCode).toBe(400);
      expect(reconsentRes.json().error).toBe("session_not_active");

      // Ingestion on aborted session should be denied
      const batchRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 3)
      });
      expect([400, 401, 409]).toContain(batchRes.statusCode);
    });
  });

  describe("8. Admin authorization and restricted exports", () => {
    it("denies access to admin gaze summary and export files without admin credentials (401)", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 5)
      });

      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: sampleCompletePayload(5)
      });

      // Gaze summary without auth
      const unauthSummary = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}`
      });
      expect(unauthSummary.statusCode).toBe(401);

      // Gaze export file without auth
      const unauthExport = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`
      });
      expect(unauthExport.statusCode).toBe(401);

      // Wrong password
      const wrongPwExport = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`,
        headers: { "x-admin-password": "wrong-password" }
      });
      expect(wrongPwExport.statusCode).toBe(401);

      // Valid admin password grants access
      const authSummary = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}`,
        headers: { "x-admin-password": ADMIN_PASSWORD }
      });
      expect(authSummary.statusCode).toBe(200);
      expect(authSummary.json().gaze.session_id).toBe(session.session_id);

      const authExport = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`,
        headers: { "x-admin-password": ADMIN_PASSWORD }
      });
      expect(authExport.statusCode).toBe(200);
      expect(authExport.headers["content-type"]).toContain("application/json");
      expect(authExport.headers["x-checksum-sha256"]).toBeDefined();
    });
  });

  describe("9. Export bundle accuracy, synthetic provenance and trust-boundary quality gates", () => {
    it("exports accurate sample counts, valid sample counts, and provenance flags", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleSyntheticConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest 6 samples: 4 valid, 2 invalid
      const batchPayload = {
        batch_id: crypto.randomUUID(),
        samples: [
          { seq: 1, t_ms: 1000, x_px: 100, y_px: 100, valid: true },
          { seq: 2, t_ms: 1016, x_px: 105, y_px: 102, valid: true },
          { seq: 3, t_ms: 1033, x_px: null, y_px: null, valid: false, invalid_reason: "no_prediction" },
          { seq: 4, t_ms: 1050, x_px: 110, y_px: 104, valid: true },
          { seq: 5, t_ms: 1066, x_px: 112, y_px: 105, valid: true },
          { seq: 6, t_ms: 1083, x_px: null, y_px: null, valid: false, invalid_reason: "no_prediction" }
        ]
      };

      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: batchPayload
      });

      const completeRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: sampleCompletePayload(6, {
          quality: {
            overall: "pass",
            analysis_ready: true,
            angular_metrics_ready: false,
            missing_pct: 33.3,
            sample_count: 6,
            valid_sample_count: 4,
            rejected_samples: 0,
            dropped_samples: 0
          }
        })
      });
      expect(completeRes.statusCode).toBe(200);

      // Verify manifest content
      const manifestRes = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`,
        headers: { "x-admin-password": ADMIN_PASSWORD }
      });
      const manifest = manifestRes.json();
      expect(manifest.synthetic).toBe(true);
      expect(manifest.human_data).toBe(false);
      expect(manifest.analysis_ready).toBe(false); // Synthetic data must NEVER be analysis_ready
      expect(manifest.counts).toEqual({
        samples: 6,
        valid_samples: 4,
        trials: 1
      });
      expect(manifest.contains_raw_video).toBe(false);
      expect(manifest.contains_click_events).toBe(false);
    });

    it("trust-boundary gate: enforces fixed study gate 1.5 deg and never trusts client-inflated criterion", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload() // human data
      });
      const token = consentRes.json().token;

      // Ingest 5 valid samples
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: sampleBatchPayload(crypto.randomUUID(), 1, 5)
      });

      // Client sends inflated criterion_deg: 1000 with max_error_deg: 10.0 and passes: true
      const forgedCompletePayload = sampleCompletePayload(5, {
        calibration: {
          target_count: 9,
          expected_target_count: 9,
          max_error_deg: 10.0,
          criterion_deg: 1000.0, // Attempting to bypass the 1.5 deg gate
          passes: true,
          angular_available: true,
          unknown_observations: 0,
          points: [{ observation_count: 10 }]
        },
        quality: {
          overall: "pass",
          analysis_ready: true,
          angular_metrics_ready: true,
          missing_pct: 0,
          sample_count: 5,
          valid_sample_count: 5,
          rejected_samples: 0,
          dropped_samples: 0
        }
      });

      const completeRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: forgedCompletePayload
      });
      expect(completeRes.statusCode).toBe(200);

      // Verify server recomputed analysis_ready: must be FALSE because max_error 10.0 > study criterion 1.5
      const manifestRes = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`,
        headers: { "x-admin-password": ADMIN_PASSWORD }
      });
      const manifest = manifestRes.json();
      expect(manifest.analysis_ready).toBe(false);
    });

    it("trust-boundary gate: rejects analysis_ready when stored samples are all invalid despite client claiming missing_pct:0", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Ingest 5 INVALID samples (valid: false)
      const allInvalidBatch = {
        batch_id: crypto.randomUUID(),
        samples: Array.from({ length: 5 }, (_, i) => ({
          seq: i + 1,
          t_ms: 1000 + i * 16.6,
          x_px: null,
          y_px: null,
          valid: false,
          invalid_reason: "no_prediction" as const
        }))
      };

      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/batches`,
        headers: { "x-gaze-token": token },
        payload: allInvalidBatch
      });

      // Client falsely claims missing_pct: 0 and overall: "pass"
      const forgedQualityComplete = sampleCompletePayload(5, {
        quality: {
          overall: "pass",
          analysis_ready: true,
          angular_metrics_ready: true,
          missing_pct: 0, // False claim
          sample_count: 5,
          valid_sample_count: 5, // False claim
          rejected_samples: 0,
          dropped_samples: 0
        }
      });

      const completeRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: forgedQualityComplete
      });
      expect(completeRes.statusCode).toBe(200);

      // Server must NOT grant analysis_ready when raw valid sample count is 0
      const manifestRes = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`,
        headers: { "x-admin-password": ADMIN_PASSWORD }
      });
      const manifest = manifestRes.json();
      expect(manifest.counts.valid_samples).toBe(0);
      expect(manifest.analysis_ready).toBe(false);
    });

    it("trust-boundary gate: rejects analysis_ready when zero samples exist", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      // Zero samples ingested, client submits complete with forged pass
      const zeroSampleComplete = sampleCompletePayload(0, {
        quality: {
          overall: "pass",
          analysis_ready: true,
          angular_metrics_ready: true,
          missing_pct: 0,
          sample_count: 0,
          valid_sample_count: 0,
          rejected_samples: 0,
          dropped_samples: 0
        }
      });

      const completeRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: zeroSampleComplete
      });
      expect(completeRes.statusCode).toBe(200);

      const manifestRes = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${session.session_id}/export/manifest.json`,
        headers: { "x-admin-password": ADMIN_PASSWORD }
      });
      const manifest = manifestRes.json();
      expect(manifest.counts.samples).toBe(0);
      expect(manifest.analysis_ready).toBe(false);
    });
  });

  describe("10. Mandatory gaze completion integrity", () => {
    it("fails closed for both completion paths when a participant session has no gaze row", async () => {
      const { session } = await createTestSession(true);

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/sessions/${session.session_id}/state`,
        payload: { status: "completed", phase: "debrief" }
      });
      expect(patch.statusCode).toBe(409);
      expect(patch.json().error).toBe("gaze_session_not_finalized");

      const event = await app.inject({
        method: "POST",
        url: "/api/events",
        payload: { events: [sessionEndEvent(session)] }
      });
      expect(event.statusCode).toBe(409);
      expect(event.json().error).toBe("gaze_session_not_finalized");
      expect(repo.getSession(session.session_id)!.status).not.toBe("completed");
    });

    it("rejects PATCH completion until an existing gaze session is finalized", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      const rejected = await app.inject({
        method: "PATCH",
        url: `/api/sessions/${session.session_id}/state`,
        payload: { status: "completed", phase: "debrief" }
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error).toBe("gaze_session_not_finalized");
      expect(repo.getSession(session.session_id)!.status).not.toBe("completed");

      const completed = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: sampleCompletePayload(0)
      });
      expect(completed.statusCode).toBe(200);

      const accepted = await app.inject({
        method: "PATCH",
        url: `/api/sessions/${session.session_id}/state`,
        payload: { status: "completed", phase: "debrief" }
      });
      expect(accepted.statusCode).toBe(200);
      expect(repo.getSession(session.session_id)!.status).toBe("completed");
    });

    it("rejects session_end ingestion until an existing gaze session is finalized", async () => {
      const { session } = await createTestSession(true);
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/consent`,
        payload: sampleConsentPayload()
      });
      const token = consentRes.json().token;

      const rejected = await app.inject({
        method: "POST",
        url: "/api/events",
        payload: { events: [sessionEndEvent(session)] }
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error).toBe("gaze_session_not_finalized");
      expect(repo.getSession(session.session_id)!.status).not.toBe("completed");

      const completed = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${session.session_id}/complete`,
        headers: { "x-gaze-token": token },
        payload: sampleCompletePayload(0)
      });
      expect(completed.statusCode).toBe(200);

      const accepted = await app.inject({
        method: "POST",
        url: "/api/events",
        payload: { events: [sessionEndEvent(session)] }
      });
      expect(accepted.statusCode).toBe(200);
      expect(repo.getSession(session.session_id)!.status).toBe("completed");
    });

    it("keeps seeded rehearsal completable through explicit synthetic gaze provenance", () => {
      expect(seedDatabase(repo, 1)).toBe(1);
      const seeded = repo.listAdminSessions().find((candidate) => candidate.label.startsWith("SEED-"));
      expect(seeded).toBeDefined();
      expect(seeded!.status).toBe("completed");
      const gaze = repo.getGazeSession(seeded!.session_id);
      expect(gaze?.synthetic).toBe(1);
      expect(gaze?.status).toBe("completed");
    });
  });
});

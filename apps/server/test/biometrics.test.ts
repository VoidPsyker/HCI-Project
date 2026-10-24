import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { Repository } from "../src/repository";
import { createServer } from "../src/server";

function createTmpDirs() {
  const base = path.join(os.tmpdir(), `meridian-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const rawDir = path.join(base, "raw");
  const gazeDir = path.join(base, "gaze");
  const webDist = path.join(base, "dist");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(gazeDir, { recursive: true });
  fs.mkdirSync(webDist, { recursive: true });
  return { base, rawDir, gazeDir, webDist };
}

const VIEWPORT = { width_px: 1920, height_px: 1080 };
const GEOMETRY = {
  width_px: 1920,
  height_px: 1080,
  width_mm: 530,
  height_mm: 300,
  viewing_distance_mm: 600
};
const WEBCAM_SOURCE = {
  kind: "webcam" as const,
  adapter: "webgazer",
  device: "Integrated Webcam",
  nominal_hz: 60,
  hardware_backed: false,
  synthetic: false,
  capabilities: ["gaze" as const, "screen_geometry" as const]
};

describe("Biometric Gaze Server Integration", () => {
  let tmpDirs: ReturnType<typeof createTmpDirs>;
  let repo: Repository;
  let app: FastifyInstance;
  const ADMIN_PW = "test-pilot-admin";

  beforeEach(async () => {
    tmpDirs = createTmpDirs();
    repo = new Repository(":memory:", tmpDirs.rawDir, "test-seed-2026", tmpDirs.gazeDir);
    app = await createServer(repo, { adminPassword: ADMIN_PW, webDist: tmpDirs.webDist });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDirs.base, { recursive: true, force: true });
  });

  function setupParticipantAndSession() {
    const created = repo.createSession("P001");
    const sessionId = created.session.session_id;
    return { sessionId, participantId: created.session.participant_id };
  }

  describe("Gaze Consent", () => {
    it("rejects gaze consent if session does not exist", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gaze/sessions/nonexistent/consent",
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "session_not_found" });
    });

    it("rejects gaze consent if participant has not consented to core study", async () => {
      const { sessionId } = setupParticipantAndSession();
      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: "core_consent_required" });
    });

    it("rejects gaze consent containing forbidden raw video or image fields", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");

      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE,
          raw_video: "smuggled-video-base64"
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "gaze_media_forbidden", field: "raw_video" });
    });

    it("records valid consent and generates an ingestion token", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");

      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.ok).toBe(true);
      expect(data.session_id).toBe(sessionId);
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe("string");
      expect(data.token.length).toBeGreaterThan(20);
      expect(data.consent).toMatchObject({
        version: "gaze-1.0",
        scope: "eye_tracking_only",
        camera_used: true,
        raw_video_retention: false,
        separate_from_core_consent: true
      });

      // Verify token hash is saved in DB, but raw token is never stored in plain text
      const row = repo.getGazeSession(sessionId);
      expect(row).toBeDefined();
      expect(row!.token_hash).toBeDefined();
      expect(row!.token_hash).not.toBe(data.token);
    });

    it("rejects unauthorized re-consent attempts without the existing token", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");

      // First consent
      const res1 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      expect(res1.statusCode).toBe(200);

      // Attempt second consent without token
      const res2 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-2.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      expect(res2.statusCode).toBe(401);
      expect(res2.json()).toMatchObject({ error: "gaze_unauthorized" });

      // Attempt second consent with wrong token
      const res3 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        headers: { "x-gaze-token": "wrong-token-abc" },
        payload: {
          version: "gaze-2.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      expect(res3.statusCode).toBe(401);
      expect(res3.json()).toMatchObject({ error: "gaze_unauthorized" });
    });
  });

  describe("Batch Ingestion & Idempotency", () => {
    it("requires valid x-gaze-token header for batch ingestion", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });

      // No token
      const res1 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        payload: {
          batch_id: "e576082f-2d63-4a6c-94da-448c5b057790",
          samples: [{ seq: 1, t_ms: 10, x_px: 100, y_px: 200, valid: true }]
        }
      });
      expect(res1.statusCode).toBe(401);
      expect(res1.json()).toMatchObject({ error: "gaze_token_invalid" });

      // Bad token
      const res2 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": "invalid-token" },
        payload: {
          batch_id: "e576082f-2d63-4a6c-94da-448c5b057790",
          samples: [{ seq: 1, t_ms: 10, x_px: 100, y_px: 200, valid: true }]
        }
      });
      expect(res2.statusCode).toBe(401);
      expect(res2.json()).toMatchObject({ error: "gaze_token_invalid" });
    });

    it("ingests batches idempotently and stores gaze separately from click events", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      const token = consentRes.json().token;

      const batchPayload = {
        batch_id: "9781878b-d5a2-4a0b-8d1e-e28a52aa311a",
        samples: [
          { seq: 1, t_ms: 10, x_px: 500, y_px: 400, valid: true, trial_id: "trial-1" },
          { seq: 2, t_ms: 20, x_px: 502, y_px: 401, valid: true, trial_id: "trial-1" },
          { seq: 3, t_ms: 30, x_px: null, y_px: null, valid: false, invalid_reason: "no_prediction", trial_id: "trial-1" }
        ]
      };

      // First ingestion
      const res1 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: batchPayload
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json()).toMatchObject({ ok: true, accepted: 3, duplicate: false, last_seq: 3 });

      // Verify gaze samples are stored in gaze_samples, and events table has 0 rows
      const storedSamples = repo.getGazeSamples(sessionId);
      expect(storedSamples).toHaveLength(3);
      expect(storedSamples[0]!.seq).toBe(1);
      expect(storedSamples[0]!.x_px).toBe(500);

      const events = repo.getSessionEvents(sessionId);
      expect(events).toHaveLength(0); // Click event store preserved untouched!

      // Repeated ingestion of the same batch_id is deduplicated idempotently
      const res2 = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: batchPayload
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toMatchObject({ ok: true, accepted: 0, duplicate: true, last_seq: 3 });

      // Samples in DB did not duplicate
      expect(repo.getGazeSamples(sessionId)).toHaveLength(3);
    });

    it("rejects configuration mutation once samples exist", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      const token = consentRes.json().token;

      // Ingest a sample
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: {
          batch_id: "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
          samples: [{ seq: 1, t_ms: 10, x_px: 500, y_px: 400, valid: true }]
        }
      });

      // Attempt to re-consent with altered viewport / geometry
      const res = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        headers: { "x-gaze-token": token },
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: { width_px: 1280, height_px: 720 },
          geometry: { ...GEOMETRY, width_px: 1280, height_px: 720 },
          source: WEBCAM_SOURCE
        }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: "gaze_configuration_immutable" });
    });
  });

  describe("Session Abort and Withdrawal Access Control", () => {
    it("denies gaze batch uploads when session is aborted by admin", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      const token = consentRes.json().token;

      // Admin aborts the session
      const abortRes = await app.inject({
        method: "POST",
        url: `/api/admin/sessions/${sessionId}/abort`,
        headers: { "x-admin-password": ADMIN_PW },
        payload: { reason: "participant_distress" }
      });
      expect(abortRes.statusCode).toBe(200);

      // Subsequent batch upload is refused
      const batchRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: {
          batch_id: "b2b2b2b2-c3c3-d4d4-e5e5-f6f6f6f6f6f6",
          samples: [{ seq: 1, t_ms: 10, x_px: 500, y_px: 400, valid: true }]
        }
      });
      expect(batchRes.statusCode).toBe(401);
      expect(batchRes.json()).toMatchObject({ error: "gaze_token_invalid" });
    });

    it("destroys all in-memory and disk gaze data on withdrawal and denies further uploads", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      const token = consentRes.json().token;

      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: {
          batch_id: "c3c3c3c3-d4d4-e5e5-f6f6-a7a7a7a7a7a7",
          samples: [{ seq: 1, t_ms: 10, x_px: 500, y_px: 400, valid: true }]
        }
      });
      expect(repo.getGazeSamples(sessionId)).toHaveLength(1);

      // Participant withdraws
      repo.withdrawSession(sessionId);

      // Data is deleted from DB
      expect(repo.getGazeSession(sessionId)).toBeNull();
      expect(repo.getGazeSamples(sessionId)).toHaveLength(0);

      // Subsequent batch upload is refused
      const batchRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: {
          batch_id: "d4d4d4d4-e5e5-f6f6-a7a7-b8b8b8b8b8b8",
          samples: [{ seq: 2, t_ms: 20, x_px: 500, y_px: 400, valid: true }]
        }
      });
      expect(batchRes.statusCode).toBe(401);
      expect(batchRes.json()).toMatchObject({ error: "gaze_token_invalid" });
    });
  });

  describe("Session Completion and Restricted Admin Export", () => {
    it("completes session, writes restricted files to disk, and protects them with admin auth", async () => {
      const { sessionId } = setupParticipantAndSession();
      repo.recordConsent(sessionId, "core-1.0");
      const consentRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/consent`,
        payload: {
          version: "gaze-1.0",
          camera_used: true,
          synthetic: false,
          viewport: VIEWPORT,
          geometry: GEOMETRY,
          source: WEBCAM_SOURCE
        }
      });
      const token = consentRes.json().token;

      // Ingest 2 samples
      await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: {
          batch_id: "e5e5e5e5-f6f6-a7a7-b8b8-c9c9c9c9c9c9",
          samples: [
            { seq: 1, t_ms: 100, x_px: 500, y_px: 500, valid: true, trial_id: "trial-1" },
            { seq: 2, t_ms: 200, x_px: 505, y_px: 505, valid: true, trial_id: "trial-1" }
          ]
        }
      });

      const completePayload = {
        calibration: {
          target_count: 9,
          expected_target_count: 9,
          repetitions_per_target: 5,
          unknown_observations: 0,
          points: [],
          mean_error_px: 12.5,
          max_error_px: 20.1,
          mean_error_deg: 0.8,
          max_error_deg: 1.2,
          angular_available: true,
          criterion_deg: 1.5,
          passes: true,
          note: "Held-out validation pass"
        },
        quality: {
          overall: "pass",
          analysis_ready: true,
          angular_metrics_ready: true,
          sample_count: 2,
          valid_sample_count: 2,
          missing_pct: 0,
          effective_sample_rate_hz: 10,
          median_sample_interval_ms: 100,
          dropout_count: 0,
          dropout_ms: 0,
          longest_gap_ms: 100,
          coverage_pct: 100,
          rejected_samples: 0,
          dropped_samples: 0,
          thresholds: {
            calibration_points: 9,
            calibration_error_deg: 1.5,
            missing_pct: 20,
            minimum_sample_rate_hz: null,
            max_clock_residual_ms: null
          },
          checks: [],
          exclusions: []
        },
        metrics: [
          {
            trial_id: "trial-1",
            menu_id: "A",
            start_ms: 100,
            end_ms: 200,
            sample_count: 2,
            valid_sample_count: 2,
            missing_pct: 0,
            fixation_count: 1,
            total_fixation_ms: 100,
            first_fixation_ms: 100,
            mean_fixation_ms: 100,
            saccade_count: 0,
            mean_saccade_amplitude_deg: null,
            time_to_first_target_fixation_ms: 100,
            time_to_first_target_entry_ms: 100,
            target_dwell_ms: 100,
            target_fixation_count: 1,
            target_revisits: 0,
            aoi_entries: 1,
            aoi_distribution: {},
            aoi_timelines: []
          }
        ],
        clock: {
          method: "capture_clock",
          samples: 0,
          slope: 1,
          intercept_ms: 0,
          residual_ms: null,
          synchronized: true
        },
        max_samples: 500000,
        rejected_samples: 0,
        dropped_samples: 0
      };

      const completeRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/complete`,
        headers: { "x-gaze-token": token },
        payload: completePayload
      });
      expect(completeRes.statusCode).toBe(200);
      const completeData = completeRes.json();
      expect(completeData.ok).toBe(true);
      expect(completeData.sample_count).toBe(2);
      expect(completeData.manifest).toMatchObject({
        schema: "meridian.gaze/1",
        contains_click_events: false,
        contains_raw_video: false,
        restricted_access: true
      });

      // Cannot ingest after completion
      const lateBatchRes = await app.inject({
        method: "POST",
        url: `/api/gaze/sessions/${sessionId}/batches`,
        headers: { "x-gaze-token": token },
        payload: {
          batch_id: "f6f6f6f6-a7a7-b8b8-c9c9-d0d0d0d0d0d0",
          samples: [{ seq: 3, t_ms: 300, x_px: 500, y_px: 500, valid: true }]
        }
      });
      expect(lateBatchRes.statusCode).toBe(401); // Completed sessions are sealed against further mutation

      // Unauthenticated admin export is blocked
      const unauthExport = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${sessionId}/export/manifest.json`
      });
      expect(unauthExport.statusCode).toBe(401);

      // Authenticated admin export succeeds
      const authExport = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${sessionId}/export/manifest.json`,
        headers: { "x-admin-password": ADMIN_PW }
      });
      expect(authExport.statusCode).toBe(200);
      const manifest = authExport.json();
      expect(manifest.schema).toBe("meridian.gaze/1");
      expect(manifest.contains_click_events).toBe(false);
      expect(manifest.contains_raw_video).toBe(false);

      // Gaze samples export
      const samplesExport = await app.inject({
        method: "GET",
        url: `/api/admin/gaze/sessions/${sessionId}/export/gaze_samples.jsonl`,
        headers: { "x-admin-password": ADMIN_PW }
      });
      expect(samplesExport.statusCode).toBe(200);
      const lines = samplesExport.body.trim().split("\n");
      expect(lines).toHaveLength(2);
      const firstLine = JSON.parse(lines[0]!);
      expect(firstLine.seq).toBe(1);
      expect(firstLine.x_px).toBe(500);
    });
  });
});

import { randomUUID } from "node:crypto";
import { createServer } from "../src/server";
import { createVercelProxy, studyBackendOrigin } from "../src/vercel-proxy";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventInput } from "@meridian/scoring";
import { Repository } from "../src/repository";

let repo: Repository;
let directory: string;
let event: EventInput;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-persistence-"));
  repo = new Repository(":memory:", path.join(directory, "raw"), "test", path.join(directory, "gaze"));
  const { session } = repo.createSession();
  event = { event_id: "event-1", session_id: session.session_id, participant_id: session.participant_id,
    study: "pilot", event_type: "session_start", state_label: "mixed", condition: "static",
    t_client: 0, input_type: "mouse", meta: {}, block_id: null, trial_id: null, task_id: null,
    target_id: null, menu_id: null, elapsed_ms: null, level: null, element_id: null,
    element_label: null, parent_id: null, x: null, y: null };
});
afterEach(() => {
  vi.restoreAllMocks();
  repo.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it("repairs a failed raw archive on idempotent retry", () => {
  vi.spyOn(fs, "appendFileSync").mockImplementationOnce(() => { throw new Error("disk unavailable"); });
  expect(() => repo.insertEvents([event])).toThrow("disk unavailable");
  expect(repo.allEvents()).toHaveLength(1);
  repo.insertEvents([event]);
  const raw = fs.readFileSync(path.join(directory, "raw", event.session_id + ".jsonl"), "utf8");
  expect(raw.trim().split("\n").map((line) => JSON.parse(line).event_id)).toEqual([event.event_id]);
});

it("rolls back events when trial scoring fails, allowing a complete retry", () => {
  event.trial_id = "trial-1";
  vi.spyOn(repo, "recomputeTrial").mockImplementationOnce(() => { throw new Error("scoring failed"); });
  expect(() => repo.insertEvents([event])).toThrow("scoring failed");
  expect(repo.allEvents()).toHaveLength(0);
  repo.insertEvents([event]);
  expect(repo.allEvents()).toHaveLength(1);
});

it.each(["consent_declined", "calibration_failed", "camera_unavailable", "viewport_changed"])(
  "records core completion with the explicit gaze outcome %s",
  (reason) => {
    const unavailable: EventInput = { ...event, event_type: "gaze_unavailable", meta: { reason } };
    const end: EventInput = { ...event, event_id: "end-1", event_type: "session_end" };
    expect(repo.insertEvents([unavailable, end]).accepted).toBe(2);
    expect(repo.getSession(event.session_id)?.status).toBe("completed");
    expect(repo.getGazeSession(event.session_id)).toBeNull();
  }
);

it("requires finalized gaze or an allowed outcome recorded for the same session", () => {
  const other = repo.createSession().session;
  repo.insertEvents([
    { ...event, event_type: "gaze_unavailable", meta: { reason: "unrecognized_reason" } },
    { ...event, event_id: "other", session_id: other.session_id, participant_id: other.participant_id,
      event_type: "gaze_unavailable", meta: { reason: "consent_declined" } }
  ]);
  const end: EventInput = { ...event, event_id: "end-1", event_type: "session_end" };
  expect(() => repo.insertEvents([end])).toThrow("gaze_session_not_finalized");
  expect(() => repo.completeSession(event.session_id)).toThrow("gaze_session_not_finalized");
  expect(repo.completeSession(other.session_id).status).toBe("completed");
});

it("records a time-limited session as aborted rather than completed", () => {
  event.event_type = "session_end";
  event.meta = { completed: false, abort_reason: "session_time_limit" };
  repo.insertEvents([event]);
  expect(repo.getSession(event.session_id)).toMatchObject({ status: "aborted", abort_reason: "session_time_limit" });
});


it("keeps proxied sessions and click exports after the study server restarts", async () => {
  const dbPath = path.join(directory, "study.sqlite");
  const openRepo = () => new Repository(dbPath, path.join(directory, "hosted-raw"), "test");
  const admin = { "x-admin-password": "test-researcher-password" };
  const backend = openRepo();
  const app = await createServer(backend, { adminPassword: admin["x-admin-password"] });
  const origin = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  const proxy = await createVercelProxy(origin);
  try {
    const created = await proxy.inject({ method: "POST", url: "/api/admin/sessions", headers: admin, payload: {} });
    expect(created.statusCode).toBe(200);
    const { session } = created.json();
    const trialId = session.session_id + "-B1-T1";
    const click = { ...event, event_id: randomUUID(), session_id: session.session_id,
      participant_id: session.participant_id, event_type: "node_click", trial_id: trialId,
      menu_id: "A", target_id: "watch-1", element_id: "sport", element_label: "Sport" };
    const end = { ...click, event_id: randomUUID(), event_type: "trial_end", t_client: 500 };
    const saved = await proxy.inject({ method: "POST", url: "/api/events",
      headers: { "content-type": "text/plain" }, payload: JSON.stringify({ events: [click, end] }) });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().accepted).toBe(2);
  } finally {
    await proxy.close();
    await app.close();
    backend.close();
  }

  const reopened = openRepo();
  const restarted = await createServer(reopened, { adminPassword: admin["x-admin-password"] });
  const restartedProxy = await createVercelProxy(new URL(await restarted.listen({ host: "127.0.0.1", port: 0 })));
  try {
    const sessions = await restartedProxy.inject({ url: "/api/admin/sessions", headers: admin });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.headers["cache-control"]).toBe("private, no-store");
    expect(sessions.json().sessions).toMatchObject([{ event_count: 2, trial_count: 1 }]);
    const clicks = await restartedProxy.inject({ url: "/api/admin/export/events.csv", headers: admin });
    expect(clicks.statusCode).toBe(200);
    expect(clicks.headers["content-disposition"]).toContain("events.csv");
    expect(clicks.body).toContain("node_click");
    expect(clicks.body).toContain("Sport");
  } finally {
    await restartedProxy.close();
    await restarted.close();
    reopened.close();
  }
});

it("requires a configured HTTPS backend for Vercel", () => {
  expect(() => studyBackendOrigin(undefined)).toThrow("STUDY_BACKEND_ORIGIN");
  expect(() => studyBackendOrigin("http://localhost:8787")).toThrow("STUDY_BACKEND_ORIGIN");
  expect(studyBackendOrigin("https://study.example").origin).toBe("https://study.example");
});

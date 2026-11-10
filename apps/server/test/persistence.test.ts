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

it("records a time-limited session as aborted rather than completed", () => {
  event.event_type = "session_end";
  event.meta = { completed: false, abort_reason: "session_time_limit" };
  repo.insertEvents([event]);
  expect(repo.getSession(event.session_id)).toMatchObject({ status: "aborted", abort_reason: "session_time_limit" });
});


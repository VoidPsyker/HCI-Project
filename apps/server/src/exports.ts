import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tasks } from "@meridian/taxonomy";
import { manipulationCheckPassed, reportedState, type AffectRatings } from "@meridian/scoring";
import type { Repository } from "./repository";

export interface ExportFile {
  name: string;
  content: string;
  rows: number;
  sha256: string;
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (value: unknown): string => {
    const text = csvValue(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((c) => escape(row[c])).join(","))].join("\r\n") + "\r\n";
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function file(name: string, content: string, rows: number): ExportFile {
  return { name, content, rows, sha256: sha256(content) };
}

function eventRecord(row: ReturnType<Repository["allEvents"]>[number]) {
  let meta: unknown = {};
  try {
    meta = JSON.parse(row.meta_json);
  } catch {
    meta = {};
  }
  const { meta_json: _ignored, ...rest } = row;
  return { ...rest, meta };
}

export function buildExportBundle(repo: Repository): ExportFile[] {
  const rawCheckins = repo.allCheckins();
  const inductionCheckins = new Map(rawCheckins
    .filter((row) => row.meta.phase === "post_induction" && row.block_id !== null)
    .map((row) => [`${row.session_id}:${row.block_id}`, row]));
  const events = repo.allEvents().map(eventRecord);
  const startedSessions = new Set(events.filter((row) => row.event_type === "session_start").map((row) => row.session_id));
  const syntheticSessions = new Set(events.filter((row) =>
    row.event_type === "session_start" && row.meta !== null && typeof row.meta === "object" &&
    (row.meta as Record<string, unknown>).synthetic === true
  ).map((row) => row.session_id));
  const synthetic = (sessionId: string) => startedSessions.has(sessionId) ? syntheticSessions.has(sessionId) : null;
  const eventColumns = [
    "event_id",
    "participant_id",
    "session_id",
    "study",
    "block_id",
    "trial_id",
    "task_id",
    "target_id",
    "menu_id",
    "state_label",
    "condition",
    "event_type",
    "t_client",
    "t_server",
    "elapsed_ms",
    "level",
    "element_id",
    "element_label",
    "parent_id",
    "x",
    "y",
    "input_type",
    "meta"
  ];
  const trials = repo.allTrials().map((t) => {
    const checkin = inductionCheckins.get(`${t.session_id}:${t.block_id}`);
    const ratings = checkin?.meta as AffectRatings | undefined;
    return {
      ...t,
      synthetic: synthetic(t.session_id),
      reported_state: ratings ? reportedState(ratings) : null,
      manipulation_check_passed: ratings ? manipulationCheckPassed(t.state_label ?? "mixed", ratings) : null,
      path: t.path_json,
      first_click_ok: t.first_click_ok === null ? "" : t.first_click_ok
    };
  });
  const trialColumns = [
    "trial_id",
    "synthetic",
    "session_id",
    "participant_id",
    "block_id",
    "trial_index",
    "task_id",
    "task_description",
    "target_id",
    "menu_id",
    "state_label",
    "reported_state",
    "manipulation_check_passed",
    "condition",
    "difficulty",
    "practice",
    "success",
    "completion_time_ms",
    "elapsed_ms",
    "clicks",
    "wrong_department",
    "wrong_subcategory",
    "wrong_leaf",
    "backtracks",
    "category_switches",
    "path_efficiency",
    "first_click_ok",
    "first_click_element_id",
    "search_attempts",
    "timed_out",
    "gave_up",
    "trial_end_count",
    "missing_trial_start",
    "missing_trial_end",
    "event_count",
    "path"
  ];
  const checkins = rawCheckins.map((c) => {
    const ratings = c.meta as AffectRatings;
    return {
      event_id: c.event_id,
      synthetic: synthetic(c.session_id),
      session_id: c.session_id,
      participant_id: c.participant_id,
      block_id: c.block_id,
      state_label: c.state_label,
      t_server: c.t_server,
      valence: c.meta.valence ?? "",
      arousal: c.meta.arousal ?? "",
      happy: c.meta.happy ?? "",
      frustrated: c.meta.frustrated ?? "",
      confused: c.meta.confused ?? "",
      bored: c.meta.bored ?? "",
      distress: c.meta.distress ?? "",
      dominant_state: c.meta.dominant_state ?? "",
      reported_state: reportedState(ratings),
      manipulation_check_passed: manipulationCheckPassed(c.state_label, ratings),
      intensity: c.meta.intensity ?? "",
      fatigue: c.meta.fatigue ?? "",
      meta: c.meta
    };
  });
  const checkinColumns = [
    "event_id",
    "synthetic",
    "session_id",
    "participant_id",
    "block_id",
    "state_label",
    "t_server",
    "valence",
    "arousal",
    "happy",
    "frustrated",
    "confused",
    "bored",
    "distress",
    "dominant_state",
    "reported_state",
    "manipulation_check_passed",
    "intensity",
    "fatigue",
    "meta"
  ];
  const questionnaires = repo.allQuestionnaires();
  const questionColumns = [
    "response_id",
    "session_id",
    "block_id",
    "menu_id",
    "instrument",
    "item_id",
    "value",
    "text_value",
    "answered_at"
  ];
  const assignments = repo.allAssignments();
  const assignmentColumns = [
    "participant_id",
    "session_id",
    "sequence_index",
    "sequence_id",
    "stratum",
    "block_order",
    "menu_orders",
    "target_set",
    "colour_mapping",
    "seed_hash",
    "taxonomy_hash",
    "assigned_at",
    "design_json"
  ];
  const taskRows = tasks.map((t) => ({
    id: t.id,
    target_id: t.targetId,
    description: t.description,
    difficulty: t.difficulty,
    canonical: t.canonical,
    criteria: t.criteria
  }));
  const taskColumns = ["id", "target_id", "description", "difficulty", "canonical", "criteria"];

  return [
    file("events.jsonl", events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""), events.length),
    file("events.csv", toCsv(events, eventColumns), events.length),
    file("trials.csv", toCsv(trials, trialColumns), trials.length),
    file("checkins.csv", toCsv(checkins, checkinColumns), checkins.length),
    file("questionnaires.csv", toCsv(questionnaires, questionColumns), questionnaires.length),
    file("assignments.csv", toCsv(assignments, assignmentColumns), assignments.length),
    file("tasks.csv", toCsv(taskRows, taskColumns), taskRows.length)
  ];
}

export function writeExportBundle(repo: Repository, exportRoot: string): { directory: string; manifest: ExportFile } {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(exportRoot, stamp);
  fs.mkdirSync(directory, { recursive: true });
  const files = buildExportBundle(repo);
  for (const f of files) fs.writeFileSync(path.join(directory, f.name), f.content, "utf8");
  const manifest = {
    created_at: new Date().toISOString(),
    seed_hash: repo.getMeta("seed_hash"),
    taxonomy_hash: repo.getMeta("taxonomy_hash"),
    files: files.map((f) => ({ name: f.name, rows: f.rows, sha256: f.sha256 }))
  };
  const manifestFile = file("manifest.json", JSON.stringify(manifest, null, 2) + "\n", files.length);
  fs.writeFileSync(path.join(directory, manifestFile.name), manifestFile.content, "utf8");
  return { directory, manifest: manifestFile };
}

export function exportFile(repo: Repository, kind: string): ExportFile | null {
  const files = buildExportBundle(repo);
  if (kind === "manifest") {
    const manifest = {
      created_at: new Date().toISOString(),
      seed_hash: repo.getMeta("seed_hash"),
      taxonomy_hash: repo.getMeta("taxonomy_hash"),
      files: files.map((f) => ({ name: f.name, rows: f.rows, sha256: f.sha256 }))
    };
    return file("manifest.json", JSON.stringify(manifest, null, 2) + "\n", files.length);
  }
  return files.find((f) => f.name === kind) ?? null;
}

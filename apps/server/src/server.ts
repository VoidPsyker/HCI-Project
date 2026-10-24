import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import type { EventInput } from "@meridian/scoring";
import { config } from "./config";
import { Repository } from "./repository";
import {
  createSessionSchema,
  demographicsSchema,
  eventBatchSchema,
  findForbiddenMediaKey,
  gazeBatchSchema,
  gazeCompleteSchema,
  gazeConsentSchema,
  noteSchema,
  questionnaireBatchSchema,
  updateSessionSchema
} from "./validation";
import { buildExportBundle, exportFile } from "./exports";
import { buildGoNoGo, buildQaReport } from "./qa";

export interface ServerOptions {
  adminPassword?: string;
  webDist?: string;
  logger?: boolean;
}

type AdminRequest = FastifyRequest & { admin?: boolean };

function parseBody<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    reply.code(400).send({ error: "invalid_payload", issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}

function publicSession(session: ReturnType<Repository["getSession"]>) {
  if (!session) return null;
  return {
    session_id: session.session_id,
    participant_id: session.participant_id,
    study: session.study,
    status: session.status,
    phase: session.phase,
    created_at: session.created_at,
    started_at: session.started_at,
    ended_at: session.ended_at,
    abort_reason: session.abort_reason,
    sequence_id: session.sequence_id,
    target_set: session.target_set,
    colour_mapping: session.colour_mapping ? JSON.parse(session.colour_mapping) : null
  };
}

function publicDesign(design: ReturnType<Repository["getDesign"]>) {
  if (!design) return null;
  const { seed: _seed, seedHash: _seedHash, ...rest } = design;
  return rest;
}

function gazeToken(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-gaze-token"];
  return Array.isArray(raw) ? raw[0] : raw;
}

function rejectMedia(body: unknown, reply: FastifyReply): boolean {
  const found = findForbiddenMediaKey(body);
  if (!found) return false;
  reply.code(400).send({ error: "gaze_media_forbidden", field: found });
  return true;
}

export async function createServer(repo: Repository, options: ServerOptions = {}): Promise<FastifyInstance> {
  const adminPassword = options.adminPassword ?? config.adminPassword;
  const webDist = options.webDist ?? config.webDist;
  const app = Fastify({
    logger: options.logger ? { level: "warn" } : false,
    disableRequestLogging: true,
    bodyLimit: 5 * 1024 * 1024
  });

  await app.register(cors, { origin: true });
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error);
    }
  });

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.headers["x-admin-password"];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    const expected = adminPassword;
    const a = Buffer.from(provided ?? "");
    const b = Buffer.from(expected);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      reply.code(401).send({ error: "admin_password_required" });
      return;
    }
    (request as AdminRequest).admin = true;
  };

  app.get("/api/health", async () => ({
    ok: true,
    study: "pilot",
    seed_hash: repo.getMeta("seed_hash"),
    taxonomy_hash: repo.getMeta("taxonomy_hash"),
    time: new Date().toISOString()
  }));

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = repo.getSession(sessionId);
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const participant = repo.getParticipant(session.participant_id);
    return {
      session: publicSession(session),
      participant: participant
        ? { label: participant.label, consent_version: participant.consent_version, consented_at: participant.consented_at }
        : null,
      design: publicDesign(repo.getDesign(sessionId))
    };
  });

  app.get("/api/sessions/:sessionId/status", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = repo.getSession(sessionId);
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    return {
      status: session.status,
      phase: session.phase,
      abort_reason: session.abort_reason,
      ended_at: session.ended_at
    };
  });

  app.post("/api/sessions/:sessionId/consent", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(z.object({ version: z.string().min(1).max(40) }), request.body, reply);
    if (!body) return;
    try {
      const session = repo.recordConsent(sessionId, body.version);
      return { session: publicSession(session) };
    } catch (error) {
      return reply.code(400).send({ error: "consent_failed", message: (error as Error).message });
    }
  });

  app.post("/api/sessions/:sessionId/demographics", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(demographicsSchema, request.body, reply);
    if (!body) return;
    const session = repo.getSession(sessionId);
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const participant = repo.getParticipant(session.participant_id);
    if (!participant?.consented_at) return reply.code(409).send({ error: "consent_required" });
    try {
      const design = repo.assignDesign(sessionId, body);
      return { design: publicDesign(design), session: publicSession(repo.getSession(sessionId)) };
    } catch (error) {
      return reply.code(500).send({ error: "assignment_failed", message: (error as Error).message });
    }
  });

  app.patch("/api/sessions/:sessionId/state", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(updateSessionSchema, request.body, reply);
    if (!body) return;
    if (!repo.getSession(sessionId)) return reply.code(404).send({ error: "session_not_found" });
    if (body.status === "aborted" || body.status === "withdrawn") {
      return reply.code(400).send({ error: "use_stop_or_admin_endpoint" });
    }
    try {
      const session = repo.updateSession(sessionId, body);
      return { session: publicSession(session) };
    } catch (error) {
      if ((error as Error).message === "gaze_session_not_finalized") {
        return reply.code(409).send({ error: "gaze_session_not_finalized" });
      }
      throw error;
    }
  });

  app.post("/api/sessions/:sessionId/stop", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(z.object({ reason: z.string().max(500).optional() }), request.body ?? {}, reply);
    if (!body) return;
    if (!repo.getSession(sessionId)) return reply.code(404).send({ error: "session_not_found" });
    return { session: publicSession(repo.abortSession(sessionId, body.reason ?? "participant_stop")) };
  });

  app.post("/api/sessions/:sessionId/withdraw", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(z.object({ confirm: z.literal(true) }), request.body ?? {}, reply);
    if (!body) return;
    if (!repo.getSession(sessionId)) return reply.code(404).send({ error: "session_not_found" });
    repo.withdrawSession(sessionId);
    return { ok: true, withdrawn: sessionId };
  });

  app.post("/api/events", async (request, reply) => {
    const body = parseBody(eventBatchSchema, request.body, reply);
    if (!body) return;
    try {
      const events: EventInput[] = body.events.map((e) => ({
        ...e,
        block_id: e.block_id ?? null,
        trial_id: e.trial_id ?? null,
        task_id: e.task_id ?? null,
        target_id: e.target_id ?? null,
        menu_id: e.menu_id ?? null,
        elapsed_ms: e.elapsed_ms ?? null,
        level: e.level ?? null,
        element_id: e.element_id ?? null,
        element_label: e.element_label ?? null,
        parent_id: e.parent_id ?? null,
        x: e.x ?? null,
        y: e.y ?? null,
        meta: e.meta ?? {}
      }));
      const result = repo.insertEvents(events);
      return { ok: true, ...result };
    } catch (error) {
      const message = (error as Error).message;
      if (message === "gaze_session_not_finalized") {
        return reply.code(409).send({ error: "gaze_session_not_finalized" });
      }
      return reply.code(400).send({ error: "event_ingestion_failed", message });
    }
  });

  // Gaze ingestion is a separate modality with its own consent record, token,
  // tables and restricted export directory. It never writes into events.
  app.post("/api/gaze/sessions/:sessionId/consent", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (rejectMedia(request.body, reply)) return;
    const body = parseBody(gazeConsentSchema, request.body, reply);
    if (!body) return;
    try {
      const result = repo.createGazeConsent(
        sessionId,
        {
          version: body.version,
          camera_used: body.camera_used,
          synthetic: body.synthetic ?? false,
          viewport: body.viewport,
          geometry: body.geometry,
          source: body.source
        },
        gazeToken(request)
      );
      return {
        ok: true,
        session_id: sessionId,
        synthetic: result.session.synthetic === 1,
        token: result.token,
        consent: {
          version: result.session.consent_version,
          granted_at: result.session.consented_at,
          scope: "eye_tracking_only",
          camera_used: result.session.camera_used === 1,
          raw_video_retention: false,
          separate_from_core_consent: true
        }
      };
    } catch (error) {
      const message = (error as Error).message;
      const status =
        message === "session_not_found"
          ? 404
          : message === "gaze_unauthorized"
            ? 401
            : message === "core_consent_required" || message === "gaze_configuration_immutable"
              ? 409
              : message === "gaze_consent_synthetic_mismatch" || message === "gaze_session_completed" || message === "gaze_session_withdrawn" || message === "session_not_active"
                ? 400
                : 400;
      return reply.code(status).send({ error: message });
    }
  });

  app.post("/api/gaze/sessions/:sessionId/batches", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!repo.authorizeGaze(sessionId, gazeToken(request))) {
      return reply.code(401).send({ error: "gaze_token_invalid" });
    }
    if (rejectMedia(request.body, reply)) return;
    const body = parseBody(gazeBatchSchema, request.body, reply);
    if (!body) return;
    try {
      return { ok: true, ...repo.insertGazeBatch(sessionId, body) };
    } catch (error) {
      const message = (error as Error).message;
      const status =
        message === "gaze_session_not_found"
          ? 404
          : message === "gaze_seq_conflict" || message === "gaze_session_completed"
            ? 409
            : 400;
      return reply.code(status).send({ error: message });
    }
  });

  app.post("/api/gaze/sessions/:sessionId/complete", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!repo.authorizeGaze(sessionId, gazeToken(request))) {
      return reply.code(401).send({ error: "gaze_token_invalid" });
    }
    if (rejectMedia(request.body, reply)) return;
    const body = parseBody(gazeCompleteSchema, request.body, reply);
    if (!body) return;
    if (
      body.rejected_samples !== body.quality.rejected_samples ||
      body.dropped_samples !== body.quality.dropped_samples
    ) {
      return reply.code(400).send({ error: "gaze_retention_counts_mismatch" });
    }
    try {
      const result = repo.completeGazeSession(sessionId, body);
      return { ok: true, ...result };
    } catch (error) {
      const message = (error as Error).message;
      const status =
        message === "gaze_session_not_found"
          ? 404
          : message === "gaze_sample_count_mismatch" || message === "gaze_session_completed"
            ? 409
            : 400;
      return reply.code(status).send({ error: message });
    }
  });

  app.post("/api/questionnaires", async (request, reply) => {
    const body = parseBody(questionnaireBatchSchema, request.body, reply);
    if (!body) return;
    try {
      const count = repo.insertQuestionnaires(body.responses);
      return { ok: true, accepted: count };
    } catch (error) {
      return reply.code(400).send({ error: "questionnaire_ingestion_failed", message: (error as Error).message });
    }
  });

  app.post("/api/admin/sessions", { preHandler: requireAdmin }, async (request, reply) => {
    const body = parseBody(createSessionSchema, request.body ?? {}, reply);
    if (!body) return;
    const created = repo.createSession(body.label);
    return {
      session: publicSession(created.session),
      participant: { participant_id: created.participant.participant_id, label: created.participant.label },
      participant_url: `/run/${created.session.session_id}`
    };
  });

  app.get("/api/admin/sessions", { preHandler: requireAdmin }, async () => ({
    sessions: repo.listAdminSessions()
  }));

  app.get("/api/admin/sessions/:sessionId", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = repo.getSession(sessionId);
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const participant = repo.getParticipant(session.participant_id);
    return {
      session: publicSession(session),
      participant,
      design: repo.getDesign(sessionId),
      notes: repo.getNotes(sessionId),
      events: repo.getSessionEvents(sessionId, 100),
      gaze: repo.getGazeSummary(sessionId)
    };
  });

  app.get("/api/admin/gaze/sessions/:sessionId", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const gaze = repo.getGazeSummary(sessionId);
    if (!gaze) return reply.code(404).send({ error: "gaze_session_not_found" });
    return { gaze };
  });

  app.get("/api/admin/gaze/sessions/:sessionId/export/:name", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId, name } = request.params as { sessionId: string; name: string };
    const file = repo.readGazeExportFile(sessionId, name);
    if (!file) return reply.code(404).send({ error: "gaze_export_not_found" });
    const type = name.endsWith(".jsonl")
      ? "application/x-ndjson; charset=utf-8"
      : "application/json; charset=utf-8";
    return reply
      .header("content-type", type)
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("x-checksum-sha256", file.sha256)
      .send(file.content);
  });

  app.post("/api/admin/sessions/:sessionId/abort", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(z.object({ reason: z.string().min(1).max(500) }), request.body ?? {}, reply);
    if (!body) return;
    if (!repo.getSession(sessionId)) return reply.code(404).send({ error: "session_not_found" });
    return { session: publicSession(repo.abortSession(sessionId, body.reason)) };
  });

  app.delete("/api/admin/sessions/:sessionId", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!repo.getSession(sessionId)) return reply.code(404).send({ error: "session_not_found" });
    repo.withdrawSession(sessionId);
    return { ok: true, withdrawn: sessionId };
  });

  app.post("/api/admin/sessions/:sessionId/notes", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseBody(noteSchema, request.body, reply);
    if (!body) return;
    try {
      return repo.addNote(sessionId, body.note);
    } catch (error) {
      return reply.code(404).send({ error: "session_not_found", message: (error as Error).message });
    }
  });

  app.get("/api/admin/sessions/:sessionId/events", { preHandler: requireAdmin }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!repo.getSession(sessionId)) return reply.code(404).send({ error: "session_not_found" });
    const query = request.query as { limit?: string };
    const limit = Math.min(1000, Math.max(1, Number(query.limit ?? 200)));
    return { events: repo.getSessionEvents(sessionId, limit) };
  });

  app.get("/api/admin/qa", { preHandler: requireAdmin }, async () => buildQaReport(repo));

  app.get("/api/admin/gonogo", { preHandler: requireAdmin }, async () => ({
    generated_at: new Date().toISOString(),
    criteria: buildGoNoGo(repo)
  }));

  app.get("/api/admin/export/:kind", { preHandler: requireAdmin }, async (request, reply) => {
    const { kind } = request.params as { kind: string };
    const normalized = kind === "manifest" ? "manifest" : kind;
    const file = exportFile(repo, normalized);
    if (!file) {
      return reply.code(404).send({ error: "export_not_found", kinds: [...buildExportBundle(repo).map((f) => f.name), "manifest"] });
    }
    const type = file.name.endsWith(".jsonl")
      ? "application/x-ndjson; charset=utf-8"
      : file.name.endsWith(".csv")
        ? "text/csv; charset=utf-8"
        : "application/json; charset=utf-8";
    reply
      .header("content-type", type)
      .header("content-disposition", `attachment; filename="${file.name}"`)
      .header("x-checksum-sha256", file.sha256)
      .header("x-row-count", String(file.rows));
    return file.content;
  });

  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      const index = path.join(webDist, "index.html");
      if (fs.existsSync(index)) reply.type("text/html").send(fs.readFileSync(index, "utf8"));
      else reply.code(404).send({ error: "web_build_not_found" });
    });
  }

  return app;
}

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
  noteSchema,
  questionnaireBatchSchema,
  updateSessionSchema
} from "./validation";
import { exportFile } from "./exports";
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
    const session = repo.updateSession(sessionId, body);
    return { session: publicSession(session) };
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
      return reply.code(400).send({ error: "event_ingestion_failed", message: (error as Error).message });
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
      events: repo.getSessionEvents(sessionId, 100)
    };
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
    if (!file) return reply.code(404).send({ error: "export_not_found", kinds: ["events.jsonl", "events.csv", "trials.csv", "checkins.csv", "questionnaires.csv", "assignments.csv", "tasks.csv", "manifest"] });
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

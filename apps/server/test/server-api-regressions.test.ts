import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Repository } from '../src/repository';
import { createServer } from '../src/server';
import type { EventInput } from '@meridian/scoring';
let repo: Repository;
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-api-')); repo = new Repository(':memory:', path.join(dir, 'raw')); });
afterEach(() => { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); });
function event(session = repo.createSession().session): EventInput {
 return { event_id: randomUUID(), session_id: session.session_id, participant_id: session.participant_id, study: 'pilot', event_type: 'node_click', state_label: 'mixed', condition: 'static', t_client: 1, input_type: 'mouse', meta: {}, block_id: null, trial_id: null, task_id: null, target_id: null, menu_id: null, elapsed_ms: null, level: null, element_id: null, element_label: null, parent_id: null, x: null, y: null };
}
function gaze() {
 const session = repo.createSession().session;
 repo.recordConsent(session.session_id, 'v1');
 const result = repo.createGazeConsent(session.session_id, { version: 'v1', camera_used: true, synthetic: false, viewport: { width_px: 100, height_px: 100 }, geometry: {}, source: { kind: 'webcam' } });
 return { session, token: result.token };
}
it('does not reopen aborted sessions through consent or state updates', () => {
 const session = repo.createSession().session; repo.abortSession(session.session_id, 'gaze_quality_gate_failed');
 expect(() => repo.recordConsent(session.session_id, 'v1')).toThrow('session_not_active');
 expect(() => repo.updateSession(session.session_id, { status: 'in_progress' })).toThrow('invalid_session_transition');
});
it('preserves stop reason when delayed session_end arrives', () => {
 const session = repo.createSession().session; repo.abortSession(session.session_id, 'gaze_quality_gate_failed');
 repo.insertEvents([{ ...event(session), event_type: 'session_end', meta: { completed: false, abort_reason: 'session_time_limit' } }]);
 expect(repo.getSession(session.session_id)?.abort_reason).toBe('gaze_quality_gate_failed');
});
it('rejects event identity collisions instead of silently losing changed data', () => {
 const e = event(); repo.insertEvents([e]);
 expect(() => repo.insertEvents([{ ...e, t_client: 20 }])).toThrow('event_id_conflict');
});
it('prevents cross-session trial contamination', () => {
 const e = { ...event(), trial_id: 'shared-trial' }; repo.insertEvents([e]);
 expect(() => repo.insertEvents([{ ...event(), trial_id: e.trial_id }])).toThrow('trial_session_mismatch');
});
it('rejects a changed gaze batch with the same identity', () => {
 const { session } = gaze(); const batch = { batch_id: 'batch', samples: [{ seq: 1, t_ms: 1, x_px: 10, y_px: 10, valid: true }] };
 repo.insertGazeBatch(session.session_id, batch);
 expect(() => repo.insertGazeBatch(session.session_id, { ...batch, samples: [{ ...batch.samples[0]!, x_px: 20 }] })).toThrow('gaze_batch_conflict');
});
it('marks out of viewport gaze samples invalid at ingestion', () => {
 const { session } = gaze(); repo.insertGazeBatch(session.session_id, { batch_id: 'batch', samples: [{ seq: 1, t_ms: 1, x_px: 101, y_px: 10, valid: true }] });
 expect(repo.getGazeSamples(session.session_id)[0]).toMatchObject({ valid: 0, invalid_reason: 'out_of_bounds' });
});
it('returns 400 for malformed beacon JSON and invalid event query limits', async () => {
 const app = await createServer(repo, { adminPassword: 'test-admin' });
 try {
 expect((await app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'text/plain' }, payload: '{' })).statusCode).toBe(400);
 const session = repo.createSession().session;
 expect((await app.inject({ url: `/api/admin/sessions/${session.session_id}/events?limit=wat`, headers: { 'x-admin-password': 'test-admin' } })).statusCode).toBe(400);
 } finally { await app.close(); }
});
it('rejects questionnaire response IDs reused by a different session', () => {
 const first = repo.createSession().session; const second = repo.createSession().session;
 const r = { response_id: randomUUID(), session_id: first.session_id, instrument: 'OPEN', item_id: 'comment', text_value: 'first' };
 repo.insertQuestionnaires([r]);
 expect(() => repo.insertQuestionnaires([{ ...r, session_id: second.session_id }])).toThrow('response_id_conflict');
 expect(repo.allQuestionnaires()).toHaveLength(1);
});
it('allows a gaze completion retry after its successful response was lost', async () => {
 const { session, token } = gaze(); const app = await createServer(repo);
 const payload = { calibration: null, quality: { overall: 'fail', analysis_ready: false, angular_metrics_ready: false, missing_pct: null, sample_count: 0, valid_sample_count: 0, rejected_samples: 0, dropped_samples: 0 }, metrics: [], clock: {}, max_samples: 100, rejected_samples: 0, dropped_samples: 0 };
 try {
 const request = { method: 'POST' as const, url: `/api/gaze/sessions/${session.session_id}/complete`, headers: { 'x-gaze-token': token }, payload };
 expect((await app.inject(request)).statusCode).toBe(200);
 expect((await app.inject(request)).statusCode).toBe(200);
 } finally { await app.close(); }
});
it('serves SPA routes but returns 404 for missing runtime assets with camera policy', async () => {
 const webDist = path.join(dir, 'web'); fs.mkdirSync(webDist); fs.writeFileSync(path.join(webDist, 'index.html'), '<html>app</html>');
 const app = await createServer(repo, { webDist });
 try {
 for (const url of ['/vendor/missing.wasm', '/assets/missing.js', '/missing.css']) expect((await app.inject({ url })).statusCode).toBe(404);
 const page = await app.inject({ url: '/run/session' }); expect(page.statusCode).toBe(200);
 expect(page.headers['permissions-policy']).toContain('camera=(self)');
 expect(page.headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
 } finally { await app.close(); }
});
it('never exposes archive filesystem errors as participant input failures', async () => {
 const app = await createServer(repo);
 const original = repo.insertEvents;
 repo.insertEvents = () => { throw new Error('EACCES /private/study/raw/participant.jsonl'); };
 try {
 const response = await app.inject({ method: 'POST', url: '/api/events', payload: { events: [event()] } });
 expect(response.statusCode).toBe(500); expect(response.body).not.toContain('/private/study');
 } finally { repo.insertEvents = original; await app.close(); }
});
it('does not accept incomplete calibration or negative angular error as analysis ready', () => {
 for (const calibration of [{ target_count: 1, expected_target_count: 9, max_error_deg: 1 }, { target_count: 9, expected_target_count: 9, max_error_deg: -1 }]) {
 const { session } = gaze(); repo.insertGazeBatch(session.session_id, { batch_id: 'one', samples: [{ seq: 1, t_ms: 1, x_px: 10, y_px: 10, valid: true }] });
 const result = repo.completeGazeSession(session.session_id, { calibration: { ...calibration, passes: true, angular_available: true, unknown_observations: 0 }, quality: { sample_count: 1, overall: 'pass', analysis_ready: true, angular_metrics_ready: true }, metrics: [], clock: {}, max_samples: 100, rejected_samples: 0, dropped_samples: 0 });
 expect(result.manifest.analysis_ready).toBe(false); expect(result.manifest.angular_metrics_ready).toBe(false);
 }
});

it('rejects invalid PORT configuration before starting the server', async () => {
 vi.stubEnv('PORT', 'not-a-port'); vi.resetModules();
 try { await expect(import('../src/config')).rejects.toThrow(); }
 finally { vi.unstubAllEnvs(); vi.resetModules(); }
});
it('does not reuse a stratum allocation position after withdrawal', async () => {
 const { stratumSequenceIndex } = await import('../src/design');
 const allocate = () => { const session = repo.createSession().session; repo.recordConsent(session.session_id, 'v1'); const design = repo.assignDesign(session.session_id, { gender: 'woman', shopping_freq: 'rarely' }); return { session, design }; };
 const first = allocate(); allocate(); repo.withdrawSession(first.session.session_id);
 expect(allocate().design.sequenceIndex).toBe(stratumSequenceIndex(repo.seed, 'woman|rarely', 2));
});
it('persists numeric demographic ratings as numbers', () => {
 const session = repo.createSession().session; repo.recordConsent(session.session_id, 'v1');
 repo.assignDesign(session.session_id, { gender: 'woman', shopping_freq: 'rarely', watch_expertise: 4, tech_savvy: 5 });
 expect(repo.getParticipant(session.participant_id)).toMatchObject({ watch_expertise: 4, tech_savvy: 5 });
});

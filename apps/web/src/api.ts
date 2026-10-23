import type { SessionBundle, SessionInfo } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String(body.error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function loadSession(sessionId: string): Promise<SessionBundle> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function loadSessionStatus(sessionId: string): Promise<{ status: string; phase: string; abort_reason: string | null }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/status`);
}

export function recordConsent(sessionId: string, version: string): Promise<{ session: SessionInfo }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/consent`, {
    method: "POST",
    body: JSON.stringify({ version })
  });
}

export async function submitDemographics(
  sessionId: string,
  demographics: Record<string, unknown>
): Promise<{ design: SessionBundle["design"]; session: SessionInfo }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/demographics`, {
    method: "POST",
    body: JSON.stringify(demographics)
  });
}

export function patchSessionState(sessionId: string, patch: { status?: string; phase?: string }): Promise<{ session: SessionInfo }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/state`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function stopSession(sessionId: string, reason: string): Promise<{ session: SessionInfo }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export function withdrawSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ confirm: true })
  });
}

export function submitQuestionnaires(responses: Array<Record<string, unknown>>): Promise<{ ok: boolean; accepted: number }> {
  return request("/api/questionnaires", { method: "POST", body: JSON.stringify({ responses }) });
}

export function adminRequest<T>(path: string, password: string, init: RequestInit = {}): Promise<T> {
  return request(path, {
    ...init,
    headers: { "x-admin-password": password, ...(init.body ? { "content-type": "application/json" } : {}) }
  });
}

export function createAdminSession(password: string, label?: string) {
  return adminRequest<{ session: SessionInfo; participant: { participant_id: string; label: string }; participant_url: string }>(
    "/api/admin/sessions",
    password,
    { method: "POST", body: JSON.stringify(label ? { label } : {}) }
  );
}

export function getAdminSessions(password: string) {
  return adminRequest<{ sessions: import("./types").AdminSession[] }>("/api/admin/sessions", password);
}

export function abortAdminSession(password: string, sessionId: string, reason: string) {
  return adminRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}/abort`, password, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export function deleteAdminSession(password: string, sessionId: string) {
  return adminRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, password, { method: "DELETE" });
}

export function addAdminNote(password: string, sessionId: string, note: string) {
  return adminRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}/notes`, password, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function getQa(password: string) {
  return adminRequest<import("./types").QaReport>("/api/admin/qa", password);
}

export function getGoNoGo(password: string) {
  return adminRequest<{ generated_at: string; criteria: import("./types").QaCriterion[] }>("/api/admin/gonogo", password);
}

export async function downloadExport(password: string, kind: string): Promise<{ blob: Blob; checksum: string; rows: string }> {
  const response = await fetch(`${API_BASE}/api/admin/export/${encodeURIComponent(kind)}`, {
    headers: { "x-admin-password": password }
  });
  if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    checksum: response.headers.get("x-checksum-sha256") ?? "",
    rows: response.headers.get("x-row-count") ?? ""
  };
}

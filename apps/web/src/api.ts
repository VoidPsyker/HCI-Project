import type { SessionBundle, SessionInfo } from "./types";

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(response.ok ? "Invalid server response. Please retry." : `HTTP ${response.status}`);
  }
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

export function adminLogin(password: string): Promise<{ token: string; expires_at: string }> {
  return request("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
}

export function adminRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return request(path, {
    ...init,
    headers: { "x-admin-token": token, ...(init.body ? { "content-type": "application/json" } : {}) }
  });
}

export function createAdminSession(token: string, label?: string) {
  return adminRequest<{ session: SessionInfo; participant: { participant_id: string; label: string }; participant_url: string }>(
    "/api/admin/sessions",
    token,
    { method: "POST", body: JSON.stringify(label ? { label } : {}) }
  );
}

export function getAdminSessions(token: string) {
  return adminRequest<{ sessions: import("./types").AdminSession[] }>("/api/admin/sessions", token);
}

export function abortAdminSession(token: string, sessionId: string, reason: string) {
  return adminRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}/abort`, token, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export function deleteAdminSession(token: string, sessionId: string) {
  return adminRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, token, { method: "DELETE" });
}

export function addAdminNote(token: string, sessionId: string, note: string) {
  return adminRequest(`/api/admin/sessions/${encodeURIComponent(sessionId)}/notes`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function getQa(token: string) {
  return adminRequest<import("./types").QaReport>("/api/admin/qa", token);
}

export function getGoNoGo(token: string) {
  return adminRequest<{ generated_at: string; criteria: import("./types").QaCriterion[] }>("/api/admin/gonogo", token);
}

export function getGazeSummary(token: string, sessionId: string) {
  return adminRequest<{ gaze: { status: string; sample_count: number; analysis_ready: boolean; export_files: string[] } }>(
    "/api/admin/gaze/sessions/" + encodeURIComponent(sessionId), token
  );
}

export function downloadGazeExport(token: string, sessionId: string, filename: string) {
  return downloadAdminFile(token,
    "/api/admin/gaze/sessions/" + encodeURIComponent(sessionId) + "/export/" + encodeURIComponent(filename));
}

export function downloadExport(token: string, kind: string) {
  return downloadAdminFile(token, "/api/admin/export/" + encodeURIComponent(kind));
}

async function downloadAdminFile(token: string, path: string) {
  const response = await fetch(API_BASE + path, {
    headers: { "x-admin-token": token }
  });
  if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    checksum: response.headers.get("x-checksum-sha256") ?? "",
    rows: response.headers.get("x-row-count") ?? ""
  };
}

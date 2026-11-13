import crypto from "node:crypto";

/** How long a researcher stays signed in to the dashboard. */
export const ADMIN_SIGN_IN_MS = 3 * 24 * 60 * 60 * 1000;

function signature(password: string, expiresAt: number): string {
  return crypto.createHmac("sha256", password).update(`meridian-admin:${expiresAt}`).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function passwordMatches(expected: string, provided: string | undefined): boolean {
  return sameText(provided ?? "", expected);
}

/**
 * A stateless sign-in token keyed on the admin password, so the browser never stores the
 * password and changing the password signs every researcher out.
 */
export function issueAdminToken(password: string, now = Date.now()): { token: string; expires_at: string } {
  const expiresAt = now + ADMIN_SIGN_IN_MS;
  return { token: `${expiresAt}.${signature(password, expiresAt)}`, expires_at: new Date(expiresAt).toISOString() };
}

export function adminTokenValid(password: string, token: string | undefined, now = Date.now()): boolean {
  const [expiry, provided] = (token ?? "").split(".");
  const expiresAt = Number(expiry);
  if (!provided || !Number.isSafeInteger(expiresAt) || now >= expiresAt) return false;
  return sameText(provided, signature(password, expiresAt));
}

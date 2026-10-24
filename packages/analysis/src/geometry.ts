import type { ScreenGeometry, Viewport } from "./types";

export interface PointPx {
  x_px: number;
  y_px: number;
}

export function assertViewport(viewport: Viewport): void {
  if (!Number.isFinite(viewport.width_px) || viewport.width_px <= 0) throw new Error("viewport_width_invalid");
  if (!Number.isFinite(viewport.height_px) || viewport.height_px <= 0) throw new Error("viewport_height_invalid");
}

export function assertScreenGeometry(geometry: ScreenGeometry): void {
  assertViewport(geometry);
  if (!Number.isFinite(geometry.width_mm) || geometry.width_mm <= 0) throw new Error("screen_width_mm_invalid");
  if (!Number.isFinite(geometry.height_mm) || geometry.height_mm <= 0) throw new Error("screen_height_mm_invalid");
  if (!Number.isFinite(geometry.viewing_distance_mm) || geometry.viewing_distance_mm <= 0) {
    throw new Error("viewing_distance_mm_invalid");
  }
}

/**
 * The pixel dimensions used for angular conversion must be the same capture
 * viewport the tracker reports coordinates in. A screen resolution that does
 * not match the browser viewport is a configuration error, not a conversion to
 * guess at.
 */
export function assertGeometryMatchesViewport(geometry: ScreenGeometry, viewport: Viewport): void {
  assertScreenGeometry(geometry);
  assertViewport(viewport);
  if (geometry.width_px !== viewport.width_px || geometry.height_px !== viewport.height_px) {
    throw new Error("screen_geometry_viewport_mismatch");
  }
}

export function isPointInViewport(point: PointPx, viewport: Viewport): boolean {
  return (
    Number.isFinite(point.x_px) &&
    Number.isFinite(point.y_px) &&
    point.x_px >= 0 &&
    point.y_px >= 0 &&
    point.x_px <= viewport.width_px &&
    point.y_px <= viewport.height_px
  );
}

interface Point3Mm {
  x: number;
  y: number;
  z: number;
}

function toScreenMm(point: PointPx, geometry: ScreenGeometry): Point3Mm {
  return {
    x: (point.x_px / geometry.width_px) * geometry.width_mm,
    y: (point.y_px / geometry.height_px) * geometry.height_mm,
    z: 0
  };
}

function eyeAtScreenCentre(geometry: ScreenGeometry): Point3Mm {
  return { x: geometry.width_mm / 2, y: geometry.height_mm / 2, z: -geometry.viewing_distance_mm };
}

/**
 * Angular separation between two on-screen points as seen from a single eye
 * on the screen's normal through its centre. The angle is between the two 3D
 * eye-to-point rays, so equal pixel displacements subtend less angle near the
 * screen edge than at the centre. Head offset and binocular geometry are not
 * measured; this is a documented centred-eye approximation, not clinical
 * accuracy. Returns `null` when geometry is absent rather than fabricating a
 * conversion.
 */
export function angularDistanceDeg(a: PointPx, b: PointPx, geometry: ScreenGeometry | null): number | null {
  if (!geometry) return null;
  assertScreenGeometry(geometry);
  const eye = eyeAtScreenCentre(geometry);
  const pa = toScreenMm(a, geometry);
  const pb = toScreenMm(b, geometry);
  const ax = pa.x - eye.x;
  const ay = pa.y - eye.y;
  const az = pa.z - eye.z;
  const bx = pb.x - eye.x;
  const by = pb.y - eye.y;
  const bz = pb.z - eye.z;
  const crossX = ay * bz - az * by;
  const crossY = az * bx - ax * bz;
  const crossZ = ax * by - ay * bx;
  const dot = ax * bx + ay * by + az * bz;
  return (Math.atan2(Math.hypot(crossX, crossY, crossZ), dot) * 180) / Math.PI;
}

/** Angular velocity in degrees/second. Requires real geometry. */
export function angularVelocityDegS(
  a: PointPx,
  b: PointPx,
  dtMs: number,
  geometry: ScreenGeometry | null
): number | null {
  if (!geometry) return null;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return null;
  const angle = angularDistanceDeg(a, b, geometry);
  return angle === null ? null : angle / (dtMs / 1000);
}

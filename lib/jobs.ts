import type { Polygon } from "geojson";
import { polygonArea } from "@/components/map/drawing";
import { JOB_KINDS, type JobKind } from "@/db/schema";

/** Max area per job kind, in m². Keeps MapTiler + GPU usage bounded. */
export const MAX_AREA_M2: Record<JobKind, number> = {
  detect: 1_000_000, // 1 km²
  segment: 50_000, // 0.05 km²
};

const MAX_VERTICES = 500;

export type CreateJobInput = { kind: JobKind; polygon: Polygon };

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isNumberPair = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0] as number) <= 180 &&
  Math.abs(p[1] as number) <= 90;

/** Validate a POST /api/jobs body. */
export function parseCreateJob(body: unknown): Result<CreateJobInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const { kind, polygon } = body as Record<string, unknown>;

  if (!JOB_KINDS.includes(kind as JobKind)) {
    return { ok: false, error: `kind must be one of: ${JOB_KINDS.join(", ")}.` };
  }

  const p = polygon as Polygon | undefined;
  if (p?.type !== "Polygon" || !Array.isArray(p.coordinates)) {
    return { ok: false, error: "polygon must be a GeoJSON Polygon." };
  }
  const ring = p.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isNumberPair)) {
    return {
      ok: false,
      error: "polygon needs a closed ring of at least 3 [lng, lat] points.",
    };
  }
  if (ring.length > MAX_VERTICES) {
    return { ok: false, error: `polygon has too many vertices (max ${MAX_VERTICES}).` };
  }
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return { ok: false, error: "polygon ring must be closed (first point = last point)." };
  }

  // Outer ring only; holes aren't used by the UI.
  const clean: Polygon = {
    type: "Polygon",
    coordinates: [ring.map(([lng, lat]) => [lng, lat])],
  };

  const area = polygonArea(clean);
  const max = MAX_AREA_M2[kind as JobKind];
  if (area > max) {
    return {
      ok: false,
      error: `Area too large: ${(area / 1e6).toFixed(3)} km² (max ${max / 1e6} km² for ${kind}).`,
    };
  }

  return { ok: true, value: { kind: kind as JobKind, polygon: clean } };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string) => UUID_RE.test(s);

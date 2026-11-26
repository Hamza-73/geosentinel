import type { TerraDraw } from "terra-draw";
import type { Point, Polygon } from "geojson";

/**
 * "select" is the idle mode: clicking a feature selects it for editing.
 * "segment" / "detect" capture input for the AI analysis tools.
 */
export type DrawTool =
  | "select"
  | "point"
  | "linestring"
  | "polygon"
  | "segment"
  | "detect";

export type AnalysisKind = "segment" | "detect";

export const isAnalysisTool = (tool: string): tool is AnalysisKind =>
  tool === "segment" || tool === "detect";

/** The point / area currently marked on the map for an analysis tool. */
export type AnalysisInput = {
  /** Terra Draw feature id. */
  featureId: string | number;
  geometry: Point | Polygon;
};

export type JobStatus =
  | "not-connected"
  | "queued"
  | "running"
  | "done"
  | "error";

/** A started analysis (background job once the AI service exists). */
export type AnalysisJob = {
  id: string;
  kind: AnalysisKind;
  /** Snapshot of the input at the moment the job was started. */
  geometry: Point | Polygon;
  status: JobStatus;
  createdAt: number;
};

// ── Area ──────────────────────────────────────────────────────────────

const EARTH_RADIUS = 6371008.8; // metres (mean radius)
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Geodesic area of a closed lng/lat ring in m² (spherical approximation). */
function ringArea(ring: number[][]): number {
  const n = ring.length;
  if (n <= 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lower = ring[i];
    const middle = ring[(i + 1) % n];
    const upper = ring[(i + 2) % n];
    total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

/** Area of a polygon (outer ring minus holes) in m². */
export function polygonArea(polygon: Polygon): number {
  const [outer, ...holes] = polygon.coordinates;
  return holes.reduce((a, h) => a - ringArea(h), ringArea(outer));
}

const nf = (max: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: max });

export function formatArea(m2: number) {
  return {
    m2: `${nf(0).format(m2)} m²`,
    ha: `${nf(2).format(m2 / 10_000)} ha`,
    km2: `${nf(3).format(m2 / 1_000_000)} km²`,
  };
}

export function formatLngLat([lng, lat]: number[]) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export type FeatureCounts = {
  point: number;
  linestring: number;
  polygon: number;
};

export const emptyCounts: FeatureCounts = { point: 0, linestring: 0, polygon: 0 };

/** Minimum vertices before a line / polygon can be finished. */
export const MIN_POINTS = {
  linestring: 2,
  polygon: 3,
  segment: 3,
  detect: 3,
} as const;

export type MultiVertexTool = keyof typeof MIN_POINTS;

export const isMultiVertexTool = (tool: string): tool is MultiVertexTool =>
  tool in MIN_POINTS;

// Terra Draw keeps editing helpers (vertex handles, midpoints, etc.) in the
// same store as real features, so skip those when counting.
const guidanceProps = [
  "currentlyDrawing",
  "midPoint",
  "selectionPoint",
  "closingPoint",
  "snappingPoint",
  "coordinatePoint",
];

export function countFeatures(draw: TerraDraw): FeatureCounts {
  const counts = { ...emptyCounts };
  for (const f of draw.getSnapshot()) {
    if (guidanceProps.some((p) => f.properties[p])) continue;
    // AI inputs are listed separately, not as drawn features.
    if (isAnalysisTool(String(f.properties.mode))) continue;
    if (f.geometry.type === "Point") counts.point++;
    else if (f.geometry.type === "LineString") counts.linestring++;
    else if (f.geometry.type === "Polygon") counts.polygon++;
  }
  return counts;
}

/**
 * Number of vertices the user has placed on the line / polygon currently
 * being drawn, or 0 if nothing is in progress.
 */
export function placedVertices(draw: TerraDraw): number {
  const f = draw.getSnapshot().find((f) => f.properties.currentlyDrawing);
  if (!f) return 0;

  const committed = f.properties.committedCoordinateCount;
  if (typeof committed === "number") return committed;

  // While drawing, the last vertex follows the cursor and isn't placed yet.
  if (f.geometry.type === "LineString") {
    return f.geometry.coordinates.length - 1;
  }
  if (f.geometry.type === "Polygon") {
    // Ring is [...placed, cursor, first] while drawing.
    return Math.max(0, f.geometry.coordinates[0].length - 2);
  }
  return 0;
}

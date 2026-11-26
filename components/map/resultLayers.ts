import type { Map } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { AnalysisKind } from "./drawing";

/** Result colours: distinct from the purple AI input areas. */
export const RESULT_COLORS: Record<AnalysisKind, string> = {
  detect: "#f97316", // orange
  segment: "#06b6d4", // cyan
};

const sourceId = (jobId: string) => `job-result-${jobId}`;
export const fillLayerId = (jobId: string) => `job-result-fill-${jobId}`;
const lineLayerId = (jobId: string) => `job-result-line-${jobId}`;

export function hasJobResult(map: Map, jobId: string) {
  return Boolean(map.getSource(sourceId(jobId)));
}

/** Draw a finished job's GeoJSON as fill + outline layers. */
export function addJobResult(
  map: Map,
  jobId: string,
  kind: AnalysisKind,
  data: FeatureCollection,
) {
  if (hasJobResult(map, jobId)) return;
  const color = RESULT_COLORS[kind];
  map.addSource(sourceId(jobId), { type: "geojson", data });
  map.addLayer({
    id: fillLayerId(jobId),
    type: "fill",
    source: sourceId(jobId),
    paint: { "fill-color": color, "fill-opacity": 0.2 },
  });
  map.addLayer({
    id: lineLayerId(jobId),
    type: "line",
    source: sourceId(jobId),
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 20, 2.5],
    },
  });
}

export function removeJobResult(map: Map, jobId: string) {
  for (const id of [lineLayerId(jobId), fillLayerId(jobId)]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(sourceId(jobId))) map.removeSource(sourceId(jobId));
}

"use client";

import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { Map } from "maplibre-gl";
import { type AnalysisJob, polygonArea } from "@/components/map/drawing";
import { prettyLabel, RESULT_COLORS } from "@/components/map/resultLayers";

export type ExportFormat = "geojson" | "csv" | "png";

const ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";
const KIND_NAMES = { detect: "Object detection", segment: "Segmentation" } as const;

// ── Helpers ───────────────────────────────────────────────────────────

function fileName(job: AnalysisJob, ext: string) {
  const d = new Date(job.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `geosentinel-${job.kind}-${stamp}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Polygons of a result feature (Polygon or MultiPolygon). */
function polygonsOf(f: Feature): Polygon[] {
  const g = f.geometry;
  if (g?.type === "Polygon") return [g];
  if (g?.type === "MultiPolygon") {
    return (g as MultiPolygon).coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  }
  return [];
}

/** Rough centre: mean of the largest part's outer-ring vertices. */
function centreOf(f: Feature): Position | null {
  const parts = polygonsOf(f);
  if (!parts.length) return null;
  const largest = parts.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
  const ring = largest.coordinates[0].slice(0, -1);
  const sum = ring.reduce(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

const areaOf = (f: Feature) => polygonsOf(f).reduce((a, p) => a + polygonArea(p), 0);

function counts(job: AnalysisJob): [string, number][] {
  return Object.entries(job.stats ?? {}).sort((a, b) => b[1] - a[1]);
}

// ── GeoJSON ───────────────────────────────────────────────────────────

export function exportGeoJSON(job: AnalysisJob) {
  const result = job.result!;
  const fc: FeatureCollection & { geosentinel: unknown } = {
    type: "FeatureCollection",
    // Job details as a GeoJSON "foreign member"; GIS tools ignore it.
    geosentinel: {
      job_id: job.id,
      kind: job.kind,
      created_at: new Date(job.createdAt).toISOString(),
      area: job.geometry,
      counts: job.stats ?? {},
      imagery: "MapTiler satellite-v2",
      attribution: ATTRIBUTION,
    },
    features: result.features.map((f, i) => ({
      ...f,
      properties: {
        id: i + 1,
        label: f.properties?.label ?? null,
        confidence: f.properties?.confidence ?? null,
        area_m2: Math.round(areaOf(f) * 10) / 10,
      },
    })),
  };
  download(
    new Blob([JSON.stringify(fc)], { type: "application/geo+json" }),
    fileName(job, "geojson"),
  );
}

// ── CSV ───────────────────────────────────────────────────────────────

export function exportCSV(job: AnalysisJob) {
  const rows = [["id", "label", "confidence", "center_lat", "center_lng", "area_m2"]];
  job.result!.features.forEach((f, i) => {
    const c = centreOf(f);
    rows.push([
      String(i + 1),
      String(f.properties?.label ?? ""),
      String(f.properties?.confidence ?? ""),
      c ? c[1].toFixed(7) : "",
      c ? c[0].toFixed(7) : "",
      areaOf(f).toFixed(1),
    ]);
  });
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  download(new Blob([csv], { type: "text/csv" }), fileName(job, "csv"));
}

// ── PNG ───────────────────────────────────────────────────────────────

/**
 * Snapshot of the map zoomed to the job's area, with object names, a legend
 * and the imagery attribution (required by MapTiler's terms). Restores the
 * user's view afterwards.
 */
export async function exportPNG(map: Map, job: AnalysisJob) {
  const saved = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };

  try {
    const ring = (job.geometry as Polygon).coordinates[0];
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, duration: 0, bearing: 0, pitch: 0, maxZoom: 20 },
    );
    await new Promise<void>((resolve) => map.once("idle", () => resolve()));

    // The WebGL buffer is only readable during a render.
    const mapImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      map.once("render", () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = map.getCanvas().toDataURL("image/png");
      });
      map.triggerRepaint();
    });

    const dpr = map.getCanvas().width / map.getCanvas().clientWidth;
    const canvas = document.createElement("canvas");
    canvas.width = mapImage.width;
    canvas.height = mapImage.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(mapImage, 0, 0);
    ctx.scale(dpr, dpr);
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const color = RESULT_COLORS[job.kind];

    // Object names, skipping ones that would overlap.
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const placed: [number, number, number, number][] = [];
    for (const f of job.result!.features) {
      const c = centreOf(f);
      if (!c) continue;
      const { x, y } = map.project(c as [number, number]);
      const text = prettyLabel(String(f.properties?.label ?? ""));
      const w = ctx.measureText(text).width + 6;
      const box: [number, number, number, number] = [x - w / 2, y - 22, x + w / 2, y - 6];
      if (box[0] < 0 || box[2] > W || box[1] < 0) continue;
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) {
        continue;
      }
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.strokeText(text, x, y - 8);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x, y - 8);
    }

    // Legend (top-left).
    const lines = counts(job);
    const total = lines.reduce((a, [, n]) => a + n, 0);
    const title = `${KIND_NAMES[job.kind]} · ${total} object${total === 1 ? "" : "s"}`;
    const date = new Date(job.createdAt).toLocaleString();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const pad = 10;
    const lineH = 16;
    ctx.font = "600 13px system-ui, sans-serif";
    let boxW = ctx.measureText(title).width;
    ctx.font = "12px system-ui, sans-serif";
    for (const [label, n] of lines) {
      boxW = Math.max(boxW, ctx.measureText(`${prettyLabel(label)}  ${n}`).width + 18);
    }
    boxW = Math.max(boxW, ctx.measureText(date).width) + pad * 2;
    const boxH = pad * 2 + lineH * (2 + lines.length) + 4;
    ctx.fillStyle = "rgba(9, 9, 11, 0.8)";
    ctx.beginPath();
    ctx.roundRect(12, 12, boxW, boxH, 8);
    ctx.fill();
    let ty = 12 + pad;
    ctx.fillStyle = "#fff";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(title, 12 + pad, ty);
    ty += lineH;
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(date, 12 + pad, ty);
    ty += lineH + 4;
    for (const [label, n] of lines) {
      ctx.fillStyle = color;
      ctx.fillRect(12 + pad, ty + 3, 10, 10);
      ctx.fillStyle = "#fff";
      ctx.fillText(prettyLabel(label), 12 + pad + 16, ty);
      ctx.textAlign = "right";
      ctx.fillText(String(n), 12 + boxW - pad, ty);
      ctx.textAlign = "left";
      ty += lineH;
    }

    // Attribution (bottom-right).
    ctx.font = "11px system-ui, sans-serif";
    const aw = ctx.measureText(ATTRIBUTION).width + 12;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillRect(W - aw, H - 18, aw, 18);
    ctx.fillStyle = "#18181b";
    ctx.textBaseline = "middle";
    ctx.fillText(ATTRIBUTION, W - aw + 6, H - 9);

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) download(blob, fileName(job, "png"));
  } finally {
    map.jumpTo(saved);
  }
}

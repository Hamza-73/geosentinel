"use client";

import { useEffect, useState } from "react";
import type { Map, MapMouseEvent } from "maplibre-gl";
import type { TerraDraw } from "terra-draw";
import {
  type DrawTool,
  isAnalysisTool,
  isMultiVertexTool,
  MIN_POINTS,
  placedVertices,
} from "./drawing";

type DrawHintProps = {
  map: Map;
  draw: TerraDraw;
  tool: DrawTool;
};

const hints: Record<Exclude<DrawTool, "select">, { title: string; body: string }> = {
  point: {
    title: "Draw point",
    body: "Click on the map to draw a point at this location.",
  },
  linestring: {
    title: "Draw line",
    body: `Draw at least ${MIN_POINTS.linestring} points to add a line.`,
  },
  polygon: {
    title: "Draw polygon",
    body: `Draw at least ${MIN_POINTS.polygon} points to add a polygon.`,
  },
  segment: {
    title: "Segmentation",
    body: `Draw closely around one object to outline it, at least ${MIN_POINTS.segment} points.`,
  },
  detect: {
    title: "Object detection",
    body: `Draw the area to scan, at least ${MIN_POINTS.detect} points.`,
  },
};

/** Floating panel (top-right of the map) shown while a drawing tool is active. */
export default function DrawHint({ map, draw, tool }: DrawHintProps) {
  const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(
    null,
  );
  const [placed, setPlaced] = useState(0);

  useEffect(() => {
    const onMove = (e: MapMouseEvent) => setCursor(e.lngLat);
    const onOut = () => setCursor(null);
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
    };
  }, [map]);

  useEffect(() => {
    const update = () => setPlaced(placedVertices(draw));
    draw.on("change", update);
    return () => draw.off("change", update);
  }, [draw]);

  if (tool === "select") return null;

  const { title, body } = hints[tool];
  const multiVertex = isMultiVertexTool(tool);
  const min = multiVertex ? MIN_POINTS[tool] : 0;
  const ready = placed >= min;
  const ai = isAnalysisTool(tool);

  return (
    <div
      className={`pointer-events-none absolute right-3 top-3 z-10 w-72 rounded-lg border bg-white/95 p-3 text-sm text-zinc-900 shadow-lg backdrop-blur dark:bg-zinc-950/95 dark:text-zinc-100 ${
        ai
          ? "border-purple-300 dark:border-purple-900"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <p className="font-semibold">
        {title}
        {ai && (
          <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
            AI
          </span>
        )}
      </p>

      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        {body}
        {multiVertex && (
          <>
            {" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              Right-click
            </span>{" "}
            to finish.
          </>
        )}
      </p>

      {multiVertex && (
        <p
          className={`mt-2 font-medium tabular-nums ${
            ready ? "text-green-600" : "text-amber-600"
          }`}
        >
          {placed} / {min} points placed
          {ready && " · right-click to finish"}
        </p>
      )}

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-900">
        <dt className="text-zinc-500">Lng</dt>
        <dd className="text-right tabular-nums">
          {cursor ? cursor.lng.toFixed(6) : "—"}
        </dd>
        <dt className="text-zinc-500">Lat</dt>
        <dd className="text-right tabular-nums">
          {cursor ? cursor.lat.toFixed(6) : "—"}
        </dd>
      </dl>

      <p className="mt-2 text-xs text-zinc-500">Press Esc to cancel.</p>
    </div>
  );
}

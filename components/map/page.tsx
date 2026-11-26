"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { Map, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { isMultiVertexTool, MIN_POINTS, placedVertices } from "./drawing";

/** Colour for AI analysis inputs, so they stand apart from drawn shapes. */
const AI_COLOR = "#9333ea";

// Configure worker before creating any map
setWorkerUrl(
  new URL(
    "maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ).toString(),
);

const editable = {
  feature: {
    draggable: true,
    coordinates: { draggable: true, deletable: true, midpoints: true },
  },
};

// Right-click is reserved for finishing a line / polygon (handled below),
// so drawing modes must not treat it as "add a vertex".
const leftClickOnly = {
  leftClick: true,
  rightClick: false,
  contextMenu: false,
  onDragStart: true,
  onDrag: true,
  onDragEnd: true,
};

const keyEvents = { cancel: "Escape", finish: "Enter" };

export type MapReady = { map: Map; draw: TerraDraw };

type MapViewProps = {
  /** Called once the map and Terra Draw are ready, and with null on teardown. */
  onReady?: (ready: MapReady | null) => void;
};

export default function MapView({ onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const notifyReady = useEffectEvent((ready: MapReady | null) =>
    onReady?.(ready),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style:
        "https://api.maptiler.com/maps/01a21800-9900-78b8-ad02-316a1ce35a88/style.json?key=sf9kXjYeubjyjzgeqgeI",
      center: [-77.028232, 38.886269],
      zoom: 19,
      // Attribution is required by MapTiler / OSM terms, so keep it but
      // collapse it to the ⓘ button (it auto-hides once the map is dragged).
      attributionControl: { compact: true },
    });

    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
    });

    // Top-right is used by the drawing hint.
    map.addControl(new NavigationControl(), "bottom-right");

    let draw: TerraDraw | null = null;

    map.on("load", () => {
      const lineMode = new TerraDrawLineStringMode({
        pointerEvents: leftClickOnly,
        keyEvents,
      });
      const polygonMode = new TerraDrawPolygonMode({
        pointerEvents: leftClickOnly,
        keyEvents,
      });

      // AI analysis inputs: same interactions as point / polygon, but under
      // their own mode names so features are tagged (properties.mode) and
      // styled separately.
      const aiAreaOptions = {
        pointerEvents: leftClickOnly,
        keyEvents,
        styles: {
          fillColor: AI_COLOR,
          fillOpacity: 0.1,
          outlineColor: AI_COLOR,
          outlineWidth: 2,
        },
      } as const;
      const segmentMode = new TerraDrawPolygonMode({
        modeName: "segment",
        ...aiAreaOptions,
      });
      const detectMode = new TerraDrawPolygonMode({
        modeName: "detect",
        ...aiAreaOptions,
      });

      const finishable = {
        linestring: lineMode,
        polygon: polygonMode,
        segment: segmentMode,
        detect: detectMode,
      };

      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPointMode({ pointerEvents: leftClickOnly }),
          lineMode,
          polygonMode,
          segmentMode,
          detectMode,
          new TerraDrawSelectMode({
            flags: {
              point: { feature: { draggable: true } },
              linestring: editable,
              polygon: editable,
              segment: editable,
              detect: editable,
            },
          }),
        ],
      });
      draw.start();
      draw.setMode("select");

      // Right-click finishes the line / polygon being drawn, once it has
      // enough vertices. Terra Draw only exposes finishing via its key
      // handler, so trigger that directly.
      map.on("contextmenu", (e) => {
        e.preventDefault();
        if (!draw) return;
        const mode = draw.getMode();
        if (!isMultiVertexTool(mode)) return;
        if (placedVertices(draw) < MIN_POINTS[mode]) return;
        finishable[mode].onKeyUp({
          key: "Enter",
          heldKeys: [],
          preventDefault() {},
        });
      });

      notifyReady({ map, draw });
    });

    return () => {
      notifyReady(null);
      if (draw?.enabled) draw.stop();
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}

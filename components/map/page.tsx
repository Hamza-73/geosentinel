"use client";

import { useEffect, useRef } from "react";
import { Map, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Configure worker before creating any map
setWorkerUrl(
  new URL(
    "maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ).toString(),
);

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style:
        "https://api.maptiler.com/maps/01a21800-9900-78b8-ad02-316a1ce35a88/style.json?key=sf9kXjYeubjyjzgeqgeI",
      center: [74.3587, 31.5204],
      zoom: 8,
    });

    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
    });

    map.addControl(new NavigationControl(), "top-right");
    return () => map.remove();
  }, []);

  return <div ref={containerRef} className="h-full w-full min-h-[500px]" />;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Point, Polygon } from "geojson";
import { type MapMouseEvent, Popup } from "maplibre-gl";
import MapView, { type MapReady } from "@/components/map/page";
import {
  addJobResult,
  fillLayerId,
  removeJobResult,
} from "@/components/map/resultLayers";
import DrawHint from "@/components/map/DrawHint";
import Sidebar, { type SidebarView } from "@/components/Sidebar/page";
import {
  type AnalysisInput,
  type AnalysisJob,
  type AnalysisKind,
  countFeatures,
  type DrawTool,
  emptyCounts,
  type FeatureCounts,
  isAnalysisTool,
} from "@/components/map/drawing";

type Inputs = Partial<Record<AnalysisKind, AnalysisInput>>;

export default function MapWorkspace() {
  const [ready, setReady] = useState<MapReady | null>(null);
  const [view, setView] = useState<SidebarView>("home");
  const [tool, setTool] = useState<DrawTool>("select");
  const [counts, setCounts] = useState<FeatureCounts>(emptyCounts);
  /** The point / area currently marked for each analysis tool. */
  const [inputs, setInputs] = useState<Inputs>({});
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);

  // Latest inputs for Terra Draw event handlers (which aren't re-bound on
  // every render).
  const inputsRef = useRef(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  const draw = ready?.draw;

  const changeTool = useCallback(
    (next: DrawTool) => {
      draw?.setMode(next);
      setTool(next);
    },
    [draw],
  );

  useEffect(() => {
    if (!draw) return;

    const updateCounts = () => setCounts(countFeatures(draw));

    // One feature per tool activation: once a shape is finished, go back
    // to select mode so clicks edit instead of draw.
    const onFinish = (id: string | number, context: { mode: string }) => {
      updateCounts();

      const kind = context.mode;
      if (isAnalysisTool(kind)) {
        const feature = draw.getSnapshotFeature(id);
        if (feature) {
          // Each tool has one marked input; a new one replaces the old.
          const old = inputsRef.current[kind];
          if (old && old.featureId !== id && draw.getSnapshotFeature(old.featureId)) {
            draw.removeFeatures([old.featureId]);
          }
          setInputs((prev) => ({
            ...prev,
            [kind]: {
              featureId: id,
              geometry: feature.geometry as Point | Polygon,
            },
          }));
        }
      }

      if (draw.getMode() !== "select") {
        // Defer so Terra Draw finishes its own bookkeeping before the switch.
        setTimeout(() => changeTool("select"), 0);
      }
    };

    // Keep marked inputs in sync when they're edited on the map, and drop
    // them if the feature is deleted.
    const onChange = (ids: (string | number)[], type: string) => {
      updateCounts();
      if (type !== "update" && type !== "delete") return;
      setInputs((prev) => {
        let changed = false;
        const next: Inputs = {};
        for (const [kind, input] of Object.entries(prev) as [
          AnalysisKind,
          AnalysisInput,
        ][]) {
          if (!ids.includes(input.featureId)) {
            next[kind] = input;
            continue;
          }
          changed = true;
          const feature = draw.getSnapshotFeature(input.featureId);
          if (feature) {
            next[kind] = {
              ...input,
              geometry: feature.geometry as Point | Polygon,
            };
          }
        }
        return changed ? next : prev;
      });
    };

    draw.on("change", onChange);
    draw.on("finish", onFinish);
    return () => {
      draw.off("change", onChange);
      draw.off("finish", onFinish);
    };
  }, [draw, changeTool]);

  // Esc leaves the current drawing tool (Terra Draw discards the
  // unfinished shape itself).
  useEffect(() => {
    if (tool === "select") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") changeTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, changeTool]);

  const handleViewChange = (next: SidebarView) => {
    // Stop any in-progress marking when leaving a panel.
    if (tool !== "select") changeTool("select");
    setView(next);
  };

  const handleRemoveInput = (kind: AnalysisKind) => {
    const input = inputs[kind];
    if (input && draw?.getSnapshotFeature(input.featureId)) {
      draw.removeFeatures([input.featureId]);
    }
    setInputs((prev) => {
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  };

  const updateJob = (id: string, patch: Partial<AnalysisJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const handleStart = async (kind: AnalysisKind) => {
    const input = inputs[kind];
    if (!input || input.geometry.type !== "Polygon") return;

    // Show the card immediately; swap in the server id once created.
    const tempId = `pending-${crypto.randomUUID()}`;
    setJobs((prev) => [
      {
        id: tempId,
        kind,
        geometry: input.geometry,
        status: "starting",
        progress: 0,
        message: "Submitting…",
        createdAt: Date.now(),
      },
      ...prev,
    ]);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, polygon: input.geometry }),
      });
      const body = await res.json();
      if (!res.ok) {
        updateJob(tempId, { status: "error", error: body.error ?? `HTTP ${res.status}` });
        return;
      }
      updateJob(tempId, {
        id: body.id,
        status: body.status,
        progress: body.progress ?? 0,
        message: "Waiting for the AI worker…",
      });
    } catch {
      updateJob(tempId, { status: "error", error: "Network error: could not reach the server." });
    }
  };

  // Poll active jobs until they finish.
  const activeIds = jobs
    .filter((j) => (j.status === "queued" || j.status === "running"))
    .map((j) => j.id)
    .join(",");

  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(",");
    let stopped = false;

    const poll = async () => {
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
            if (!res.ok || stopped) return;
            const job = await res.json();
            updateJob(id, {
              status: job.status,
              progress: job.progress,
              message:
                job.status === "queued" ? "Waiting for the AI worker…" : job.message,
              error: job.error,
              stats: job.stats,
              result: job.result,
            });
          } catch {
            // Transient network error: try again on the next tick.
          }
        }),
      );
    };

    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeIds]);

  // Draw finished results on the map; remove layers of removed jobs.
  const map = ready?.map;
  const drawnResults = useRef(new Set<string>());
  useEffect(() => {
    if (!map) return;
    const wanted = new Set<string>();
    for (const job of jobs) {
      if (job.status === "done" && job.result) {
        wanted.add(job.id);
        addJobResult(map, job.id, job.kind, job.result);
      }
    }
    for (const id of drawnResults.current) {
      if (!wanted.has(id)) removeJobResult(map, id);
    }
    drawnResults.current = wanted;
  }, [map, jobs]);

  // Click a result to see its label and confidence.
  const resultLayerKey = jobs
    .filter((j) => j.status === "done" && j.result)
    .map((j) => fillLayerId(j.id))
    .join(",");
  useEffect(() => {
    if (!map || !resultLayerKey) return;
    const layers = resultLayerKey.split(",");
    const popup = new Popup({ closeButton: false, offset: 8 });
    const onClick = (e: MapMouseEvent) => {
      if (tool !== "select") return;
      const f = map
        .queryRenderedFeatures(e.point, { layers: layers.filter((l) => map.getLayer(l)) })
        .at(0);
      if (!f) {
        popup.remove();
        return;
      }
      const label = String(f.properties?.label ?? "object");
      const conf = Number(f.properties?.confidence ?? 0);
      popup
        .setLngLat(e.lngLat)
        .setText(`${label} · ${(conf * 100).toFixed(0)}%`)
        .addTo(map);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      popup.remove();
    };
  }, [map, resultLayerKey, tool]);

  const handleCancelJob = async (id: string) => {
    updateJob(id, { message: "Cancelling…" });
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      const body = await res.json();
      // 409 = it finished first; the next poll / current state shows that.
      if (res.ok) updateJob(id, { status: "cancelled", message: null });
      else if (body.status) updateJob(id, { status: body.status });
    } catch {
      updateJob(id, { message: "Could not cancel (network error)." });
    }
  };

  const handleRemoveJob = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (job && (job.status === "queued" || job.status === "running")) {
      // Stop the worker too; fire-and-forget.
      fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
    }
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const handleClear = () => {
    draw?.clear();
    setCounts(emptyCounts);
    setInputs({});
  };

  return (
    <div className="flex h-screen w-full">
      <Sidebar
        view={view}
        tool={tool}
        counts={counts}
        inputs={inputs}
        jobs={jobs}
        disabled={!draw}
        onViewChange={handleViewChange}
        onToolChange={changeTool}
        onRemoveInput={handleRemoveInput}
        onStart={handleStart}
        onCancelJob={handleCancelJob}
        onRemoveJob={handleRemoveJob}
        onClear={handleClear}
      />
      <main className="relative flex-1">
        <MapView onReady={setReady} />
        {ready && <DrawHint map={ready.map} draw={ready.draw} tool={tool} />}
      </main>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Point, Polygon } from "geojson";
import MapView, { type MapReady } from "@/components/map/page";
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

  const handleStart = (kind: AnalysisKind) => {
    const input = inputs[kind];
    if (!input) return;
    setJobs((prev) => [
      {
        id: crypto.randomUUID(),
        kind,
        geometry: input.geometry,
        // TODO: POST /api/detect or /api/segment to start the background
        // job, then poll /api/jobs/:id and update status / progress.
        status: "not-connected",
        createdAt: Date.now(),
      },
      ...prev,
    ]);
  };

  const handleRemoveJob = (id: string) => {
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

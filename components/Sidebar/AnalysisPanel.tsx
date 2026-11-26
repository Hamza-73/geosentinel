"use client";

import type { Point, Polygon } from "geojson";
import {
  type AnalysisInput,
  type AnalysisJob,
  type AnalysisKind,
  formatArea,
  formatLngLat,
  type JobStatus,
  polygonArea,
} from "@/components/map/drawing";

type AnalysisPanelProps = {
  kind: AnalysisKind;
  input: AnalysisInput | undefined;
  jobs: AnalysisJob[];
  /** True while the user is marking the input on the map. */
  marking: boolean;
  disabled: boolean;
  onBack: () => void;
  onMark: () => void;
  onCancelMark: () => void;
  onRemoveInput: () => void;
  onStart: () => void;
  onRemoveJob: (id: string) => void;
};

const config: Record<
  AnalysisKind,
  {
    title: string;
    intro: string;
    mark: string;
    remark: string;
    markingHint: string;
    empty: string;
    start: string;
  }
> = {
  detect: {
    title: "Object detection",
    intro: "Mark an area on the map, then run detection to find objects inside it.",
    mark: "Mark area",
    remark: "Redraw area",
    markingHint: "Click on the map to add points. Right-click to finish.",
    empty: "No area marked yet.",
    start: "Start detection",
  },
  segment: {
    title: "Segmentation",
    intro: "Mark an area around an object, then run segmentation to outline it.",
    mark: "Mark area",
    remark: "Redraw area",
    markingHint: "Click around the object to add points. Right-click to finish.",
    empty: "No area marked yet.",
    start: "Start segmentation",
  },
};

const statusStyles: Record<JobStatus, { label: string; className: string }> = {
  "not-connected": {
    label: "Not connected",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  },
  queued: {
    label: "Queued",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  running: {
    label: "Running",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  done: {
    label: "Done",
    className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  },
  error: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
};

function summarize(geometry: Point | Polygon): string {
  if (geometry.type === "Point") return formatLngLat(geometry.coordinates);
  return formatArea(polygonArea(geometry)).m2;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </h3>
  );
}

export default function AnalysisPanel({
  kind,
  input,
  jobs,
  marking,
  disabled,
  onBack,
  onMark,
  onCancelMark,
  onRemoveInput,
  onStart,
  onRemoveJob,
}: AnalysisPanelProps) {
  const c = config[kind];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="text-base font-semibold">{c.title}</h2>
      </header>

      <p className="-mt-3 text-sm text-zinc-500">{c.intro}</p>

      {/* Step 1: mark the input */}
      <section className="flex flex-col gap-2">
        <SectionTitle>1 · Area</SectionTitle>

        {marking ? (
          <div className="flex flex-col gap-2 rounded-md border border-purple-300 bg-purple-50 p-3 text-sm dark:border-purple-900 dark:bg-purple-950/40">
            <p className="font-medium text-purple-700 dark:text-purple-300">
              Marking on the map…
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">{c.markingHint}</p>
            <button
              type="button"
              onClick={onCancelMark}
              className="self-start rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
          </div>
        ) : input ? (
          <InputCard input={input} onRemove={onRemoveInput} />
        ) : (
          <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">
            {c.empty}
          </p>
        )}

        {!marking && (
          <button
            type="button"
            disabled={disabled}
            onClick={onMark}
            className="rounded-md border border-purple-600 px-3 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-purple-300 dark:hover:bg-purple-950"
          >
            {input ? c.remark : c.mark}
          </button>
        )}
      </section>

      {/* Step 2: run */}
      <section className="flex flex-col gap-2">
        <SectionTitle>2 · Run</SectionTitle>
        <button
          type="button"
          disabled={disabled || !input || marking}
          onClick={onStart}
          className="rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {c.start}
        </button>
        {!input && !marking && (
          <p className="text-xs text-zinc-500">
            Mark an area first.
          </p>
        )}
      </section>

      {jobs.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle>Jobs</SectionTitle>
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => {
              const status = statusStyles[job.status];
              return (
                <li
                  key={job.id}
                  className="flex items-start gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${status.className}`}
                      >
                        {status.label}
                      </span>
                      <time className="text-xs text-zinc-500">
                        {new Date(job.createdAt).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                      {summarize(job.geometry)}
                    </p>
                    {job.status === "not-connected" && (
                      <p className="mt-1 text-xs text-zinc-500">
                        AI service not connected yet.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveJob(job.id)}
                    aria-label="Remove job"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                  >
                    <CloseIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function InputCard({
  input,
  onRemove,
}: {
  input: AnalysisInput;
  onRemove: () => void;
}) {
  const { geometry } = input;

  return (
    <div className="flex items-start gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        {geometry.type === "Polygon" ? (
          <AreaDetails polygon={geometry} />
        ) : (
          <>
            <p className="text-xs text-zinc-500">Lat, Lng</p>
            <p className="font-mono text-sm">{formatLngLat(geometry.coordinates)}</p>
          </>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Click it on the map to edit.
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function AreaDetails({ polygon }: { polygon: Polygon }) {
  const area = formatArea(polygonArea(polygon));
  const vertices = polygon.coordinates[0].length - 1;

  return (
    <>
      <p className="text-xs text-zinc-500">Area</p>
      <p className="text-lg font-semibold tabular-nums">{area.m2}</p>
      <p className="text-xs tabular-nums text-zinc-500">
        {area.ha} · {area.km2} · {vertices} vertices
      </p>
    </>
  );
}

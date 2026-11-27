"use client";

import type { Point, Polygon } from "geojson";
import {
  type AnalysisInput,
  type AnalysisJob,
  type AnalysisKind,
  formatArea,
  formatLngLat,
  isActiveStatus,
  type JobStatus,
  polygonArea,
} from "@/components/map/drawing";
import { prettyLabel } from "@/components/map/resultLayers";
import type { ExportFormat } from "@/lib/exports";

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
  onCancelJob: (id: string) => void;
  onDownloadJob: (id: string, format: ExportFormat) => void;
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
    intro: "Draw closely around one object (a building, plane, field…), then run segmentation to trace its outline.",
    mark: "Mark area",
    remark: "Redraw area",
    markingHint: "Click around the object, keeping close to its edges. Right-click to finish.",
    empty: "No area marked yet.",
    start: "Start segmentation",
  },
};

const statusStyles: Record<JobStatus, { label: string; className: string }> = {
  starting: {
    label: "Starting",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  },
  cancelled: {
    label: "Cancelled",
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
  onCancelJob,
  onDownloadJob,
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
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onCancel={() => onCancelJob(job.id)}
                onDownload={(format) => onDownloadJob(job.id, format)}
                onRemove={() => onRemoveJob(job.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JobCard({
  job,
  onCancel,
  onDownload,
  onRemove,
}: {
  job: AnalysisJob;
  onCancel: () => void;
  onDownload: (format: ExportFormat) => void;
  onRemove: () => void;
}) {
  const status = statusStyles[job.status];
  const active = isActiveStatus(job.status);
  const cancellable = job.status === "queued" || job.status === "running";
  const pct = Math.round(job.progress * 100);
  const total = job.stats
    ? Object.values(job.stats).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs ${status.className}`}>
          {status.label}
        </span>
        <span className="flex items-center gap-1">
          <time className="text-xs text-zinc-500">
            {new Date(job.createdAt).toLocaleTimeString()}
          </time>
          {!active && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove job"
              title="Remove job and its results from the map"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              <CloseIcon />
            </button>
          )}
        </span>
      </div>

      <p className="truncate font-mono text-xs text-zinc-500">
        {summarize(job.geometry)}
      </p>

      {active && (
        <div className="flex flex-col gap-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full bg-purple-600 transition-[width] duration-500 ${
                job.status === "running" ? "" : "animate-pulse"
              }`}
              style={{ width: `${job.status === "running" ? Math.max(pct, 3) : 100}%` }}
            />
          </div>
          <div className="flex justify-between gap-2 text-xs text-zinc-500">
            <span className="truncate">{job.message}</span>
            {job.status === "running" && <span className="tabular-nums">{pct}%</span>}
          </div>
        </div>
      )}

      {job.status === "done" && job.stats && (
        <div className="text-xs">
          <p className="font-medium">
            {total} object{total === 1 ? "" : "s"} found
          </p>
          {total > 0 && (
            <ul className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-zinc-600 dark:text-zinc-400">
              {Object.entries(job.stats).map(([label, n]) => (
                <li key={label} className="contents">
                  <span>{prettyLabel(label)}</span>
                  <span className="text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {job.status === "done" && job.result && (
        <div className="flex items-center gap-1 text-xs">
          <span className="mr-1 text-zinc-500">Download</span>
          {(["geojson", "csv", "png"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onDownload(f)}
              className="rounded border border-zinc-300 px-1.5 py-0.5 uppercase hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {job.status === "error" && job.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{job.error}</p>
      )}

      {cancellable && (
        <button
          type="button"
          onClick={onCancel}
          className="self-start rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Cancel
        </button>
      )}
    </li>
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

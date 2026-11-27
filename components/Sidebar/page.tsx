"use client";

import type {
  AnalysisInput,
  AnalysisJob,
  AnalysisKind,
  DrawTool,
  FeatureCounts,
} from "@/components/map/drawing";
import type { ExportFormat } from "@/lib/exports";
import AnalysisPanel from "./AnalysisPanel";

export type SidebarView = "home" | AnalysisKind;

type SidebarProps = {
  view: SidebarView;
  tool: DrawTool;
  counts: FeatureCounts;
  inputs: Partial<Record<AnalysisKind, AnalysisInput>>;
  jobs: AnalysisJob[];
  disabled: boolean;
  onViewChange: (view: SidebarView) => void;
  onToolChange: (tool: DrawTool) => void;
  onRemoveInput: (kind: AnalysisKind) => void;
  onStart: (kind: AnalysisKind) => void;
  onCancelJob: (id: string) => void;
  onDownloadJob: (id: string, format: ExportFormat) => void;
  onRemoveJob: (id: string) => void;
  onClear: () => void;
};

type ToolButton = {
  tool: Exclude<DrawTool, "select">;
  label: string;
  description?: string;
  icon: React.ReactNode;
};

// Unused while the Draw section is commented out below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const drawTools: ToolButton[] = [
  {
    tool: "point",
    label: "Point",
    icon: <circle cx="12" cy="12" r="4" fill="currentColor" />,
  },
  {
    tool: "linestring",
    label: "Line",
    icon: (
      <polyline
        points="4,18 10,8 15,14 20,5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    ),
  },
  {
    tool: "polygon",
    label: "Polygon",
    icon: (
      <polygon
        points="12,3 21,10 17,20 7,20 3,10"
        fill="currentColor"
        fillOpacity="0.25"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    ),
  },
];

const aiTools: (ToolButton & { tool: AnalysisKind })[] = [
  {
    tool: "detect",
    label: "Object detection",
    description: "Find objects inside an area",
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </g>
    ),
  },
  {
    tool: "segment",
    label: "Segmentation",
    description: "Outline one object you draw around",
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <path
          d="M6 7l6-3 7 4-1 8-6 4-7-4z"
          strokeDasharray="3 2"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </g>
    ),
  },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </h2>
  );
}

export default function Sidebar({
  view,
  tool,
  counts,
  inputs,
  jobs,
  disabled,
  onViewChange,
  onToolChange,
  onRemoveInput,
  onStart,
  onCancelJob,
  onDownloadJob,
  onRemoveJob,
  // Used by the commented-out Clear all button below.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onClear,
}: SidebarProps) {
  // Used by the commented-out Clear all button below.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const total =
    counts.point + counts.linestring + counts.polygon + Object.keys(inputs).length;

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-r border-zinc-200 bg-white p-4 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <h1 className="text-lg font-semibold">GeoSentinel</h1>

      {view === "home" ? (
        <>
          <section className="flex flex-col gap-2">
            <SectionTitle>AI analysis</SectionTitle>
            {aiTools.map((t) => {
              const jobCount = jobs.filter((j) => j.kind === t.tool).length;
              return (
                <button
                  key={t.tool}
                  type="button"
                  disabled={disabled}
                  onClick={() => onViewChange(t.tool)}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-left text-sm transition-colors hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:border-purple-900 dark:hover:bg-purple-950/40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 shrink-0 text-purple-600"
                    aria-hidden
                  >
                    {t.icon}
                  </svg>
                  <span className="flex flex-1 flex-col">
                    <span>{t.label}</span>
                    <span className="text-xs text-zinc-500">
                      {t.description}
                    </span>
                  </span>
                  {jobCount > 0 && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                      {jobCount}
                    </span>
                  )}
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-zinc-400"
                    aria-hidden
                  >
                    <path
                      d="M9 6l6 6-6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              );
            })}
          </section>

          {/* Draw tools hidden for now.
          <section className="flex flex-col gap-2">
            <SectionTitle>Draw</SectionTitle>
            {drawTools.map((t) => renderButton(t, "blue"))}
            <p className="text-xs text-zinc-500">
              Click any shape on the map to edit it.
            </p>
          </section>
          */}

          {/* Drawn-feature counts hidden with the draw tools.
          <section className="flex flex-col gap-2">
            <SectionTitle>Features</SectionTitle>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt>Points</dt>
              <dd className="text-right tabular-nums">{counts.point}</dd>
              <dt>Lines</dt>
              <dd className="text-right tabular-nums">{counts.linestring}</dd>
              <dt>Polygons</dt>
              <dd className="text-right tabular-nums">{counts.polygon}</dd>
            </dl>
            <button
              type="button"
              disabled={disabled || total === 0}
              onClick={onClear}
              className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              Clear all
            </button>
          </section>
          */}
        </>
      ) : (
        <AnalysisPanel
          kind={view}
          input={inputs[view]}
          jobs={jobs.filter((j) => j.kind === view)}
          marking={tool === view}
          disabled={disabled}
          onBack={() => onViewChange("home")}
          onMark={() => onToolChange(view)}
          onCancelMark={() => onToolChange("select")}
          onRemoveInput={() => onRemoveInput(view)}
          onStart={() => onStart(view)}
          onCancelJob={onCancelJob}
          onDownloadJob={onDownloadJob}
          onRemoveJob={onRemoveJob}
        />
      )}
    </aside>
  );
}

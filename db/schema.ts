import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { FeatureCollection, Polygon } from "geojson";

export const JOB_KINDS = ["detect", "segment"] as const;
export const JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "error",
  "cancelled",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * AI analysis jobs (object detection / segmentation).
 *
 * Created by the Next.js API; progress, result and error are written by the
 * AI worker (Python on Modal) with plain SQL, so keep column names stable.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<JobKind>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** 0..1 */
    progress: real("progress").notNull().default(0),
    /** Human-readable progress, e.g. "Downloading tiles 12/40". */
    message: text("message"),
    /** What the user marked on the map. */
    input: jsonb("input").$type<{ polygon: Polygon }>().notNull(),
    /** GeoJSON result written by the worker. */
    result: jsonb("result").$type<FeatureCollection>(),
    /** Summary counts, e.g. { "small-vehicle": 41 }. */
    stats: jsonb("stats").$type<Record<string, number>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("jobs_kind_check", sql`${t.kind} in ('detect', 'segment')`),
    check(
      "jobs_status_check",
      sql`${t.status} in ('queued', 'running', 'done', 'error', 'cancelled')`,
    ),
    check("jobs_progress_check", sql`${t.progress} between 0 and 1`),
    index("jobs_created_at_idx").on(t.createdAt.desc()),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

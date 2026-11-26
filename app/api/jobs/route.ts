import { desc } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { parseCreateJob } from "@/lib/jobs";

/** Columns for list views: everything except the (large) result GeoJSON. */
const summaryColumns = {
  id: jobs.id,
  kind: jobs.kind,
  status: jobs.status,
  progress: jobs.progress,
  message: jobs.message,
  stats: jobs.stats,
  error: jobs.error,
  createdAt: jobs.createdAt,
  finishedAt: jobs.finishedAt,
};

/** Create a detection / segmentation job. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseCreateJob(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const [job] = await db
    .insert(jobs)
    .values({ kind: parsed.value.kind, input: { polygon: parsed.value.polygon } })
    .returning(summaryColumns);

  // TODO: hand the job to the AI service (Modal) here. Until then it stays
  // "queued".

  return Response.json(job, { status: 202 });
}

/** Most recent jobs (no result payloads). */
export async function GET() {
  const rows = await db
    .select(summaryColumns)
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(20);
  return Response.json(rows);
}

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { isUuid } from "@/lib/jobs";

const notFound = () => Response.json({ error: "Job not found." }, { status: 404 });

/** Job status, progress and (when done) result. Polled by the UI. */
export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return job ? Response.json(job) : notFound();
}

/** Cancel a job that hasn't finished. The worker checks status between steps. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();

  const [job] = await db
    .update(jobs)
    .set({ status: "cancelled", finishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["queued", "running"])))
    .returning({ id: jobs.id, status: jobs.status });

  if (job) return Response.json(job);

  // Either it doesn't exist or it already finished.
  const [existing] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  return existing
    ? Response.json(
        { error: `Job already ${existing.status}.`, ...existing },
        { status: 409 },
      )
    : notFound();
}

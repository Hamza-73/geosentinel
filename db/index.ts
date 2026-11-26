import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { applyNetworkWorkaround } from "./network";
import * as schema from "./schema";

applyNetworkWorkaround();

// Pooled Neon connection (hostname has `-pooler`) for app traffic.
// Migrations use DATABASE_URL_UNPOOLED instead (see drizzle.config.ts).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Run `neon env pull`.");
}

const globalForDb = globalThis as unknown as { pgPool?: Pool };

// Reuse one pool across hot reloads in dev.
const pool = globalForDb.pgPool ?? new Pool({ connectionString, max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

// On Vercel Fluid compute, lets idle connections close before the function
// is suspended. No-op elsewhere.
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });

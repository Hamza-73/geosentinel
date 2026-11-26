import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { applyNetworkWorkaround } from "./db/network";

// Load .env.local the same way Next.js does.
loadEnvConfig(process.cwd());
applyNetworkWorkaround();

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set. Run `neon env pull`.");

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  // Direct (non-pooled) connection: migrations need session features that
  // PgBouncer's transaction pooling doesn't support.
  dbCredentials: { url },
  strict: true,
});

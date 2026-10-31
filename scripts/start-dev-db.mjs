/**
 * Local development PostgreSQL via `embedded-postgres` (real PostgreSQL
 * binaries downloaded by npm — no Docker, no system install).
 *
 * Usage:
 *   npm run db:up        — start (foreground; Ctrl+C stops)
 *   node scripts/start-dev-db.mjs --detach — start detached (background)
 *
 * Creates the `the_good_dentist` database on first run. Data lives under
 * `.pgdata-local/` (git-ignored); delete that folder to reset.
 *
 * Connection (matches .env.example / local .env):
 *   postgres://postgres:postgres@localhost:55432/the_good_dentist
 */

import EmbeddedPostgres from "embedded-postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata-local");
const port = Number(process.env.DEV_DB_PORT ?? 55432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
});

async function main() {
  if (!fs.existsSync(dataDir)) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("the_good_dentist");
    console.log(`dev PostgreSQL ready on port ${port} (db: the_good_dentist)`);
    console.log(`DATABASE_URL="postgres://postgres:postgres@localhost:${port}/the_good_dentist?sslmode=disable"`);
  } catch (error) {
    // createDatabase fails when the DB already exists — that's fine.
    if (!String(error).includes("already exists")) throw error;
    console.log(`dev PostgreSQL ready on port ${port} (db: the_good_dentist already existed)`);
  }

  if (!process.argv.includes("--detach")) {
    process.on("SIGINT", async () => {
      await pg.stop();
      process.exit(0);
    });
    console.log("Press Ctrl+C to stop.");
  } else {
    // Detached: keep running until killed.
    console.log("Running detached.");
  }
}

main().catch((error) => {
  console.error("Failed to start embedded PostgreSQL:", error);
  process.exit(1);
});

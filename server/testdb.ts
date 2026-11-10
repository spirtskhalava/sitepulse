import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { migrate } from "./migrate";

// real postgres for tests (embedded-postgres downloads the binaries from npm).
// SKIP LOCKED / jsonb_to_recordset can't be faked with an in-memory db.
export async function startTestDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "sitepulse-pg-"));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const server = new EmbeddedPostgres({
    databaseDir: dir, port, user: "postgres", password: "test", persistent: false, createPostgresUser: true, onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("sitepulse_test");

  const pool = new pg.Pool({ connectionString: `postgres://postgres:test@localhost:${port}/sitepulse_test`, max: 10 });
  // postgres kills idle connections on shutdown, that's expected here
  pool.on("error", () => {});
  await migrate(pool);

  return {
    pool,
    async stop() {
      await pool.end();
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

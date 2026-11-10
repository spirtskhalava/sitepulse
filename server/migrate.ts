import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Db } from "./db";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");

// tiny migration runner, didn't want a whole library for 2-3 sql files
export async function migrate(db: Db) {
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(DIR, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("applied", file);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = createPool();
  migrate(db).then(() => db.end());
}

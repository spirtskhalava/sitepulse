import pg from "pg";

export type Db = pg.Pool;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_SIZE ?? 10) });
}

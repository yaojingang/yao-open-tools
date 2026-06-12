import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    prepare: false
  });

  return {
    db: drizzle(sql, { schema }),
    sql
  };
}

export type DbClient = ReturnType<typeof createDb>["db"];
export type SqlClient = ReturnType<typeof createDb>["sql"];

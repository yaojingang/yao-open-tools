import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createDb } from "./client.js";

async function findMigrationsDir(): Promise<string> {
  const currentFile = fileURLToPath(import.meta.url);
  const candidates = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "apps/api/drizzle"),
    path.resolve(path.dirname(currentFile), "../../drizzle")
  ];

  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // Try the next runtime layout.
    }
  }

  throw new Error("Could not find migrations directory");
}

export async function runMigrations() {
  const config = loadConfig();
  const { sql } = createDb(config.databaseUrl);

  try {
    await sql`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const migrationsDir = await findMigrationsDir();
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const applied = await sql<{ name: string }[]>`
        select name from schema_migrations where name = ${file} limit 1
      `;

      if (applied.length > 0) {
        continue;
      }

      const migrationSql = await readFile(path.join(migrationsDir, file), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migrationSql);
        await transaction`insert into schema_migrations (name) values (${file})`;
      });

      console.log(`Applied migration ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

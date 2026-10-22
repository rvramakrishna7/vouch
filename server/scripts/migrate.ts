import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attempt to load .env if DATABASE_URL is not set
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 10000,
});

async function runMigrations() {
  await client.connect();

  try {
    // Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Find migrations directory: can be in ../../db/migrations relative to server/scripts
    const candidates = [
      path.resolve(__dirname, "../../db/migrations"),
      path.resolve(process.cwd(), "db/migrations"),
      path.resolve(process.cwd(), "../db/migrations"),
    ];

    const migrationsDir = candidates.find((dir) => fs.existsSync(dir));
    if (!migrationsDir) {
      throw new Error(`Migrations directory not found in: ${candidates.join(", ")}`);
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const { rows: appliedRows } = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        count++;
        console.log(`Applied migration: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`Migration ${file} failed:`, err);
        throw err;
      }
    }

    if (count === 0) {
      console.log("Database schema is up to date. No pending migrations.");
    } else {
      console.log(`Successfully applied ${count} migration(s).`);
    }
  } finally {
    await client.end();
  }
}

runMigrations().catch((err) => {
  console.error("Migration execution failed:", err);
  process.exit(1);
});

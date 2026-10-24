import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { timingStorage } from "../middleware/timing.js";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-load .env in development/testing if DATABASE_URL is not set
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore if cannot load
    }
  }
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL environment variable is not set");
}

let sslConfig: pg.ConnectionConfig["ssl"];
const caCert = process.env.SUPABASE_CA_CERT;

if (caCert) {
  sslConfig = {
    rejectUnauthorized: true,
    ca: caCert,
  };
} else {
  console.warn("[pool] SUPABASE_CA_CERT not set; TLS running with rejectUnauthorized: false (DEC-016)");
  sslConfig = {
    rejectUnauthorized: false,
  };
}

export const pool = new Pool({
  connectionString,
  ssl: sslConfig,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Attach database pool for Vercel Fluid Compute lifecycle management
if (process.env.VERCEL) {
  try {
    attachDatabasePool(pool);
  } catch {
    // Ignore in environments where Vercel function context is absent
  }
}

// Eagerly connect at module load to warm pool connection
pool.query("SELECT 1").catch((err) => {
  console.warn("[pool] eager connection warmup:", (err as any)?.message);
});

// Instrument pool.query to track database time in timingStorage
const rawPoolQuery = pool.query.bind(pool);
pool.query = (async (...args: any[]) => {
  const start = performance.now();
  try {
    return await (rawPoolQuery as any)(...args);
  } finally {
    const store = timingStorage.getStore();
    if (store) {
      store.dbTime += performance.now() - start;
    }
  }
}) as typeof pool.query;

// Instrument pool.connect to track transaction client queries
const rawPoolConnect = pool.connect.bind(pool);
(pool as any).connect = ((callback?: any) => {
  if (typeof callback === "function") {
    return rawPoolConnect(callback);
  }
  return rawPoolConnect().then((client) => {
    const rawClientQuery = client.query.bind(client);
    client.query = (async (...args: any[]) => {
      const start = performance.now();
      try {
        return await (rawClientQuery as any)(...args);
      } finally {
        const store = timingStorage.getStore();
        if (store) {
          store.dbTime += performance.now() - start;
        }
      }
    }) as typeof client.query;
    return client;
  });
}) as typeof pool.connect;

export default pool;

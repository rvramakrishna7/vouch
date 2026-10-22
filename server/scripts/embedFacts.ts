import { ensureFactEmbeddings } from "../src/ai/factEmbeddings.js";
import pool from "../src/db/pool.js";

async function main() {
  console.log("[embed:facts] Starting fact embedding job across all organizations...");
  try {
    const result = await ensureFactEmbeddings();
    console.log(
      `[embed:facts] Finished successfully. Total needing embeddings: ${result.total}, updated: ${result.updated}`,
    );
  } catch (err: any) {
    console.error("[embed:facts] Error generating embeddings:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

import pool from "../db/pool.js";
import { embed } from "./adapter.js";

/**
 * Ensures all facts in the given organization (or all organizations if omitted)
 * have vector embeddings populated in facts.embedding.
 * Processes in batches of up to 20 facts at a time.
 */
export async function ensureFactEmbeddings(
  organizationId?: string,
): Promise<{ total: number; updated: number }> {
  let queryText =
    "SELECT id, organization_id, code, statement FROM facts WHERE embedding IS NULL ORDER BY code ASC";
  const params: any[] = [];

  if (organizationId) {
    queryText =
      "SELECT id, organization_id, code, statement FROM facts WHERE organization_id = $1 AND embedding IS NULL ORDER BY code ASC";
    params.push(organizationId);
  }

  const { rows } = await pool.query<{
    id: string;
    organization_id: string;
    code: string;
    statement: string;
  }>(queryText, params);

  if (rows.length === 0) {
    return { total: 0, updated: 0 };
  }

  const batchSize = 20;
  let updatedCount = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const statements = chunk.map((r) => r.statement);

    const vectors = await embed(statements);

    for (let j = 0; j < chunk.length; j++) {
      const fact = chunk[j];
      const vector = vectors[j];
      const vectorLiteral = `[${vector.join(",")}]`;

      await pool.query(
        "UPDATE facts SET embedding = $1::vector WHERE id = $2",
        [vectorLiteral, fact.id],
      );
      updatedCount++;
    }
  }

  return { total: rows.length, updated: updatedCount };
}

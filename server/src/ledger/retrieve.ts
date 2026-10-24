import { type Pool } from "pg";
import { embed } from "../ai/adapter.js";
import { ensureFactEmbeddings } from "../ai/factEmbeddings.js";
import { timingStorage } from "../middleware/timing.js";

export interface FactCandidate {
  id: string;
  code: string;
  statement: string;
  valid_until: string;
  dist?: number;
}

/**
 * Retrieves up to 12 candidate facts relevant to the given sentences.
 * Embeds all sentences in ONE batch call.
 * For each sentence, selects the top 3 facts by cosine distance in pgvector.
 * Returns the union of top facts sorted by relevance, max 12.
 * If embedding fails and the organization has 30 facts or fewer, falls back to all facts.
 */
export async function retrieveCandidateFacts(
  organizationId: string,
  sentences: Array<{ text: string }>,
  pool: Pool,
): Promise<FactCandidate[]> {
  const sentenceTexts = sentences.map((s) => s.text).filter((t) => t.trim().length > 0);
  if (sentenceTexts.length === 0) {
    return [];
  }

  try {
    // 1. Ensure all facts in the org have embeddings
    await ensureFactEmbeddings(organizationId);

    // 2. Embed all sentences in one batch call
    const embedStart = performance.now();
    const vectors = await embed(sentenceTexts);
    const timingStore = timingStorage.getStore();
    if (timingStore) {
      timingStore.embedTime += performance.now() - embedStart;
    }

    // 3. Query top 3 facts per sentence using pgvector <=> cosine distance
    const candidateMap = new Map<string, FactCandidate & { dist: number }>();

    for (const vector of vectors) {
      const vecLiteral = `[${vector.join(",")}]`;
      const { rows } = await pool.query<{
        id: string;
        code: string;
        statement: string;
        valid_until: string;
        dist: number;
      }>(
        `SELECT id, code, statement, valid_until, embedding <=> $1::vector(768) as dist
         FROM facts
         WHERE organization_id = $2 AND embedding IS NOT NULL
         ORDER BY dist ASC
         LIMIT 3`,
        [vecLiteral, organizationId],
      );

      for (const r of rows) {
        if (!candidateMap.has(r.id)) {
          candidateMap.set(r.id, r);
        } else {
          const existing = candidateMap.get(r.id)!;
          if (r.dist < existing.dist) {
            existing.dist = r.dist;
          }
        }
      }
    }

    // Sort union by distance and take up to 12 candidates
    const candidates = Array.from(candidateMap.values())
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 12);

    return candidates;
  } catch (err: any) {
    // Fallback: If embedding fails and org has 30 facts or fewer, use all facts
    const { rows: countRows } = await pool.query<{ count: string }>(
      "SELECT count(*) as count FROM facts WHERE organization_id = $1",
      [organizationId],
    );
    const factCount = parseInt(countRows[0]?.count || "0", 10);

    if (factCount <= 30) {
      const { rows: allFacts } = await pool.query<FactCandidate>(
        `SELECT id, code, statement, valid_until
         FROM facts
         WHERE organization_id = $1
         ORDER BY code ASC
         LIMIT 30`,
        [organizationId],
      );
      return allFacts;
    }

    // If facts exceed 30 and embedding failed, rethrow to mark ai_status = 'unavailable'
    throw err;
  }
}

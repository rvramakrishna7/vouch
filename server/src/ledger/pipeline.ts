import { z } from "zod";
import { type Pool } from "pg";
import { generateJson } from "../ai/adapter.js";
import { wrapUserContent, PROMPT_INJECTION_SYSTEM_GUARD } from "../ai/guard.js";
import { AiInvalidOutputError, AiUnavailableError } from "../ai/types.js";
import { splitIntoSentences } from "./sentences.js";
import { retrieveCandidateFacts, type FactCandidate } from "./retrieve.js";

export const claimExtractionSchema = z.object({
  claims: z.array(
    z.object({
      quote: z.string(),
      occurrence: z.number().int().positive().optional(),
      verdict: z.enum(["supported", "contradicted", "unsupported", "outdated"]),
      fact_code: z.string().nullable(),
      rule_code: z.string().nullable(),
      reason: z.string(),
      confidence: z.number().min(0).max(1),
      suggested_fix: z.string().nullable(),
    }),
  ),
});

export type ExtractedClaim = z.infer<typeof claimExtractionSchema>["claims"][number];

export interface ValidatedClaimFinding {
  kind: "claim";
  span_text: string;
  start_offset: number | null;
  end_offset: number | null;
  verdict: "supported" | "contradicted" | "unsupported" | "outdated" | "needs_human_judgement";
  fact_id: string | null;
  fact_code: string | null;
  fact_statement?: string | null;
  fact_valid_until?: string | null;
  rule_id: string | null;
  rule_code: string | null;
  rule_text?: string | null;
  reason: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  suggested_fix: string | null;
}

export interface ClaimLedgerResult {
  findings: ValidatedClaimFinding[];
  aiStatus: "ok" | "unavailable" | "invalid_output" | "skipped";
  aiProvider: string | null;
  aiModel: string | null;
  aiLatencyMs: number | null;
}

interface ClaimsRule {
  id: string;
  code: string;
  severity: "high" | "medium" | "low";
  text: string;
}

function findQuoteOffsets(
  fullText: string,
  quote: string,
  occurrence = 1,
): { startOffset: number; endOffset: number } | null {
  if (!quote || quote.length === 0) return null;
  let fromIndex = 0;
  let foundIndex = -1;
  const targetOcc = Math.max(1, occurrence);

  for (let i = 0; i < targetOcc; i++) {
    foundIndex = fullText.indexOf(quote, fromIndex);
    if (foundIndex === -1) {
      break;
    }
    fromIndex = foundIndex + 1;
  }

  // Fallback to first occurrence if specific occurrence not reached
  if (foundIndex === -1) {
    foundIndex = fullText.indexOf(quote);
  }

  if (foundIndex === -1) {
    return null;
  }

  return {
    startOffset: foundIndex,
    endOffset: foundIndex + quote.length,
  };
}

/**
 * Executes the Claim Ledger pipeline:
 * 1. Split text into sentences with character offsets
 * 2. Retrieve top candidate facts (max 12) via pgvector embeddings
 * 3. Extract & verify claims in ONE LLM call
 * 4. Strictly validate all citations, quotes, offsets, and expiry in code
 */
export async function runClaimLedger(options: {
  organizationId: string;
  body: string;
  purpose: string;
  audience: string;
  channel: string;
  pool: Pool;
}): Promise<ClaimLedgerResult> {
  const { organizationId, body, purpose, audience, channel, pool } = options;

  // 1. Split sentences
  const sentences = splitIntoSentences(body);

  // 2. Fetch candidate facts
  let candidateFacts: FactCandidate[] = [];
  try {
    candidateFacts = await retrieveCandidateFacts(organizationId, sentences, pool);
  } catch (err) {
    console.warn("[ClaimLedger] Fact retrieval failed:", (err as any)?.message);
    return {
      findings: [],
      aiStatus: "unavailable",
      aiProvider: null,
      aiModel: null,
      aiLatencyMs: null,
    };
  }

  // Fetch active claims rules
  const { rows: claimsRules } = await pool.query<ClaimsRule>(
    `SELECT id, code, severity, text
     FROM rules
     WHERE organization_id = $1 AND category = 'claims' AND status = 'active'
     ORDER BY code ASC`,
    [organizationId],
  );

  const rulesMap = new Map<string, ClaimsRule>();
  for (const r of claimsRules) {
    rulesMap.set(r.code.toUpperCase(), r);
  }

  const candidateMap = new Map<string, FactCandidate>();
  for (const f of candidateFacts) {
    candidateMap.set(f.code.toUpperCase(), f);
  }

  // Prepare prompt variables
  const todayStr = new Date().toISOString().slice(0, 10);
  const factsListFormatted = candidateFacts
    .map((f) => {
      const isExpired = new Date(f.valid_until) < new Date(todayStr);
      return `- [${f.code}] "${f.statement}" (valid until: ${f.valid_until}, expired: ${isExpired})`;
    })
    .join("\n");

  const rulesListFormatted = claimsRules
    .map((r) => `- [${r.code}] (${r.severity}): ${r.text}`)
    .join("\n");

  const systemPrompt =
    `${PROMPT_INJECTION_SYSTEM_GUARD}\n\n` +
    `You are Vouch's brand-governance claim verification engine. Your task is to extract every factual or promotional claim ` +
    `from marketing content and verify each claim against approved brand facts and claims rules.\n\n` +
    `A claim is any factual or promotional statement, including numbers, durations, percentages, rankings, superlatives, ` +
    `environmental attributes, health benefits, performance, or ratings.\n\n` +
    `Use ONLY the provided facts. Do NOT invent facts or cite facts outside the candidate list.\n` +
    `Rules for verdict:\n` +
    `- "supported": an approved, in-date fact directly states and supports this claim. Must cite fact_code.\n` +
    `- "contradicted": an approved fact says something different or incompatible with this claim. Must cite fact_code.\n` +
    `- "outdated": only an expired fact covers this claim. Must cite fact_code.\n` +
    `- "unsupported": no approved fact covers this claim. Set fact_code: null and cite the applicable claims rule_code.\n\n` +
    `quote requirements:\n` +
    `- quote MUST be copied verbatim from the submitted content.\n` +
    `- occurrence is an optional 1-based integer if the quote appears multiple times.\n\n` +
    `suggested_fix requirements:\n` +
    `- Must preserve the author's declared purpose.\n` +
    `- Must use ONLY the approved facts.\n` +
    `- null if no honest fix exists.\n\n` +
    `Today's date is: ${todayStr}.\n\n` +
    `Return JSON strictly matching this schema:\n` +
    `{ "claims": [ { "quote": string, "occurrence": number, "verdict": "supported"|"contradicted"|"unsupported"|"outdated", "fact_code": string|null, "rule_code": string|null, "reason": string, "confidence": number (0..1), "suggested_fix": string|null } ] }`;

  const userPrompt =
    `Declared Content Context:\n` +
    `- Channel: ${channel}\n` +
    `- Audience: ${audience}\n` +
    `- Purpose: ${purpose}\n\n` +
    `Candidate Approved Brand Facts:\n${factsListFormatted || "(No candidate facts found)"}\n\n` +
    `Active Brand Claims Rules:\n${rulesListFormatted || "(No active claims rules found)"}\n\n` +
    `Content to Review:\n${wrapUserContent(body)}`;

  // 3. Extract & verify via single LLM call
  let aiRes: Awaited<ReturnType<typeof generateJson<z.infer<typeof claimExtractionSchema>>>>;
  try {
    aiRes = await generateJson({
      system: systemPrompt,
      user: userPrompt,
      schema: claimExtractionSchema,
      timeoutMs: 25000,
    });
  } catch (err: any) {
    if (err instanceof AiInvalidOutputError) {
      console.warn("[ClaimLedger] Model returned invalid schema:", err.message);
      return {
        findings: [],
        aiStatus: "invalid_output",
        aiProvider: null,
        aiModel: null,
        aiLatencyMs: null,
      };
    }
    console.warn("[ClaimLedger] AI call failed:", err?.message || err);
    return {
      findings: [],
      aiStatus: "unavailable",
      aiProvider: null,
      aiModel: null,
      aiLatencyMs: null,
    };
  }

  // 4. Validate in code (Invariant 2: The model never has the final word on evidence)
  const validatedFindings: ValidatedClaimFinding[] = [];
  const claim03Rule = rulesMap.get("CLAIM-03");

  for (const rawClaim of aiRes.data.claims) {
    // 4a. Quote & offset validation
    const offsets = findQuoteOffsets(body, rawClaim.quote, rawClaim.occurrence || 1);
    let finalVerdict: ValidatedClaimFinding["verdict"] = rawClaim.verdict;
    let finalFactId: string | null = null;
    let finalFactCode: string | null = null;
    let finalFactStatement: string | null = null;
    let finalFactValidUntil: string | null = null;
    let finalRuleId: string | null = null;
    let finalRuleCode: string | null = null;
    let finalRuleText: string | null = null;

    if (!offsets) {
      // Quoted span not in content -> needs_human_judgement
      finalVerdict = "needs_human_judgement";
    }

    // 4b. Fact validation for supported / contradicted / outdated
    if (
      finalVerdict === "supported" ||
      finalVerdict === "contradicted" ||
      finalVerdict === "outdated"
    ) {
      const citedFactCode = rawClaim.fact_code?.toUpperCase().trim();
      const matchedFact = citedFactCode ? candidateMap.get(citedFactCode) : null;

      if (!matchedFact) {
        // Cited fact not in candidate set -> needs_human_judgement
        finalVerdict = "needs_human_judgement";
      } else {
        finalFactId = matchedFact.id;
        finalFactCode = matchedFact.code;
        finalFactStatement = matchedFact.statement;
        finalFactValidUntil = matchedFact.valid_until;

        // Code decides expiry from valid_until vs today
        const isExpired = new Date(matchedFact.valid_until) < new Date(todayStr);

        if (isExpired) {
          // If fact is expired, verdict must be outdated
          finalVerdict = "outdated";
        } else if (rawClaim.verdict === "outdated" && !isExpired) {
          // Model claimed outdated but fact is still in date -> needs_human_judgement
          finalVerdict = "needs_human_judgement";
        }
      }
    }

    // 4c. Rule validation
    if (finalVerdict === "unsupported") {
      finalFactId = null;
      finalFactCode = null;
      const citedRuleCode = rawClaim.rule_code?.toUpperCase().trim();
      const matchedRule = citedRuleCode ? rulesMap.get(citedRuleCode) : null;

      if (matchedRule) {
        finalRuleId = matchedRule.id;
        finalRuleCode = matchedRule.code;
        finalRuleText = matchedRule.text;
      } else {
        // Invariant 1: No citation, no violation -> rule_code = null (suggestion only)
        finalRuleId = null;
        finalRuleCode = null;
        finalRuleText = null;
      }
    } else if (finalVerdict === "contradicted" || finalVerdict === "outdated") {
      // Spec: contradicted and outdated cite rule CLAIM-03 when it is active
      if (claim03Rule) {
        finalRuleId = claim03Rule.id;
        finalRuleCode = claim03Rule.code;
        finalRuleText = claim03Rule.text;
      } else {
        const citedRuleCode = rawClaim.rule_code?.toUpperCase().trim();
        const matchedRule = citedRuleCode ? rulesMap.get(citedRuleCode) : null;
        if (matchedRule) {
          finalRuleId = matchedRule.id;
          finalRuleCode = matchedRule.code;
          finalRuleText = matchedRule.text;
        }
      }
    }

    // 4d. Severity assignment
    let severity: "high" | "medium" | "low";
    if (finalVerdict === "supported") {
      // Supported claims are not issues; marked low
      severity = "low";
    } else if (finalVerdict === "needs_human_judgement") {
      severity = "medium";
    } else if (finalRuleCode && rulesMap.has(finalRuleCode)) {
      severity = rulesMap.get(finalRuleCode)!.severity;
    } else {
      severity = "medium";
    }

    validatedFindings.push({
      kind: "claim",
      span_text: rawClaim.quote,
      start_offset: offsets ? offsets.startOffset : null,
      end_offset: offsets ? offsets.endOffset : null,
      verdict: finalVerdict,
      fact_id: finalFactId,
      fact_code: finalFactCode,
      fact_statement: finalFactStatement,
      fact_valid_until: finalFactValidUntil,
      rule_id: finalRuleId,
      rule_code: finalRuleCode,
      rule_text: finalRuleText,
      reason: rawClaim.reason,
      severity,
      confidence: Math.max(0, Math.min(1, rawClaim.confidence || 0.8)),
      suggested_fix: rawClaim.suggested_fix || null,
    });
  }

  return {
    findings: validatedFindings,
    aiStatus: "ok",
    aiProvider: aiRes.provider,
    aiModel: aiRes.model,
    aiLatencyMs: Math.round(aiRes.latencyMs),
  };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import pool from "../src/db/pool.js";
import { signToken } from "../src/auth/jwt.js";
import {
  setDraftGeneratorHook,
  setEmbedderHook,
  clearRuleEmbeddingCache,
  cosineSimilarity,
  type GuidelineDraft,
} from "../src/guidelines/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

const hasDb = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDb)("Guideline Import API (Task S11)", () => {
  let creatorToken: string;
  let reviewerToken: string;
  let brandManagerToken: string;
  let northwindManagerToken: string;
  let aqualeafOrgId: string;
  let northwindOrgId: string;

  const createdRuleIds: string[] = [];

  const SAMPLE_GUIDELINE = `
Welcome to the Aqualeaf editorial standard.
Never use unverified superlatives or number one rankings without approved survey backing.
Adopt an encouraging active voice that speaks directly to the reader using you rather than impersonal prose.
All numeric figures, percentages, and duration claims must cite approved in-date facts.
Always refer to the product as an insulated steel bottle.
`.trim();

  beforeAll(async () => {
    // 1. Creator login
    const creatorRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator" });
    expect(creatorRes.status).toBe(200);
    creatorToken = creatorRes.body.token;

    // 2. Reviewer login
    const reviewerRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "reviewer" });
    expect(reviewerRes.status).toBe(200);
    reviewerToken = reviewerRes.body.token;

    // 3. Brand manager login
    const bmRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "brand_manager" });
    expect(bmRes.status).toBe(200);
    brandManagerToken = bmRes.body.token;
    aqualeafOrgId = bmRes.body.organization.id;

    // 4. Northwind brand manager token
    const { rows: nwRows } = await pool.query<{
      id: string;
      organization_id: string;
    }>(
      `SELECT u.id, u.organization_id
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE o.slug = 'northwind-labs'
       LIMIT 1`,
    );
    expect(nwRows.length).toBeGreaterThan(0);
    northwindOrgId = nwRows[0].organization_id;
    northwindManagerToken = signToken({
      sub: nwRows[0].id,
      org: northwindOrgId,
      role: "brand_manager",
    });
  });

  beforeEach(() => {
    setDraftGeneratorHook(null);
    setEmbedderHook(null);
    clearRuleEmbeddingCache();
  });

  afterEach(() => {
    setDraftGeneratorHook(null);
    setEmbedderHook(null);
  });

  afterAll(async () => {
    for (const rid of createdRuleIds) {
      await pool.query("DELETE FROM rules WHERE id = $1", [rid]);
    }
  });

  it("POST /api/guidelines/draft rejects non-brand-manager with 403", async () => {
    const resCreator = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ text: SAMPLE_GUIDELINE });
    expect(resCreator.status).toBe(403);

    const resReviewer = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ text: SAMPLE_GUIDELINE });
    expect(resReviewer.status).toBe(403);
  });

  it("POST /api/guidelines/draft validates text length (50..20000 chars)", async () => {
    const resShort = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: "Too short text" });
    expect(resShort.status).toBe(400);
    expect(resShort.body.error).toBe("invalid_input");
  });

  it("POST /api/guidelines/draft drops drafts with hallucinated quotes and counts them in rejected", async () => {
    setDraftGeneratorHook(async () => ({
      rules: [
        {
          category: "claims",
          severity: "high",
          text: "Never use unverified superlatives without approved survey backing.",
          source_quote: "Never use unverified superlatives or number one rankings without approved survey backing.",
        },
        {
          category: "tone",
          severity: "medium",
          text: "Do not use aggressive marketing tricks.",
          source_quote: "This sentence does not exist anywhere in the guideline text at all.",
        },
      ],
      provider: "test-mock",
      model: "test-model",
      latency_ms: 150,
    }));

    // Mock embedding returns matching vectors
    setEmbedderHook(async (texts: string[]) => {
      return texts.map(() => Array.from({ length: 768 }, () => 0.01));
    });

    const res = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: SAMPLE_GUIDELINE });

    expect(res.status).toBe(200);
    expect(res.body.source_text).toBeDefined();
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.rejected).toBe(1);
    expect(res.body.drafts[0].source_quote).toBe(
      "Never use unverified superlatives or number one rankings without approved survey backing.",
    );
    expect(res.body.drafts[0].source_start).toBeGreaterThanOrEqual(0);
    expect(res.body.drafts[0].source_end).toBeGreaterThan(res.body.drafts[0].source_start);
    // Exact slice invariant test
    const sliced = res.body.source_text.slice(res.body.drafts[0].source_start, res.body.drafts[0].source_end);
    expect(sliced).toBe(res.body.drafts[0].source_quote);
  });

  it("POST /api/guidelines/draft assigns rule codes by code as the next free code", async () => {
    // Aqualeaf has CLAIM-01..04, TONE-01..02, TERM-01..02, ACC-01..02
    setDraftGeneratorHook(async () => ({
      rules: [
        {
          category: "claims",
          severity: "high",
          text: "Numeric metrics must cite in-date facts.",
          source_quote: "All numeric figures, percentages, and duration claims must cite approved in-date facts.",
        },
        {
          category: "tone",
          severity: "low",
          text: "Speak directly to reader using you.",
          source_quote: "Adopt an encouraging active voice that speaks directly to the reader using you rather than impersonal prose.",
        },
        {
          category: "terminology",
          severity: "low",
          text: "Refer to product as an insulated steel bottle.",
          source_quote: "Always refer to the product as an insulated steel bottle.",
        },
      ],
      provider: "test-mock",
      model: "test-model",
      latency_ms: 200,
    }));

    setEmbedderHook(async (texts: string[]) => {
      // Orthogonal vectors -> cosine = 0 (no duplicate)
      return texts.map((_, idx) => {
        const v = Array.from({ length: 768 }, () => 0);
        v[idx % 768] = 1;
        return v;
      });
    });

    const res = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: SAMPLE_GUIDELINE });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(3);

    const claimDraft = res.body.drafts.find((d: GuidelineDraft) => d.category === "claims");
    const toneDraft = res.body.drafts.find((d: GuidelineDraft) => d.category === "tone");
    const termDraft = res.body.drafts.find((d: GuidelineDraft) => d.category === "terminology");

    // Read current max codes from DB to compute expected codes
    const { rows: dbRules } = await pool.query<{ code: string }>(
      "SELECT code FROM rules WHERE organization_id = $1 AND status != 'archived'",
      [aqualeafOrgId],
    );
    let maxClaim = 0;
    let maxTone = 0;
    let maxTerm = 0;
    for (const r of dbRules) {
      const parts = r.code.split("-");
      const num = parseInt(parts[1], 10);
      if (!isNaN(num)) {
        if (parts[0] === "CLAIM" && num > maxClaim) maxClaim = num;
        if (parts[0] === "TONE" && num > maxTone) maxTone = num;
        if (parts[0] === "TERM" && num > maxTerm) maxTerm = num;
      }
    }

    expect(claimDraft?.code).toBe(`CLAIM-${String(maxClaim + 1).padStart(2, "0")}`);
    expect(toneDraft?.code).toBe(`TONE-${String(maxTone + 1).padStart(2, "0")}`);
    expect(termDraft?.code).toBe(`TERM-${String(maxTerm + 1).padStart(2, "0")}`);
  });

  it("POST /api/guidelines/draft flags duplicates when cosine similarity >= 0.85", async () => {
    setDraftGeneratorHook(async () => ({
      rules: [
        {
          category: "claims",
          severity: "high",
          text: "No superlatives or rankings without approved facts.",
          source_quote: "Never use unverified superlatives or number one rankings without approved survey backing.",
        },
      ],
      provider: "test-mock",
      model: "test-model",
      latency_ms: 100,
    }));

    // Mock embedding: make draft embedding identical to CLAIM-01 text embedding
    setEmbedderHook(async (texts: string[]) => {
      return texts.map((t) => {
        if (t.includes("superlatives") || t.includes("rankings")) {
          // Same vector
          return Array.from({ length: 768 }, () => 0.05);
        }
        // Different vector
        return Array.from({ length: 768 }, () => -0.05);
      });
    });

    const res = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: SAMPLE_GUIDELINE });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].duplicate_of).toBe("CLAIM-01");
  });

  it("POST /api/guidelines/draft accepts LLM proposed duplicate_of when cosine >= 0.70", async () => {
    setDraftGeneratorHook(async () => ({
      rules: [
        {
          category: "claims",
          severity: "high",
          text: "Avoid unproven best-in-market statements.",
          source_quote: "Never use unverified superlatives or number one rankings without approved survey backing.",
          duplicate_of: "CLAIM-01",
        },
      ],
      provider: "test-mock",
      model: "test-model",
      latency_ms: 100,
    }));

    // Mock embedding so that similarity to CLAIM-01 is ~0.75 (>= 0.70)
    setEmbedderHook(async (texts: string[]) => {
      return texts.map((t) => {
        const v = Array.from({ length: 768 }, () => 0);
        if (t.includes("CLAIM-01") || t.includes("superlatives") || t.includes("No superlatives") || t.includes("Avoid unproven")) {
          v[0] = 1;
          v[1] = 0.5; // norm = sqrt(1.25) = 1.118
        } else {
          v[2] = 1;
        }
        return v;
      });
    });

    const res = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: SAMPLE_GUIDELINE });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].duplicate_of).toBe("CLAIM-01");
    // Verify source_text slice
    expect(res.body.source_text.slice(res.body.drafts[0].source_start, res.body.drafts[0].source_end))
      .toBe(res.body.drafts[0].source_quote);
  });

  it("POST /api/guidelines/draft rejects LLM proposed duplicate_of when cosine < 0.70", async () => {
    setDraftGeneratorHook(async () => ({
      rules: [
        {
          category: "accessibility",
          severity: "medium",
          text: "Always provide closed captions on audio.",
          source_quote: "Adopt an encouraging active voice that speaks directly to the reader using you rather than impersonal prose.",
          duplicate_of: "CLAIM-01", // Hallucinated duplicate
        },
      ],
      provider: "test-mock",
      model: "test-model",
      latency_ms: 100,
    }));

    // Orthogonal embeddings -> cosine = 0 (< 0.70)
    let callOffset = 0;
    setEmbedderHook(async (texts: string[]) => {
      const res = texts.map((_, idx) => {
        const v = Array.from({ length: 768 }, () => 0);
        v[(callOffset + idx) % 768] = 1;
        return v;
      });
      callOffset += texts.length;
      return res;
    });

    const res = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: SAMPLE_GUIDELINE });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    // Hallucinated duplicate rejected because cosine < 0.70
    expect(res.body.drafts[0].duplicate_of).toBeNull();
  });

  it("POST /api/guidelines/draft returns 503 ai_unavailable on AI failure", async () => {
    setDraftGeneratorHook(async () => {
      const err = new Error("Simulated 503 AI failure");
      (err as any).status = 503;
      throw err;
    });

    const res = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({ text: SAMPLE_GUIDELINE });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ai_unavailable");
  });

  it("POST /api/guidelines/apply rejects non-brand-manager with 403", async () => {
    const res = await request(app)
      .post("/api/guidelines/apply")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        rules: [
          {
            code: "CLAIM-99",
            category: "claims",
            text: "Test rule",
            severity: "high",
          },
        ],
      });
    expect(res.status).toBe(403);
  });

  it("POST /api/guidelines/apply returns 409 code_taken if code is already in use", async () => {
    const res = await request(app)
      .post("/api/guidelines/apply")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        rules: [
          {
            code: "CLAIM-01", // Already exists in Aqualeaf
            category: "claims",
            text: "Conflicting rule statement",
            severity: "high",
          },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("code_taken");
    expect(res.body.code).toBe("CLAIM-01");
  });

  it("POST /api/guidelines/apply inserts rules in transaction and writes rules.import audit event", async () => {
    // Find next free code for ACC
    const res = await request(app)
      .post("/api/guidelines/apply")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        rules: [
          {
            code: "ACC-88",
            category: "accessibility",
            text: "Provide descriptive alt text for all campaign visuals.",
            severity: "medium",
            source_quote: "Graphic Accessibility directive",
          },
          {
            code: "TONE-88",
            category: "tone",
            text: "Never use artificial fear triggers or extreme urgency.",
            severity: "medium",
            source_quote: "Ethical Urgency directive",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.rules).toHaveLength(2);

    for (const r of res.body.rules) {
      createdRuleIds.push(r.id);
      expect(r.version).toBe(1);
      expect(r.status).toBe("active");
    }

    // Check audit event
    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_events WHERE action = 'rules.import' AND organization_id = $1 ORDER BY at DESC LIMIT 1`,
      [aqualeafOrgId],
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].payload.count).toBe(2);
    expect(auditRows[0].payload.codes).toContain("ACC-88");
    expect(auditRows[0].payload.codes).toContain("TONE-88");
  });

  it("Northwind isolation: Northwind rules are completely isolated from Aqualeaf", async () => {
    // Northwind currently has 0 rules. Next claims code for Northwind should be CLAIM-01
    const nwGuideline = "This is a sample guideline for Northwind Labs. Northwind claims must be honest and verified.";
    setDraftGeneratorHook(async () => ({
      rules: [
        {
          category: "claims",
          severity: "high",
          text: "Northwind claims must be honest.",
          source_quote: "Northwind claims must be honest and verified.",
        },
      ],
      provider: "test-mock",
      model: "test-model",
      latency_ms: 100,
    }));

    const resDraft = await request(app)
      .post("/api/guidelines/draft")
      .set("Authorization", `Bearer ${northwindManagerToken}`)
      .send({ text: nwGuideline });

    expect(resDraft.status).toBe(200);
    // Since Northwind has 0 existing claims rules, it gets CLAIM-01
    expect(resDraft.body.drafts).toHaveLength(1);
    expect(resDraft.body.drafts[0].code).toBe("CLAIM-01");
  });
});

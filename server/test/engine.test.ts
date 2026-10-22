import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import pool from "../src/db/pool.js";
import { signToken } from "../src/auth/jwt.js";
import {
  runRuleChecks,
  type RuleInput,
  type TermInput,
} from "../src/engine/ruleChecks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

const hasDb = Boolean(process.env.DATABASE_URL);

describe("runRuleChecks pure engine", () => {
  const rules: RuleInput[] = [
    {
      code: "CLAIM-01",
      category: "claims",
      severity: "high",
      text: "No superlatives or rankings without ranking fact",
      status: "active",
    },
    {
      code: "CLAIM-02",
      category: "claims",
      severity: "high",
      text: "Environmental claims must name specific attribute",
      status: "active",
    },
    {
      code: "TONE-02",
      category: "tone",
      severity: "low",
      text: "No ALL CAPS words; at most one exclamation mark per piece",
      status: "active",
    },
    {
      code: "TERM-01",
      category: "terminology",
      severity: "medium",
      text: 'The brand name is always "Aqualeaf" (never "AquaLeaf" or "Aqua Leaf")',
      status: "active",
    },
    {
      code: "ACC-01",
      category: "accessibility",
      severity: "medium",
      text: "Sentences of 25 words or fewer",
      status: "active",
    },
    {
      code: "ACC-02",
      category: "accessibility",
      severity: "low",
      text: "Multi-word hashtags use CamelCase",
      status: "active",
    },
  ];

  const terms: TermInput[] = [
    {
      term: "No.1",
      type: "banned",
      rule_code: "CLAIM-01",
      replacement: null,
      note: "Remove, or cite an approved ranking fact",
    },
    {
      term: "eco-friendly",
      type: "regulated",
      rule_code: "CLAIM-02",
      replacement: null,
      note: "Allowed only with a specific supporting fact",
    },
    {
      term: "Aqualeaf",
      type: "preferred",
      rule_code: "TERM-01",
      replacement: "Aqualeaf",
      note: 'Exact spelling; flag variants like "AquaLeaf" or "Aqua Leaf"',
    },
  ];

  it("evaluates seeded sample caption correctly", () => {
    const sample =
      "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated";

    const findings = runRuleChecks(sample, { rules, terms });

    // 1. "No.1" banned citing CLAIM-01 severity high at correct offsets
    const no1Finding = findings.find((f) => f.span_text === "No.1");
    expect(no1Finding).toBeDefined();
    expect(no1Finding!.kind).toBe("term");
    expect(no1Finding!.rule_code).toBe("CLAIM-01");
    expect(no1Finding!.severity).toBe("high");
    expect(no1Finding!.start_offset).toBe(8);
    expect(no1Finding!.end_offset).toBe(12);
    expect(no1Finding!.reason).toContain("Banned term");
    expect(no1Finding!.reason).toContain("Remove, or cite an approved ranking fact");

    // 2. "eco-friendly" regulated citing CLAIM-02
    const ecoFinding = findings.find((f) => f.span_text === "eco-friendly");
    expect(ecoFinding).toBeDefined();
    expect(ecoFinding!.kind).toBe("term");
    expect(ecoFinding!.rule_code).toBe("CLAIM-02");
    expect(ecoFinding!.severity).toBe("high");
    expect(ecoFinding!.start_offset).toBe(13);
    expect(ecoFinding!.end_offset).toBe(25);
    expect(ecoFinding!.reason).toContain("Regulated term");

    // 3. "#stayhydrated" ACC-02 with confidence 0.6
    const hashFinding = findings.find((f) => f.span_text === "#stayhydrated");
    expect(hashFinding).toBeDefined();
    expect(hashFinding!.kind).toBe("accessibility");
    expect(hashFinding!.rule_code).toBe("ACC-02");
    expect(hashFinding!.severity).toBe("low");
    expect(hashFinding!.confidence).toBe(0.6);
    expect(hashFinding!.reason).toContain("CamelCase (#StayHydrated)");

    // 4. Only one "!" in the text -> no TONE-02 exclamation finding
    const exclamationFinding = findings.find(
      (f) => f.kind === "tone" && f.span_text === "!",
    );
    expect(exclamationFinding).toBeUndefined();
  });

  it("flags AquaLeaf as TERM-01 and leaves exact Aqualeaf unflagged", () => {
    // "AquaLeaf" variant
    const variantText = "Check out the new AquaLeaf bottle.";
    const variantFindings = runRuleChecks(variantText, { rules, terms });
    const aquaLeafFinding = variantFindings.find(
      (f) => f.span_text === "AquaLeaf",
    );
    expect(aquaLeafFinding).toBeDefined();
    expect(aquaLeafFinding!.kind).toBe("term");
    expect(aquaLeafFinding!.rule_code).toBe("TERM-01");
    expect(aquaLeafFinding!.suggested_fix).toBe("Aqualeaf");

    // Exact "Aqualeaf"
    const exactText = "Check out the new Aqualeaf bottle.";
    const exactFindings = runRuleChecks(exactText, { rules, terms });
    const exactAquaLeafFinding = exactFindings.find(
      (f) => f.span_text.toLowerCase().includes("aqualeaf"),
    );
    expect(exactAquaLeafFinding).toBeUndefined();
  });

  it("flags GREAT bottle!! with an ALL CAPS and an exclamation finding", () => {
    const text = "This is a GREAT bottle!!";
    const findings = runRuleChecks(text, { rules, terms });

    // ALL CAPS finding on GREAT
    const capsFinding = findings.find((f) => f.span_text === "GREAT");
    expect(capsFinding).toBeDefined();
    expect(capsFinding!.kind).toBe("tone");
    expect(capsFinding!.rule_code).toBe("TONE-02");

    // Exclamation finding on the second "!"
    const exclFinding = findings.find(
      (f) => f.kind === "tone" && f.span_text === "!",
    );
    expect(exclFinding).toBeDefined();
    expect(exclFinding!.rule_code).toBe("TONE-02");
    expect(exclFinding!.start_offset).toBe(text.lastIndexOf("!"));
  });

  it("flags a 30-word sentence with ACC-01", () => {
    const longSentence =
      "This steel bottle is designed for everyday hydration and features double wall vacuum insulation which keeps drinks ice cold all day long during long workouts and outdoor journeys across country.";
    const wordCount = longSentence.trim().split(/\s+/).length;
    expect(wordCount).toBe(30);

    const findings = runRuleChecks(longSentence, { rules, terms });
    const acc1Finding = findings.find((f) => f.rule_code === "ACC-01");
    expect(acc1Finding).toBeDefined();
    expect(acc1Finding!.kind).toBe("accessibility");
    expect(acc1Finding!.reason).toContain("30 words long");
  });
});

describe.runIf(hasDb)("Review API (POST & GET reviews)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const mockVector768 = Array.from({ length: 768 }, () => 0.01);
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("batchEmbedContents")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              embeddings: Array(10).fill({ values: mockVector768 }),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (urlStr.includes("generateContent")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify({ claims: [] }) }],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  let creatorToken: string;
  let reviewerToken: string;
  let northwindToken: string;
  let seededContentId: string;
  let createdReviewId: string | undefined;

  beforeAll(async () => {
    // Creator token
    const creatorRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator" });
    creatorToken = creatorRes.body.token;

    // Reviewer token
    const reviewerRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "reviewer" });
    reviewerToken = reviewerRes.body.token;

    // Northwind token
    const { rows: nwRows } = await pool.query<{
      id: string;
      organization_id: string;
      role: string;
    }>(
      `SELECT u.id, u.organization_id, u.role
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE o.slug = 'northwind-labs'
       LIMIT 1`,
    );
    if (nwRows.length > 0) {
      northwindToken = signToken({
        sub: nwRows[0].id,
        org: nwRows[0].organization_id,
        role: nwRows[0].role,
      });
    }

    // Get seeded Aqualeaf draft content ID
    const { rows: contentRows } = await pool.query<{ id: string }>(
      `SELECT c.id
       FROM contents c
       JOIN organizations o ON c.organization_id = o.id
       WHERE o.slug = 'aqualeaf' AND c.title = 'Instagram caption: Flow launch'
       LIMIT 1`,
    );
    seededContentId = contentRows[0]?.id;
  });

  afterAll(async () => {
    if (createdReviewId) {
      // Findings are deleted via ON DELETE CASCADE on reviews(id)
      await pool.query("DELETE FROM reviews WHERE id = $1", [createdReviewId]);
    }
    await pool.end();
  });

  it("runs review on seeded draft -> review row and findings saved with rule joins", async () => {
    expect(seededContentId).toBeDefined();

    const postRes = await request(app)
      .post(`/api/contents/${seededContentId}/reviews`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(postRes.status).toBe(201);
    expect(postRes.body.review).toBeDefined();
    expect(postRes.body.review.provider).toBe("rules");
    expect(postRes.body.review.model).toBe("vouch-rules-v1");
    expect(postRes.body.review.finished_at).toBeDefined();

    createdReviewId = postRes.body.review.id;

    expect(Array.isArray(postRes.body.findings)).toBe(true);
    expect(postRes.body.findings.length).toBeGreaterThanOrEqual(3);

    // Verify findings include rule_code and rule_text joined from rules table
    const no1 = postRes.body.findings.find(
      (f: { span_text: string }) => f.span_text === "No.1",
    );
    expect(no1).toBeDefined();
    expect(no1.rule_code).toBe("CLAIM-01");
    expect(no1.rule_text).toBeDefined();
    expect(no1.rule_text).toContain("No superlatives");
    expect(no1.severity).toBe("high");

    const eco = postRes.body.findings.find(
      (f: { span_text: string }) => f.span_text === "eco-friendly",
    );
    expect(eco).toBeDefined();
    expect(eco.rule_code).toBe("CLAIM-02");
    expect(eco.rule_text).toContain("Environmental claims");

    const hashtag = postRes.body.findings.find(
      (f: { span_text: string }) => f.span_text === "#stayhydrated",
    );
    expect(hashtag).toBeDefined();
    expect(hashtag.rule_code).toBe("ACC-02");

    // Reviewer can fetch latest review
    const getRes = await request(app)
      .get(`/api/contents/${seededContentId}/reviews/latest`)
      .set("Authorization", `Bearer ${reviewerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.review.id).toBe(createdReviewId);
    expect(getRes.body.findings.length).toBe(postRes.body.findings.length);
  });

  it("Northwind user gets 404 for Aqualeaf content review (TEST-011 isolation)", async () => {
    const postRes = await request(app)
      .post(`/api/contents/${seededContentId}/reviews`)
      .set("Authorization", `Bearer ${northwindToken}`);

    expect(postRes.status).toBe(404);
    expect(postRes.body.error).toBe("not_found");

    const getRes = await request(app)
      .get(`/api/contents/${seededContentId}/reviews/latest`)
      .set("Authorization", `Bearer ${northwindToken}`);

    expect(getRes.status).toBe(404);
    expect(getRes.body.error).toBe("not_found");
  });
});

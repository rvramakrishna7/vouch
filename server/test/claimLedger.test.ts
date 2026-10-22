import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import pool from "../src/db/pool.js";
import { signToken } from "../src/auth/jwt.js";
import { runClaimLedger } from "../src/ledger/pipeline.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDb)("Claim Ledger Pipeline (S8a)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let creatorToken: string;
  let aqualeafOrgId: string;
  let seededContentId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "mock-key";
    process.env.GROQ_API_KEY = "mock-key";
    delete process.env.AI_FORCE_FAIL;

    // Fetch Aqualeaf organization and seeded content id
    const { rows: orgRows } = await pool.query<{ id: string }>(
      "SELECT id FROM organizations WHERE name = 'Aqualeaf' LIMIT 1",
    );
    aqualeafOrgId = orgRows[0].id;

    const { rows: userRows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'demo.creator@aqualeaf.test' LIMIT 1",
    );
    const creatorUser = userRows[0];

    creatorToken = signToken({
      sub: creatorUser.id,
      org: aqualeafOrgId,
      role: "creator",
    });

    const { rows: contentRows } = await pool.query<{ id: string }>(
      "SELECT id FROM contents WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1",
      [aqualeafOrgId],
    );
    seededContentId = contentRows[0].id;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("evaluates mocked model output matching spec table -> verdicts and citations match", async () => {
    const mockVector768 = Array.from({ length: 768 }, () => 0.02);

    const mockAiResponse = {
      claims: [
        {
          quote: "India's No.1",
          occurrence: 1,
          verdict: "unsupported",
          fact_code: null,
          rule_code: "CLAIM-01",
          reason: "Superlative ranking without approved fact",
          confidence: 0.95,
          suggested_fix: null,
        },
        {
          quote: "eco-friendly",
          occurrence: 1,
          verdict: "unsupported",
          fact_code: null,
          rule_code: "CLAIM-02",
          reason: "Environmental claim without specific supporting fact",
          confidence: 0.9,
          suggested_fix: null,
        },
        {
          quote: "40% lighter",
          occurrence: 1,
          verdict: "supported",
          fact_code: "F-12",
          rule_code: null,
          reason: "Backed by F-12 lab test",
          confidence: 0.95,
          suggested_fix: null,
        },
        {
          quote: "Rated 4.8",
          occurrence: 1,
          verdict: "outdated",
          fact_code: "F-03",
          rule_code: null,
          reason: "Rating fact is expired",
          confidence: 0.9,
          suggested_fix: null,
        },
        {
          quote: "cold for 48 hours",
          occurrence: 1,
          verdict: "contradicted",
          fact_code: "F-15",
          rule_code: null,
          reason: "F-15 guarantees 24 hours, not 48",
          confidence: 0.95,
          suggested_fix: "Keeps drinks cold for 24 hours",
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
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
                { content: { parts: [{ text: JSON.stringify(mockAiResponse) }] } },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const res = await request(app)
      .post(`/api/contents/${seededContentId}/reviews`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(201);
    expect(res.body.review.ai_status).toBe("ok");
    expect(res.body.review.ai_provider).toBe("gemini");

    const claims = res.body.findings.filter((f: any) => f.kind === "claim");
    expect(claims.length).toBe(5);

    const no1 = claims.find((c: any) => c.span_text === "India's No.1");
    expect(no1.verdict).toBe("unsupported");
    expect(no1.rule_code).toBe("CLAIM-01");

    const eco = claims.find((c: any) => c.span_text === "eco-friendly");
    expect(eco.verdict).toBe("unsupported");
    expect(eco.rule_code).toBe("CLAIM-02");

    const lighter = claims.find((c: any) => c.span_text === "40% lighter");
    expect(lighter.verdict).toBe("supported");
    expect(lighter.fact_code).toBe("F-12");
    expect(lighter.severity).toBe("low");

    const rated = claims.find((c: any) => c.span_text === "Rated 4.8");
    expect(rated.verdict).toBe("outdated");
    expect(rated.fact_code).toBe("F-03");
    expect(rated.rule_code).toBe("CLAIM-03");

    const cold = claims.find((c: any) => c.span_text === "cold for 48 hours");
    expect(cold.verdict).toBe("contradicted");
    expect(cold.fact_code).toBe("F-15");
    expect(cold.rule_code).toBe("CLAIM-03");
  });

  it("TEST-009: Citation validation enforces code truth over model", async () => {
    const mockVector768 = Array.from({ length: 768 }, () => 0.02);

    const testCasesAiOutput = {
      claims: [
        // 1. fact_code not in candidate set -> needs_human_judgement
        {
          quote: "40% lighter",
          verdict: "supported",
          fact_code: "F-99-NONEXISTENT",
          rule_code: null,
          reason: "Cites unknown fact",
          confidence: 0.8,
          suggested_fix: null,
        },
        // 2. quote not in text -> needs_human_judgement
        {
          quote: "this hallucinated quote is not in content",
          verdict: "supported",
          fact_code: "F-12",
          rule_code: null,
          reason: "Quote not found",
          confidence: 0.8,
          suggested_fix: null,
        },
        // 3. model says supported citing expired F-03 -> code overrides to outdated
        {
          quote: "Rated 4.8",
          verdict: "supported",
          fact_code: "F-03",
          rule_code: null,
          reason: "Model thought F-03 was active",
          confidence: 0.8,
          suggested_fix: null,
        },
        // 4. model says outdated citing active F-12 -> needs_human_judgement
        {
          quote: "40% lighter",
          occurrence: 1,
          verdict: "outdated",
          fact_code: "F-12",
          rule_code: null,
          reason: "Model falsely claimed active F-12 is outdated",
          confidence: 0.8,
          suggested_fix: null,
        },
        // 5. unsupported with invalid rule -> rule_code becomes null (suggestion only)
        {
          quote: "India's No.1",
          verdict: "unsupported",
          fact_code: null,
          rule_code: "NONEXISTENT-RULE",
          reason: "Rule does not exist",
          confidence: 0.8,
          suggested_fix: null,
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
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
                { content: { parts: [{ text: JSON.stringify(testCasesAiOutput) }] } },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const result = await runClaimLedger({
      organizationId: aqualeafOrgId,
      body: "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by 10,000+ happy customers. Keeps water cold for 48 hours. #stayhydrated",
      purpose: "Launch caption",
      audience: "Consumers",
      channel: "Instagram",
      pool,
    });

    expect(result.aiStatus).toBe("ok");
    const findings = result.findings;

    // 1. Unknown fact code
    expect(findings[0].verdict).toBe("needs_human_judgement");

    // 2. Quote not in text
    expect(findings[1].verdict).toBe("needs_human_judgement");
    expect(findings[1].start_offset).toBeNull();

    // 3. Supported citing expired fact -> becomes outdated
    expect(findings[2].verdict).toBe("outdated");
    expect(findings[2].fact_code).toBe("F-03");
    expect(findings[2].rule_code).toBe("CLAIM-03");

    // 4. Outdated citing valid in-date fact -> becomes needs_human_judgement
    expect(findings[3].verdict).toBe("needs_human_judgement");

    // 5. Unsupported with non-existent rule -> rule_code is null (Invariant 1)
    expect(findings[4].verdict).toBe("unsupported");
    expect(findings[4].rule_code).toBeNull();
  });

  it("overrides model 'supported' on regulated terms to needs_human_judgement", async () => {
    const mockVector768 = Array.from({ length: 768 }, () => 0.02);

    const mockAiResponse = {
      claims: [
        {
          quote: "eco-friendly",
          occurrence: 1,
          verdict: "supported",
          fact_code: "F-07",
          rule_code: null,
          reason: "Environmental claim backed by recycled stainless steel",
          confidence: 0.9,
          suggested_fix: null,
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
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
                    parts: [{ text: JSON.stringify(mockAiResponse) }],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unhandled mock fetch: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const result = await runClaimLedger({
      organizationId: aqualeafOrgId,
      body: "India's No.1 eco-friendly water bottle, now 40% lighter.",
      purpose: "Launch caption",
      audience: "Consumers",
      channel: "Instagram",
      pool,
    });

    expect(result.aiStatus).toBe("ok");
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.span_text).toBe("eco-friendly");
    expect(finding.verdict).toBe("needs_human_judgement");
    expect(finding.reason).toBe(
      "Regulated term: a reviewer must confirm the specific attribute is stated in the text.",
    );
    expect(finding.severity).toBe("medium");
  });

  it("numeric cross-check: overrides to contradicted when fact has same unit but different number", async () => {
    const mockVector768 = Array.from({ length: 768 }, () => 0.02);

    const mockAiResponse = {
      claims: [
        // 1. Model says unsupported for "cold for 48 hours", but F-15 has 24 hours -> contradicted
        {
          quote: "cold for 48 hours",
          occurrence: 1,
          verdict: "unsupported",
          fact_code: null,
          rule_code: "CLAIM-03",
          reason: "Model thought no fact existed",
          confidence: 0.9,
          suggested_fix: null,
        },
        // 2. Model says supported for "40% lighter" and fact has 40% -> unchanged
        {
          quote: "40% lighter",
          occurrence: 1,
          verdict: "supported",
          fact_code: "F-12",
          rule_code: null,
          reason: "40% matches fact F-12",
          confidence: 0.95,
          suggested_fix: null,
        },
        // 3. No shared unit -> unchanged
        {
          quote: "India's No.1",
          occurrence: 1,
          verdict: "unsupported",
          fact_code: null,
          rule_code: "CLAIM-01",
          reason: "Superlative ranking",
          confidence: 0.9,
          suggested_fix: null,
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAiResponse),
                },
              },
            ],
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(mockAiResponse) }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    globalThis.fetch = fetchMock;

    const result = await runClaimLedger({
      organizationId: aqualeafOrgId,
      body: "India's No.1 water bottle, now 40% lighter. Keeps cold for 48 hours.",
      purpose: "Launch caption",
      audience: "Consumers",
      channel: "Instagram",
      pool,
    });

    expect(result.aiStatus).toBe("ok");
    const findings = result.findings;

    // 1. Contradicted by F-15 (24 hours vs 48 hours)
    const cold = findings.find((f) => f.span_text === "cold for 48 hours");
    expect(cold).toBeDefined();
    expect(cold!.verdict).toBe("contradicted");
    expect(cold!.fact_code).toBe("F-15");
    expect(cold!.rule_code).toBe("CLAIM-03");

    // 2. Unchanged (40% lighter matches F-12)
    const lighter = findings.find((f) => f.span_text === "40% lighter");
    expect(lighter).toBeDefined();
    expect(lighter!.verdict).toBe("supported");
    expect(lighter!.fact_code).toBe("F-12");

    // 3. No shared unit -> unchanged
    const no1 = findings.find((f) => f.span_text === "India's No.1");
    expect(no1).toBeDefined();
    expect(no1!.verdict).toBe("unsupported");
    expect(no1!.rule_code).toBe("CLAIM-01");
  });

  it("TEST-010: AI_FORCE_FAIL=all saves review with rule findings and ai_status unavailable", async () => {
    process.env.AI_FORCE_FAIL = "all";

    const res = await request(app)
      .post(`/api/contents/${seededContentId}/reviews`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(201);
    expect(res.body.review.ai_status).toBe("unavailable");
    expect(res.body.review.ai_provider).toBeNull();
    // Rule findings still present
    expect(res.body.findings.length).toBeGreaterThan(0);
    const hasRuleFinding = res.body.findings.some(
      (f: any) => f.kind === "term" || f.kind === "accessibility",
    );
    expect(hasRuleFinding).toBe(true);
  });
});

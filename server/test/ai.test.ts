import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { z } from "zod";
import app from "../src/index.js";
import {
  generateJson,
  embed,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
} from "../src/ai/adapter.js";
import { AiInvalidOutputError, AiUnavailableError } from "../src/ai/types.js";
import { signToken } from "../src/auth/jwt.js";

const sampleSchema = z.object({
  verdict: z.string(),
  score: z.number(),
});

describe("AI Adapter and Fallback Pipeline", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "mock-gemini-key";
    process.env.GROQ_API_KEY = "mock-groq-key";
    delete process.env.AI_FORCE_FAIL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("TEST-010: Gemini 429 triggers fallback to Groq", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (urlStr.includes("api.groq.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ verdict: "groq_success", score: 95 }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const result = await generateJson({
      system: "System test",
      user: "User test",
      schema: sampleSchema,
    });

    expect(result.provider).toBe("groq");
    expect(result.data.verdict).toBe("groq_success");
    expect(result.data.score).toBe(95);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries invalid JSON once on same provider, then throws AiInvalidOutputError if still invalid", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "This is not JSON at all!" }],
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    await expect(
      generateJson({
        system: "System test",
        user: "User test",
        schema: sampleSchema,
      }),
    ).rejects.toThrow(AiInvalidOutputError);

    // Initial call + 1 retry on Gemini
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("AI_FORCE_FAIL=gemini skips Gemini and uses Groq", async () => {
    process.env.AI_FORCE_FAIL = "gemini";

    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.groq.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ verdict: "from_groq_only", score: 88 }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const result = await generateJson({
      system: "System test",
      user: "User test",
      schema: sampleSchema,
    });

    expect(result.provider).toBe("groq");
    expect(result.data.verdict).toBe("from_groq_only");
    expect(fetchMock).toHaveBeenCalledTimes(1); // Gemini was skipped completely
  });

  it("AI_FORCE_FAIL=all throws AiUnavailableError", async () => {
    process.env.AI_FORCE_FAIL = "all";

    await expect(
      generateJson({
        system: "System test",
        user: "User test",
        schema: sampleSchema,
      }),
    ).rejects.toThrow(AiUnavailableError);
  });

  it("embed returns 768-length vectors from a mocked response", async () => {
    const mockVector768 = Array.from({ length: 768 }, (_, i) => i * 0.001);

    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("batchEmbedContents")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              embeddings: [{ values: mockVector768 }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const vectors = await embed(["Aqualeaf bottle claim"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(768);
    expect(vectors[0][0]).toBe(0);
    expect(vectors[0][1]).toBeCloseTo(0.001);
  });

  it("GET /api/ai/status requires authentication and returns provider health", async () => {
    // Unauthenticated -> 401
    const unauthRes = await request(app).get("/api/ai/status");
    expect(unauthRes.status).toBe(401);

    const token = signToken({
      sub: "56ce36a5-bab2-4042-8290-f999e3d0437d",
      org: "3ec5de87-e0a9-4288-90e0-08d7021a1e99",
      role: "creator",
    });

    const mockVector768 = Array.from({ length: 768 }, () => 0.05);
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com") && urlStr.includes("generateContent")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (urlStr.includes("batchEmbedContents")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              embeddings: [{ values: mockVector768 }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (urlStr.includes("api.groq.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"status":"ok"}' } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    globalThis.fetch = fetchMock;

    const res = await request(app)
      .get("/api/ai/status")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.gemini.ok).toBe(true);
    expect(res.body.gemini.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(res.body.groq.ok).toBe(true);
    expect(res.body.groq.model).toBe(DEFAULT_GROQ_MODEL);
    expect(res.body.embeddings.ok).toBe(true);
    expect(res.body.embeddings.dims).toBe(768);
  });
});

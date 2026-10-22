import { z } from "zod";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type GenerateJsonOptions,
  type GenerateJsonResult,
} from "./types.js";

// Documented defaults (Current models verified in live environment)
// Google Gemini: https://ai.google.dev/gemini-api/docs/models/gemini
// Gemini Embeddings: https://ai.google.dev/gemini-api/docs/embeddings
// Groq Models: https://console.groq.com/docs/models
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_EMBED_MODEL = "gemini-embedding-001";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function getGeminiEmbedModel(): string {
  return process.env.GEMINI_EMBED_MODEL || DEFAULT_GEMINI_EMBED_MODEL;
}

export function getGroqModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
}

function shouldForceFail(provider: "gemini" | "groq"): boolean {
  const force = process.env.AI_FORCE_FAIL;
  if (!force) return false;
  if (force === "all") return true;
  if (force === "gemini" && provider === "gemini") return true;
  return false;
}

function logAiCall(
  provider: "gemini" | "groq",
  model: string,
  latencyMs: number,
  errorClass?: string,
) {
  if (errorClass) {
    console.warn(
      `[AI] provider=${provider} model=${model} latency=${latencyMs.toFixed(0)}ms error=${errorClass}`,
    );
  } else {
    console.info(
      `[AI] provider=${provider} model=${model} latency=${latencyMs.toFixed(0)}ms status=ok`,
    );
  }
}

async function callGeminiRaw(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<{ text: string; latencyMs: number }> {
  if (shouldForceFail("gemini")) {
    const err = new Error("Simulated Gemini 503 (AI_FORCE_FAIL)");
    (err as any).status = 503;
    throw err;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY missing");
    (err as any).status = 500;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const start = performance.now();

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const latencyMs = performance.now() - start;

  if (!response.ok) {
    const err = new Error(`Gemini HTTP ${response.status}`);
    (err as any).status = response.status;
    logAiCall("gemini", model, latencyMs, `HttpError_${response.status}`);
    throw err;
  }

  const json: any = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof rawText !== "string") {
    const err = new Error("Gemini returned no text content");
    (err as any).status = 502;
    logAiCall("gemini", model, latencyMs, "EmptyContent");
    throw err;
  }

  logAiCall("gemini", model, latencyMs);
  return { text: rawText, latencyMs };
}

async function callGroqRaw(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<{ text: string; latencyMs: number }> {
  if (shouldForceFail("groq")) {
    const err = new Error("Simulated Groq 503 (AI_FORCE_FAIL)");
    (err as any).status = 503;
    throw err;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error("GROQ_API_KEY missing");
    (err as any).status = 500;
    throw err;
  }

  const url = "https://api.groq.com/openai/v1/chat/completions";
  const start = performance.now();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const latencyMs = performance.now() - start;

  if (!response.ok) {
    const err = new Error(`Groq HTTP ${response.status}`);
    (err as any).status = response.status;
    logAiCall("groq", model, latencyMs, `HttpError_${response.status}`);
    throw err;
  }

  const json: any = await response.json();
  const rawText = json?.choices?.[0]?.message?.content;
  if (typeof rawText !== "string") {
    const err = new Error("Groq returned no message content");
    (err as any).status = 502;
    logAiCall("groq", model, latencyMs, "EmptyContent");
    throw err;
  }

  logAiCall("groq", model, latencyMs);
  return { text: rawText, latencyMs };
}

function parseAndValidate<T>(
  rawText: string,
  schema: z.ZodType<T>,
): { success: true; data: T } | { success: false; issues: z.ZodIssue[]; rawError: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: any) {
    return {
      success: false,
      issues: [
        {
          code: "custom",
          message: `JSON syntax error: ${err.message}`,
          path: [],
        },
      ],
      rawError: `Invalid JSON syntax: ${err.message}`,
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues,
      rawError: result.error.message,
    };
  }

  return { success: true, data: result.data };
}

/**
 * Generate structured JSON validated by a Zod schema.
 * Executes Gemini first; falls back to Groq on HTTP 429, 5xx, timeout, or network error.
 * Validates output with zod; retries once on the same provider if invalid before throwing.
 */
export async function generateJson<T>(
  options: GenerateJsonOptions<T>,
): Promise<GenerateJsonResult<T>> {
  const { system, user, schema, timeoutMs = 20000 } = options;
  const geminiModel = getGeminiModel();
  const groqModel = getGroqModel();

  let geminiEligible = true;

  // Try Gemini
  try {
    let callRes = await callGeminiRaw(geminiModel, system, user, timeoutMs);
    let val = parseAndValidate(callRes.text, schema);

    if (!val.success) {
      // Retry once on Gemini with the validation issues
      const retryPrompt = `${user}\n\nATTENTION: Your previous output was invalid according to the required schema: ${val.rawError}. Return only valid JSON conforming strictly to the requested schema.`;
      callRes = await callGeminiRaw(geminiModel, system, retryPrompt, timeoutMs);
      val = parseAndValidate(callRes.text, schema);

      if (!val.success) {
        throw new AiInvalidOutputError(
          `Gemini output failed schema validation after retry: ${val.rawError}`,
          val.issues,
        );
      }
    }

    return {
      data: val.data,
      provider: "gemini",
      model: geminiModel,
      latencyMs: callRes.latencyMs,
    };
  } catch (err: any) {
    // If output was genuinely invalid twice, throw immediately without fallback
    if (err instanceof AiInvalidOutputError) {
      throw err;
    }

    // Check if error is eligible for fallback: 429, 5xx, timeout, network error
    const status = err?.status || 0;
    const isNetworkOrTimeout =
      err?.name === "TimeoutError" ||
      err?.name === "AbortError" ||
      err?.code === "ECONNRESET" ||
      err?.code === "ENOTFOUND" ||
      err?.message?.includes("fetch failed");

    const isFallbackEligible =
      status === 429 ||
      (status >= 500 && status < 600) ||
      status === 0 ||
      isNetworkOrTimeout ||
      shouldForceFail("gemini");

    if (!isFallbackEligible) {
      // 4xx client errors (other than 429) indicate bad config/request
      throw new AiUnavailableError(`Gemini failed with HTTP ${status}: ${err.message}`, err);
    }

    geminiEligible = false;
  }

  // Fallback to Groq
  try {
    let callRes = await callGroqRaw(groqModel, system, user, timeoutMs);
    let val = parseAndValidate(callRes.text, schema);

    if (!val.success) {
      // Retry once on Groq with the validation issues
      const retryPrompt = `${user}\n\nATTENTION: Your previous output was invalid according to the required schema: ${val.rawError}. Return only valid JSON conforming strictly to the requested schema.`;
      callRes = await callGroqRaw(groqModel, system, retryPrompt, timeoutMs);
      val = parseAndValidate(callRes.text, schema);

      if (!val.success) {
        throw new AiInvalidOutputError(
          `Groq output failed schema validation after retry: ${val.rawError}`,
          val.issues,
        );
      }
    }

    return {
      data: val.data,
      provider: "groq",
      model: groqModel,
      latencyMs: callRes.latencyMs,
    };
  } catch (err: any) {
    if (err instanceof AiInvalidOutputError) {
      throw err;
    }
    throw new AiUnavailableError(
      `All AI providers failed. Gemini: unavailable; Groq: ${err?.message || "error"}`,
      err,
    );
  }
}

/**
 * Generate 768-dimensional text embeddings using Google Gemini.
 * Groq does not support embeddings. If embedding fails, throws AiUnavailableError.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (shouldForceFail("gemini")) {
    throw new AiUnavailableError("Embeddings unavailable (AI_FORCE_FAIL)");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError("GEMINI_API_KEY missing");
  }

  const embedModel = getGeminiEmbedModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${embedModel}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
  const start = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${embedModel}`,
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        })),
      }),
      signal: AbortSignal.timeout(25000),
    });

    const latencyMs = performance.now() - start;

    if (!response.ok) {
      const err = new Error(`Gemini embed HTTP ${response.status}`);
      logAiCall("gemini", embedModel, latencyMs, `EmbedHttpError_${response.status}`);
      throw err;
    }

    const json: any = await response.json();
    const embeddings = json?.embeddings;

    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(
        `Gemini batchEmbedContents returned invalid count (${embeddings?.length ?? 0} vs ${texts.length})`,
      );
    }

    const vectors: number[][] = [];
    for (let i = 0; i < embeddings.length; i++) {
      const vec = embeddings[i]?.values;
      if (!Array.isArray(vec) || vec.length !== 768) {
        throw new Error(
          `Gemini embedding ${i} dimensionality mismatch: expected 768, got ${vec?.length}`,
        );
      }
      vectors.push(vec);
    }

    logAiCall("gemini", embedModel, latencyMs);
    return vectors;
  } catch (err: any) {
    logAiCall("gemini", embedModel, performance.now() - start, err?.name || "EmbedError");
    throw new AiUnavailableError(`Embedding failed: ${err.message}`, err);
  }
}

/**
 * Diagnostic helpers for GET /api/ai/status.
 * Test each provider independently with a tiny JSON request without exposing secrets.
 */
export async function testGeminiStatus(): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  error?: string;
}> {
  const model = getGeminiModel();
  const start = performance.now();
  try {
    const res = await callGeminiRaw(
      model,
      "You are a healthcheck agent. Respond with JSON only.",
      'Return {"status":"ok"}',
      10000,
    );
    const parsed = JSON.parse(res.text);
    return {
      ok: Boolean(parsed && typeof parsed === "object"),
      model,
      latencyMs: Math.round(res.latencyMs),
    };
  } catch (err: any) {
    return {
      ok: false,
      model,
      latencyMs: Math.round(performance.now() - start),
      error: err?.message || "Gemini check failed",
    };
  }
}

export async function testGroqStatus(): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  error?: string;
}> {
  const model = getGroqModel();
  const start = performance.now();
  try {
    const res = await callGroqRaw(
      model,
      "You are a healthcheck agent. Respond with JSON only.",
      'Return {"status":"ok"}',
      10000,
    );
    const parsed = JSON.parse(res.text);
    return {
      ok: Boolean(parsed && typeof parsed === "object"),
      model,
      latencyMs: Math.round(res.latencyMs),
    };
  } catch (err: any) {
    return {
      ok: false,
      model,
      latencyMs: Math.round(performance.now() - start),
      error: err?.message || "Groq check failed",
    };
  }
}

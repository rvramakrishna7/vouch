import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware.js";
import {
  testGeminiStatus,
  testGroqStatus,
  embed,
  getGeminiEmbedModel,
} from "../ai/adapter.js";

export const aiRouter = Router();

// GET /api/ai/status (requireAuth)
aiRouter.get("/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const geminiStart = performance.now();
    const [geminiRes, groqRes] = await Promise.all([
      testGeminiStatus(),
      testGroqStatus(),
    ]);

    let embedRes: {
      ok: boolean;
      model: string;
      dims: number;
      latencyMs?: number;
      error?: string;
    };

    const embedModel = getGeminiEmbedModel();
    const embedStart = performance.now();
    try {
      const vectors = await embed(["status check"]);
      embedRes = {
        ok: vectors.length > 0 && vectors[0].length === 768,
        model: embedModel,
        dims: vectors[0]?.length || 0,
        latencyMs: Math.round(performance.now() - embedStart),
      };
    } catch (err: any) {
      embedRes = {
        ok: false,
        model: embedModel,
        dims: 0,
        latencyMs: Math.round(performance.now() - embedStart),
        error: err?.message || "Embed check failed",
      };
    }

    return res.json({
      gemini: geminiRes,
      groq: groqRes,
      embeddings: embedRes,
    });
  } catch (err: any) {
    console.error("GET /api/ai/status error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

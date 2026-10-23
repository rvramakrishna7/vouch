import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import mammoth from "mammoth";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";
import { AiUnavailableError } from "../ai/types.js";
import {
  runGuidelineDraftPipeline,
  ALLOWED_CATEGORIES,
  ALLOWED_SEVERITIES,
} from "../guidelines/pipeline.js";

export const guidelinesRouter = Router();

guidelinesRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // 4 MB
  },
});

const draftJsonSchema = z.object({
  text: z.string().min(50).max(20000),
});

const applyRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        code: z.string().min(1),
        category: z.enum(ALLOWED_CATEGORIES),
        text: z.string().min(1),
        severity: z.enum(ALLOWED_SEVERITIES),
        source_quote: z.string().optional(),
      }),
    )
    .min(1)
    .max(30),
});

// POST /api/guidelines/draft (brand_manager only)
guidelinesRouter.post(
  "/draft",
  requireRole("brand_manager"),
  (req: Request, res: Response, next) => {
    // If multipart/form-data, process file with multer
    if (req.is("multipart/form-data")) {
      upload.single("file")(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "file_too_large" });
          }
          return res.status(400).json({ error: "invalid_input", details: err.message });
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: Request, res: Response) => {
    let guidelineText = "";

    if (req.file) {
      const file = req.file;
      const ext = path.extname(file.originalname).toLowerCase();
      const isDocxExt = ext === ".docx";
      const isDocxMime =
        file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.mimetype === "application/x-zip-compressed" ||
        file.mimetype === "application/octet-stream";

      if (!isDocxExt || !isDocxMime) {
        return res.status(415).json({
          error: "unsupported_type",
          accepted: [".docx"],
        });
      }

      try {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        guidelineText = result.value.trim();
      } catch (err: any) {
        return res.status(400).json({ error: "invalid_input", details: "Failed to extract text from DOCX" });
      }
    } else {
      const parsed = draftJsonSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_input",
          details: parsed.error.format(),
        });
      }
      guidelineText = parsed.data.text.trim();
    }

    if (guidelineText.length < 50 || guidelineText.length > 20000) {
      return res.status(400).json({
        error: "invalid_input",
        details: "Guideline text must be between 50 and 20,000 characters",
      });
    }

    const orgId = req.user!.organizationId;

    try {
      // Fetch existing rules for this org (for code numbering and duplicate checking)
      const { rows: existingRules } = await pool.query<{
        id: string;
        code: string;
        category: string;
        text: string;
        version: number;
      }>(
        "SELECT id, code, category, text, version FROM rules WHERE organization_id = $1 AND status != 'archived' ORDER BY code ASC",
        [orgId],
      );

      const result = await runGuidelineDraftPipeline(guidelineText, existingRules);
      return res.json(result);
    } catch (err: any) {
      if (err instanceof AiUnavailableError || err?.status === 503 || err?.message?.includes("AI_FORCE_FAIL")) {
        return res.status(503).json({ error: "ai_unavailable" });
      }
      console.error("POST /api/guidelines/draft error:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// POST /api/guidelines/apply (brand_manager only)
guidelinesRouter.post(
  "/apply",
  requireRole("brand_manager"),
  async (req: Request, res: Response) => {
    const parsed = applyRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_input",
        details: parsed.error.format(),
      });
    }

    const { rules } = parsed.data;
    const orgId = req.user!.organizationId;

    // Check intra-payload duplicate codes
    const payloadCodes = rules.map((r) => r.code);
    const seenCodes = new Set<string>();
    for (const code of payloadCodes) {
      if (seenCodes.has(code)) {
        return res.status(409).json({ error: "code_taken", code });
      }
      seenCodes.add(code);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check if any rule codes are already taken in the database
      const { rows: conflicting } = await client.query<{ code: string }>(
        "SELECT code FROM rules WHERE organization_id = $1 AND code = ANY($2) FOR UPDATE",
        [orgId, payloadCodes],
      );

      if (conflicting.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "code_taken",
          code: conflicting[0].code,
        });
      }

      // Insert all rules
      const insertedRules: any[] = [];
      for (const rule of rules) {
        const { rows: inserted } = await client.query(
          `INSERT INTO rules (organization_id, code, category, severity, text, version, status)
           VALUES ($1, $2, $3, $4, $5, 1, 'active')
           RETURNING id, organization_id, code, category, severity, text, version, status, created_at`,
          [orgId, rule.code, rule.category, rule.severity, rule.text],
        );
        insertedRules.push(inserted[0]);
      }

      // Log audit row
      await logAudit({
        organizationId: orgId,
        actor: req.user!.id,
        action: "rules.import",
        entity: "rules",
        payload: {
          count: insertedRules.length,
          codes: insertedRules.map((r) => r.code),
          rules: rules.map((r) => ({
            code: r.code,
            source_quote: r.source_quote,
          })),
        },
        client,
      });

      await client.query("COMMIT");
      return res.status(201).json({ rules: insertedRules });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST /api/guidelines/apply error:", err);
      return res.status(500).json({ error: "internal_error" });
    } finally {
      client.release();
    }
  },
);

export default guidelinesRouter;

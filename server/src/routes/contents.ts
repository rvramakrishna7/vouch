import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import mammoth from "mammoth";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";
import {
  runRuleChecks,
  type RuleInput,
  type TermInput,
} from "../engine/ruleChecks.js";
import { runClaimLedger, type ValidatedClaimFinding } from "../ledger/pipeline.js";
import { timingStorage } from "../middleware/timing.js";

export const contentsRouter = Router();

// Apply requireAuth to all contents routes
contentsRouter.use(requireAuth);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // 4 MB
  },
});

// POST /api/contents/extract (creator only)
contentsRouter.post(
  "/extract",
  requireRole("creator"),
  (req: Request, res: Response, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "file_too_large" });
        }
        return res.status(400).json({ error: "invalid_input", details: err.message });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "invalid_input", details: "File is required" });
    }

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
      const text = result.value;
      return res.json({
        text,
        characters: text.length,
      });
    } catch (err) {
      console.error("mammoth extraction error:", err);
      return res.status(400).json({ error: "extraction_failed" });
    }
  },
);

const createContentSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  purpose: z.string().trim().min(1, "Purpose is required").max(300, "Purpose must be at most 300 characters"),
  audience: z.string().trim().min(1, "Audience is required").max(200, "Audience must be at most 200 characters"),
  channel: z.enum([
    "Instagram",
    "Facebook",
    "LinkedIn",
    "X",
    "Website",
    "Email",
    "Print",
    "Other",
  ]),
  body: z.string().min(1, "Body is required").max(20000, "Body must be at most 20000 characters"),
});

// POST /api/contents (creator only)
contentsRouter.post("/", requireRole("creator"), async (req: Request, res: Response) => {
  const parseResult = createContentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const { title, purpose, audience, channel, body } = parseResult.data;
  const orgId = req.user!.organizationId;
  const userId = req.user!.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: contentRows } = await client.query(
      `INSERT INTO contents (organization_id, title, purpose, audience, channel, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6)
       RETURNING id, organization_id, title, purpose, audience, channel, status, created_by, created_at, updated_at`,
      [orgId, title, purpose, audience, channel, userId],
    );
    const content = contentRows[0];

    const { rows: revisionRows } = await client.query(
      `INSERT INTO revisions (organization_id, content_id, n, body, created_by)
       VALUES ($1, $2, 1, $3, $4)
       RETURNING id, organization_id, content_id, n, body, created_by, created_at`,
      [orgId, content.id, body, userId],
    );
    const revision = revisionRows[0];

    await logAudit({
      organizationId: orgId,
      actor: userId,
      action: "contents.create",
      entity: `content:${content.id}`,
      payload: { title, channel },
      client,
    });

    await client.query("COMMIT");
    return res.status(201).json({ content, revision });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/contents error:", err);
    return res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

// GET /api/contents (all roles, creators see only own, others see all in org)
contentsRouter.get("/", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;

  try {
    let query = `
      SELECT 
        c.id,
        c.title,
        c.channel,
        c.status,
        COALESCE(u.name, '') AS created_by_name,
        c.updated_at,
        COALESCE(MAX(r.n), 1)::int AS latest_revision_number
      FROM contents c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN revisions r ON c.id = r.content_id
      WHERE c.organization_id = $1
    `;
    const params: unknown[] = [orgId];

    if (req.user!.role === "creator") {
      query += ` AND c.created_by = $2`;
      params.push(req.user!.id);
    }

    query += `
      GROUP BY c.id, u.name
      ORDER BY c.created_at DESC, c.id DESC
    `;

    const { rows } = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error("GET /api/contents error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/contents/:id/reviews/latest (optimized single-round-trip query)
contentsRouter.get("/:id/reviews/latest", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const { rows } = await pool.query<{
      content_id: string;
      content_created_by: string;
      review: {
        id: string;
        organization_id: string;
        revision_id: string;
        provider: string;
        model: string;
        started_at: string;
        finished_at?: string;
        created_at: string;
      } | null;
      findings: any[] | null;
    }>(
      `SELECT 
         c.id AS content_id,
         c.created_by AS content_created_by,
         (
           SELECT json_build_object(
             'id', rw.id,
             'organization_id', rw.organization_id,
             'revision_id', rw.revision_id,
             'provider', rw.provider,
             'model', rw.model,
             'started_at', rw.started_at,
             'finished_at', rw.finished_at,
             'created_at', rw.created_at
           )
           FROM revisions rv
           JOIN reviews rw ON rw.revision_id = rv.id
           WHERE rv.content_id = c.id AND rw.organization_id = c.organization_id
           ORDER BY rw.created_at DESC
           LIMIT 1
         ) AS review,
         (
           SELECT COALESCE(
             json_agg(
               json_build_object(
                 'id', f.id,
                 'organization_id', f.organization_id,
                 'review_id', f.review_id,
                 'kind', f.kind,
                 'span_text', f.span_text,
                 'start_offset', f.start_offset,
                 'end_offset', f.end_offset,
                 'verdict', f.verdict,
                 'rule_id', f.rule_id,
                 'rule_code', r.code,
                 'rule_text', r.text,
                 'reason', f.reason,
                 'severity', f.severity,
                 'confidence', f.confidence,
                 'suggested_fix', f.suggested_fix,
                 'resolution', f.resolution,
                 'dismiss_reason', f.dismiss_reason,
                 'created_at', f.created_at
               ) ORDER BY f.start_offset ASC, f.id ASC
             ),
             '[]'::json
           )
           FROM (
             SELECT rw.id, rw.organization_id
             FROM revisions rv
             JOIN reviews rw ON rw.revision_id = rv.id
             WHERE rv.content_id = c.id AND rw.organization_id = c.organization_id
             ORDER BY rw.created_at DESC
             LIMIT 1
           ) lr
           JOIN findings f ON f.review_id = lr.id AND f.organization_id = lr.organization_id
           LEFT JOIN rules r ON f.rule_id = r.id
         ) AS findings
       FROM contents c
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, orgId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const row = rows[0];

    // Creator isolation check
    if (req.user!.role === "creator" && row.content_created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // If content has not been reviewed yet
    if (!row.review) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({
      review: row.review,
      findings: row.findings || [],
    });
  } catch (err) {
    console.error("GET /api/contents/:id/reviews/latest error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/contents/:id/reviews (any role that can see content)
contentsRouter.post("/:id/reviews", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    // 1. In one round-trip: verify content access and fetch latest revision + context
    const { rows: contentRows } = await pool.query<{
      id: string;
      created_by: string;
      purpose: string;
      audience: string;
      channel: string;
      revision_id: string;
      revision_n: number;
      revision_body: string;
    }>(
      `SELECT c.id, c.created_by, c.purpose, c.audience, c.channel,
              r.id AS revision_id, r.n AS revision_n, r.body AS revision_body
       FROM contents c
       JOIN revisions r ON r.content_id = c.id AND r.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2
       ORDER BY r.n DESC
       LIMIT 1`,
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = contentRows[0];
    if (req.user!.role === "creator" && content.created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // 2. Fetch rules, terms, and execute Claim Ledger in parallel
    const [rulesRes, termsRes, ledgerResult] = await Promise.all([
      pool.query<RuleInput>(
        `SELECT id, code, category, severity, text, status
         FROM rules
         WHERE organization_id = $1`,
        [orgId],
      ),
      pool.query<TermInput>(
        `SELECT t.id, t.term, t.type, t.replacement, t.rule_id, r.code AS rule_code, t.note
         FROM terms t
         LEFT JOIN rules r ON t.rule_id = r.id
         WHERE t.organization_id = $1`,
        [orgId],
      ),
      runClaimLedger({
        organizationId: orgId,
        body: content.revision_body,
        purpose: content.purpose,
        audience: content.audience,
        channel: content.channel,
        pool,
      }),
    ]);

    const rules = rulesRes.rows;
    const terms = termsRes.rows;
    const ruleCodeToId = new Map(rules.map((r: RuleInput) => [r.code, r.id]));

    // Record AI timing in Server-Timing store
    const timingStore = timingStorage.getStore();
    if (timingStore && ledgerResult.aiLatencyMs) {
      timingStore.aiTime += ledgerResult.aiLatencyMs;
    }

    // 3. Run pure rule checks
    const ruleFindings = runRuleChecks(content.revision_body, { rules, terms });

    // Combine rule findings and validated claim ledger findings
    const allFindings = [
      ...ruleFindings.map((f) => ({
        kind: f.kind,
        span_text: f.span_text,
        start_offset: f.start_offset,
        end_offset: f.end_offset,
        verdict: null as string | null,
        rule_id: f.rule_code ? (ruleCodeToId.get(f.rule_code) ?? null) : null,
        fact_id: null as string | null,
        reason: f.reason,
        severity: f.severity,
        confidence: f.confidence,
        suggested_fix: f.suggested_fix,
      })),
      ...ledgerResult.findings.map((f: ValidatedClaimFinding) => ({
        kind: "claim" as const,
        span_text: f.span_text,
        start_offset: f.start_offset,
        end_offset: f.end_offset,
        verdict: f.verdict as string | null,
        rule_id: f.rule_id,
        fact_id: f.fact_id,
        reason: f.reason,
        severity: f.severity,
        confidence: f.confidence,
        suggested_fix: f.suggested_fix,
      })),
    ];

    // 4. In one transaction: save review, batch insert findings, and audit log
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: reviewRows } = await client.query(
        `INSERT INTO reviews (
           organization_id, revision_id, provider, model, started_at, finished_at,
           ai_status, ai_provider, ai_model, ai_latency_ms
         )
         VALUES ($1, $2, 'rules', 'vouch-rules-v1', now(), now(), $3, $4, $5, $6)
         RETURNING id, organization_id, revision_id, provider, model, started_at, finished_at, created_at,
                   ai_status, ai_provider, ai_model, ai_latency_ms`,
        [
          orgId,
          content.revision_id,
          ledgerResult.aiStatus,
          ledgerResult.aiProvider,
          ledgerResult.aiModel,
          ledgerResult.aiLatencyMs,
        ],
      );
      const review = reviewRows[0];

      // Batch insert findings in one query if any findings exist
      if (allFindings.length > 0) {
        const valueClauses: string[] = [];
        const params: any[] = [orgId, review.id];
        let paramIdx = 3;

        for (const f of allFindings) {
          const placeholders = Array.from({ length: 11 }, (_, i) => `$${paramIdx + i}`).join(", ");
          valueClauses.push(`($1, $2, ${placeholders})`);
          params.push(
            f.kind,
            f.span_text,
            f.start_offset,
            f.end_offset,
            f.verdict,
            f.rule_id,
            f.fact_id,
            f.reason,
            f.severity,
            f.confidence,
            f.suggested_fix,
          );
          paramIdx += 11;
        }

        await client.query(
          `INSERT INTO findings (
             organization_id, review_id, kind, span_text, start_offset, end_offset,
             verdict, rule_id, fact_id, reason, severity, confidence, suggested_fix
           )
           VALUES ${valueClauses.join(", ")}`,
          params,
        );
      }

      await logAudit({
        organizationId: orgId,
        actor: req.user!.id,
        action: "review.run",
        entity: `review:${review.id}`,
        payload: {
          content_id: content.id,
          revision_id: content.revision_id,
          findings_count: allFindings.length,
          ai_status: ledgerResult.aiStatus,
        },
        client,
      });

      await client.query("COMMIT");

      // Query findings joined with rules and facts tables for response
      const { rows: findings } = await pool.query(
        `SELECT f.id, f.organization_id, f.review_id, f.kind, f.span_text,
                f.start_offset, f.end_offset, f.verdict,
                f.rule_id, r.code AS rule_code, r.text AS rule_text,
                f.fact_id, fa.code AS fact_code, fa.statement AS fact_statement, fa.valid_until AS fact_valid_until,
                f.reason, f.severity, f.confidence, f.suggested_fix,
                f.resolution, f.dismiss_reason, f.created_at
         FROM findings f
         LEFT JOIN rules r ON f.rule_id = r.id
         LEFT JOIN facts fa ON f.fact_id = fa.id
         WHERE f.review_id = $1 AND f.organization_id = $2
         ORDER BY f.start_offset ASC, f.id ASC`,
        [review.id, orgId],
      );

      return res.status(201).json({ review, findings });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/contents/:id/reviews error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/contents/:id (optimized single-round-trip with revisions aggregated)
contentsRouter.get("/:id", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT 
         c.id,
         c.organization_id,
         c.title,
         c.purpose,
         c.audience,
         c.channel,
         c.status,
         c.created_by,
         COALESCE(u.name, '') AS created_by_name,
         c.created_at,
         c.updated_at,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', r.id,
                 'n', r.n,
                 'body', r.body,
                 'created_by', r.created_by,
                 'created_by_name', COALESCE(ru.name, ''),
                 'created_at', r.created_at
               ) ORDER BY r.n DESC
             )
             FROM revisions r
             LEFT JOIN users ru ON r.created_by = ru.id
             WHERE r.content_id = c.id AND r.organization_id = c.organization_id
           ),
           '[]'::json
         ) AS revisions
       FROM contents c
       LEFT JOIN users u ON c.created_by = u.id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, orgId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = rows[0];

    // If role is creator, they can only view content they created
    if (req.user!.role === "creator" && content.created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json(content);
  } catch (err) {
    console.error("GET /api/contents/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default contentsRouter;

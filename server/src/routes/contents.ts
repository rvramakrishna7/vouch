import { Router, type Request, type Response } from "express";
import path from "node:path";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";
import {
  runRuleChecks,
  type RuleInput,
  type TermInput,
} from "../engine/ruleChecks.js";
import {
  runClaimLedger,
  type ValidatedClaimFinding,
  dedupePunctuation,
  isSentenceStart,
  capitalizeFirstLetter,
} from "../ledger/pipeline.js";
import { timingStorage } from "../middleware/timing.js";

export const contentsRouter = Router();

export async function fetchContentWithRevisions(contentId: string, orgId: string, clientOrPool: any = pool) {
  const { rows } = await clientOrPool.query(
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
    [contentId, orgId],
  );
  return rows[0] || null;
}


// Apply requireAuth to all contents routes
contentsRouter.use(requireAuth);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let uploadCache: any = null;
async function getUpload() {
  if (!uploadCache) {
    const { default: multer } = await import("multer");
    uploadCache = {
      multer,
      upload: multer({
        storage: multer.memoryStorage(),
        limits: {
          fileSize: 4 * 1024 * 1024, // 4 MB
        },
      }),
    };
  }
  return uploadCache;
}

// POST /api/contents/extract (creator only)
contentsRouter.post(
  "/extract",
  requireRole("creator"),
  async (req: Request, res: Response, next) => {
    try {
      const { multer, upload } = await getUpload();
      upload.single("file")(req, res, (err: any) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "file_too_large" });
          }
          return res.status(400).json({ error: "invalid_input", details: err.message });
        }
        next();
      });
    } catch (e) {
      next(e);
    }
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
      const { default: mammoth } = await import("mammoth");
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
             'created_at', rw.created_at,
             'ai_status', rw.ai_status,
             'ai_provider', rw.ai_provider,
             'ai_model', rw.ai_model,
             'ai_latency_ms', rw.ai_latency_ms
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
                 'replacement_text', f.replacement_text,
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
      status: string;
      purpose: string;
      audience: string;
      channel: string;
      revision_id: string;
      revision_n: number;
      revision_body: string;
    }>(
      `SELECT c.id, c.created_by, c.status, c.purpose, c.audience, c.channel,
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

    if (content.status === "approved") {
      return res.status(409).json({ error: "approved_locked" });
    }

    if (content.status === "in_review") {
      return res.status(409).json({ error: "in_review_locked" });
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
                f.reason, f.severity, f.confidence, f.suggested_fix, f.replacement_text,
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

const createRevisionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("apply_fixes"),
  }),
  z.object({
    mode: z.literal("preview"),
  }),
  z.object({
    mode: z.literal("manual"),
    body: z.string().trim().min(1, "Body is required").max(20000, "Body must be at most 20000 characters"),
  }),
]);

// POST /api/contents/:id/revisions (creator owner only)
contentsRouter.post("/:id/revisions", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  // Creator only
  if (req.user!.role !== "creator") {
    return res.status(403).json({ error: "forbidden" });
  }

  const parseResult = createRevisionSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "invalid_input", details: parseResult.error.format() });
  }

  try {
    // Verify content exists and is owned by this creator
    const { rows: contentRows } = await pool.query<{ id: string; created_by: string; status: string }>(
      `SELECT id, created_by, status FROM contents WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    if (contentRows[0].created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    if (contentRows[0].status === "approved") {
      return res.status(409).json({ error: "approved_locked" });
    }

    if (contentRows[0].status === "in_review") {
      return res.status(409).json({ error: "in_review_locked" });
    }

    const { mode } = parseResult.data;

    if (mode === "manual") {
      const { body } = parseResult.data;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: maxRows } = await client.query<{ max_n: number }>(
          `SELECT COALESCE(MAX(n), 0)::int AS max_n FROM revisions WHERE content_id = $1 AND organization_id = $2`,
          [id, orgId],
        );
        const nextN = (maxRows[0]?.max_n ?? 0) + 1;
        const { rows: revRows } = await client.query(
          `INSERT INTO revisions (organization_id, content_id, n, body, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, organization_id, content_id, n, body, created_by, created_at`,
          [orgId, id, nextN, body, req.user!.id],
        );
        const revision = revRows[0];

        await client.query(
          `UPDATE contents
           SET status = CASE WHEN status = 'changes_requested' THEN 'draft' ELSE status END,
               updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [id, orgId],
        );

        await logAudit({
          organizationId: orgId,
          actor: req.user!.id,
          action: "revision.create",
          entity: `revision:${revision.id}`,
          payload: {
            content_id: id,
            revision_id: revision.id,
            n: revision.n,
            mode: "manual",
            applied: [],
            skipped: [],
          },
          client,
        });

        await client.query("COMMIT");
        return res.status(201).json({ revision, applied: [], skipped: [] });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // mode === "apply_fixes"
    // 1. Fetch latest revision of content
    const { rows: latestRevRows } = await pool.query<{ id: string; n: number; body: string }>(
      `SELECT id, n, body FROM revisions
       WHERE content_id = $1 AND organization_id = $2
       ORDER BY n DESC LIMIT 1`,
      [id, orgId],
    );

    if (latestRevRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }
    const latestRev = latestRevRows[0];

    // 2. Fetch latest review of that latest revision
    const { rows: latestReviewRows } = await pool.query<{ id: string }>(
      `SELECT id FROM reviews
       WHERE revision_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [latestRev.id, orgId],
    );

    if (latestReviewRows.length === 0) {
      return res.status(400).json({ error: "nothing_to_apply" });
    }
    const latestReview = latestReviewRows[0];

    // 3. Fetch accepted or edited findings for that latest review
    const { rows: candidateFindings } = await pool.query<{
      id: string;
      span_text: string;
      start_offset: number | null;
      end_offset: number | null;
      suggested_fix: string | null;
      replacement_text: string | null;
      resolution: string;
    }>(
      `SELECT id, span_text, start_offset, end_offset, suggested_fix, replacement_text, resolution
       FROM findings
       WHERE review_id = $1 AND organization_id = $2 AND resolution IN ('accepted', 'edited')`,
      [latestReview.id, orgId],
    );

    if (candidateFindings.length === 0) {
      return res.status(400).json({ error: "nothing_to_apply" });
    }

    interface ValidFinding {
      id: string;
      start_offset: number;
      end_offset: number;
      replacement: string;
    }

    const validCandidates: ValidFinding[] = [];
    for (const f of candidateFindings) {
      const replacement = f.resolution === "accepted" ? f.suggested_fix : f.replacement_text;
      if (
        typeof f.start_offset === "number" &&
        typeof f.end_offset === "number" &&
        f.start_offset >= 0 &&
        f.end_offset >= f.start_offset &&
        f.end_offset <= latestRev.body.length &&
        typeof replacement === "string"
      ) {
        validCandidates.push({
          id: f.id,
          start_offset: f.start_offset,
          end_offset: f.end_offset,
          replacement,
        });
      }
    }

    if (validCandidates.length === 0) {
      return res.status(400).json({ error: "nothing_to_apply" });
    }

    // Sort candidates from END of text backwards: start_offset DESC, then end_offset DESC
    validCandidates.sort((a, b) => b.start_offset - a.start_offset || b.end_offset - a.end_offset);

    const applied: string[] = [];
    const skipped: string[] = [];
    const appliedSpans: Array<{ start: number; end: number }> = [];

    let newBody = latestRev.body;

    for (const candidate of validCandidates) {
      // Check overlap with already applied spans
      const hasOverlap = appliedSpans.some(
        (span) => Math.max(span.start, candidate.start_offset) < Math.min(span.end, candidate.end_offset),
      );

      if (hasOverlap) {
        skipped.push(candidate.id);
      } else {
        applied.push(candidate.id);
        appliedSpans.push({ start: candidate.start_offset, end: candidate.end_offset });
        let replacement = candidate.replacement;
        if (isSentenceStart(latestRev.body, candidate.start_offset)) {
          replacement = capitalizeFirstLetter(replacement);
        }
        const nextChar = latestRev.body[candidate.end_offset];
        const cleanReplacement = dedupePunctuation(replacement, nextChar);
        newBody = newBody.slice(0, candidate.start_offset) + cleanReplacement + newBody.slice(candidate.end_offset);
      }
    }

    if (applied.length === 0) {
      return res.status(400).json({ error: "nothing_to_apply", skipped });
    }

    if (mode === "preview") {
      return res.json({ body: newBody, applied, skipped });
    }

    // Insert revision n+1 in transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const nextN = latestRev.n + 1;
      const { rows: revRows } = await client.query(
        `INSERT INTO revisions (organization_id, content_id, n, body, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, content_id, n, body, created_by, created_at`,
        [orgId, id, nextN, newBody, req.user!.id],
      );
      const revision = revRows[0];

      await client.query(
        `UPDATE contents
         SET status = CASE WHEN status = 'changes_requested' THEN 'draft' ELSE status END,
             updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [id, orgId],
      );

      await logAudit({
        organizationId: orgId,
        actor: req.user!.id,
        action: "revision.create",
        entity: `revision:${revision.id}`,
        payload: {
          content_id: id,
          revision_id: revision.id,
          n: revision.n,
          mode: "apply_fixes",
          applied,
          skipped,
        },
        client,
      });

      await client.query("COMMIT");
      return res.status(201).json({ revision, applied, skipped });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/contents/:id/revisions error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/contents/:id/submit (creator owner only)
contentsRouter.post("/:id/submit", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  // Creator only
  if (req.user!.role !== "creator") {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const { rows: contentRows } = await pool.query<{
      id: string;
      created_by: string;
      status: string;
    }>(
      `SELECT id, created_by, status FROM contents WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    if (contentRows[0].created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = contentRows[0];
    if (content.status !== "draft" && content.status !== "changes_requested") {
      return res.status(409).json({ error: "invalid_status", status: content.status });
    }

    // Latest revision
    const { rows: latestRevRows } = await pool.query<{ id: string; n: number }>(
      `SELECT id, n FROM revisions
       WHERE content_id = $1 AND organization_id = $2
       ORDER BY n DESC LIMIT 1`,
      [id, orgId],
    );

    if (latestRevRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }
    const latestRev = latestRevRows[0];

    // Latest review of content
    const { rows: latestReviewRows } = await pool.query<{
      id: string;
      revision_id: string;
    }>(
      `SELECT rw.id, rw.revision_id
       FROM reviews rw
       JOIN revisions rv ON rw.revision_id = rv.id
       WHERE rv.content_id = $1 AND rw.organization_id = $2
       ORDER BY rw.created_at DESC LIMIT 1`,
      [id, orgId],
    );

    if (latestReviewRows.length === 0 || latestReviewRows[0].revision_id !== latestRev.id) {
      return res.status(409).json({ error: "review_required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: updatedRows } = await client.query(
        `UPDATE contents
         SET status = 'in_review', updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, orgId],
      );

      await logAudit({
        organizationId: orgId,
        actor: req.user!.id,
        action: "content.submit",
        entity: `content:${id}`,
        payload: {
          content_id: id,
          revision_id: latestRev.id,
        },
        client,
      });

      await client.query("COMMIT");
      const fullContent = await fetchContentWithRevisions(id, orgId);
      return res.json({ content: fullContent || updatedRows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/contents/:id/submit error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

const decisionBodySchema = z.object({
  decision: z.enum(["approve", "request_changes"]),
  comment: z.string().optional(),
  override_reason: z.string().optional(),
});

// POST /api/contents/:id/decision (reviewer only; others 403)
contentsRouter.post("/:id/decision", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  // Reviewer only
  if (req.user!.role !== "reviewer") {
    return res.status(403).json({ error: "forbidden" });
  }

  const parseResult = decisionBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "invalid_input", details: parseResult.error.format() });
  }

  const { decision, comment, override_reason } = parseResult.data;

  try {
    const { rows: contentRows } = await pool.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status FROM contents WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = contentRows[0];
    if (content.status !== "in_review") {
      return res.status(409).json({ error: "not_in_review" });
    }

    // Latest revision
    const { rows: latestRevRows } = await pool.query<{ id: string; n: number }>(
      `SELECT id, n FROM revisions
       WHERE content_id = $1 AND organization_id = $2
       ORDER BY n DESC LIMIT 1`,
      [id, orgId],
    );

    if (latestRevRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }
    const latestRev = latestRevRows[0];

    // Latest review of that latest revision
    const { rows: latestReviewRows } = await pool.query<{
      id: string;
      ai_status: string;
    }>(
      `SELECT id, ai_status FROM reviews
       WHERE revision_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [latestRev.id, orgId],
    );

    if (latestReviewRows.length === 0) {
      return res.status(409).json({ error: "review_required" });
    }
    const latestReview = latestReviewRows[0];

    let targetStatus: string;
    let approvalDecision: "approved" | "changes_requested";

    if (decision === "request_changes") {
      if (!comment || typeof comment !== "string" || comment.trim().length < 5) {
        return res.status(400).json({
          error: "invalid_input",
          details: "Comment is required (min 5 characters)",
        });
      }
      targetStatus = "changes_requested";
      approvalDecision = "changes_requested";
    } else {
      // decision === "approve"
      // Count open findings with severity high that are not a supported claim
      const { rows: openHighRows } = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM findings
         WHERE review_id = $1
           AND organization_id = $2
           AND resolution = 'open'
           AND severity = 'high'
           AND NOT (kind = 'claim' AND verdict = 'supported')`,
        [latestReview.id, orgId],
      );
      const openHighCount = openHighRows[0]?.count ?? 0;
      const aiStatus = latestReview.ai_status;

      if (openHighCount > 0 || aiStatus !== "ok") {
        if (!override_reason || typeof override_reason !== "string" || override_reason.trim().length < 10) {
          return res.status(409).json({
            error: "override_required",
            open_high: openHighCount,
            ai_status: aiStatus,
          });
        }
      }

      targetStatus = "approved";
      approvalDecision = "approved";
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: updatedContentRows } = await client.query(
        `UPDATE contents
         SET status = $1, updated_at = now()
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [targetStatus, id, orgId],
      );

      const trimmedOverride = override_reason?.trim() ? override_reason.trim() : null;
      const { rows: approvalRows } = await client.query(
        `INSERT INTO approvals (organization_id, content_id, revision_id, user_id, decision, override_reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, content_id, revision_id, user_id, decision, override_reason, created_at`,
        [orgId, id, latestRev.id, req.user!.id, approvalDecision, trimmedOverride],
      );

      if (comment && comment.trim().length > 0) {
        await client.query(
          `INSERT INTO comments (organization_id, content_id, revision_id, user_id, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [orgId, id, latestRev.id, req.user!.id, comment.trim()],
        );
      }

      const auditAction = decision === "approve" ? "content.approve" : "content.request_changes";
      await logAudit({
        organizationId: orgId,
        actor: req.user!.id,
        action: auditAction,
        entity: `content:${id}`,
        payload: {
          content_id: id,
          revision_id: latestRev.id,
          decision: approvalDecision,
          override_reason: trimmedOverride,
          comment: comment?.trim() ?? null,
        },
        client,
      });

      await client.query("COMMIT");
      const fullContent = await fetchContentWithRevisions(id, orgId);
      return res.json({
        content: fullContent || updatedContentRows[0],
        approval: approvalRows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/contents/:id/decision error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/contents/:id/activity (all roles with view access to content)
contentsRouter.get("/:id/activity", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const { rows: contentRows } = await pool.query<{
      id: string;
      created_by: string;
    }>(
      `SELECT id, created_by FROM contents WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    // If role is creator, they can only view activity of content they created
    if (req.user!.role === "creator" && contentRows[0].created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // 1. Fetch audit events for this content
    const { rows: auditRows } = await pool.query<{
      id: string;
      actor: string;
      actor_name: string;
      action: string;
      entity: string;
      payload: any;
      at: string;
    }>(
      `SELECT 
         ae.id,
         ae.actor,
         COALESCE(u.name, 'System') AS actor_name,
         ae.action,
         ae.entity,
         ae.payload,
         ae.at
       FROM audit_events ae
       LEFT JOIN users u ON (u.id::text = ae.actor OR lower(u.email) = lower(ae.actor))
       WHERE ae.organization_id = $2
         AND (ae.entity = 'content:' || $1 OR ae.payload->>'content_id' = $1)
       ORDER BY ae.at ASC, ae.id ASC`,
      [id, orgId],
    );

    // 2. Fetch comments for this content
    const { rows: commentRows } = await pool.query<{
      id: string;
      user_id: string;
      actor_name: string;
      body: string;
      revision_id: string | null;
      created_at: string;
    }>(
      `SELECT 
         c.id,
         c.user_id,
         COALESCE(u.name, 'Unknown') AS actor_name,
         c.body,
         c.revision_id,
         c.created_at
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.organization_id = $2 AND c.content_id = $1
       ORDER BY c.created_at ASC, c.id ASC`,
      [id, orgId],
    );

    interface ActivityItem {
      id: string;
      action: string;
      actor: string;
      actor_name: string;
      time: string;
      details: Record<string, unknown>;
    }

    const timeline: ActivityItem[] = [];

    for (const ae of auditRows) {
      let details: Record<string, unknown> = {};
      const p = ae.payload || {};

      switch (ae.action) {
        case "contents.create":
        case "content.create":
          details = { title: p.title, channel: p.channel };
          break;
        case "revision.create":
          details = {
            revision_id: p.revision_id,
            n: p.n,
            mode: p.mode,
            applied_count: Array.isArray(p.applied) ? p.applied.length : 0,
            skipped_count: Array.isArray(p.skipped) ? p.skipped.length : 0,
          };
          break;
        case "review.run":
          details = {
            revision_id: p.revision_id,
            findings_count: p.findings_count,
            ai_status: p.ai_status,
          };
          break;
        case "finding.resolve":
          details = {
            action: p.action,
            finding_id: p.finding_id,
            replacement_text: p.replacement_text ?? p.text ?? null,
            dismiss_reason: p.dismiss_reason ?? p.reason ?? null,
          };
          break;
        case "content.submit":
          details = {
            revision_id: p.revision_id,
          };
          break;
        case "content.approve":
          details = {
            revision_id: p.revision_id,
            override_reason: p.override_reason,
            comment: p.comment,
          };
          break;
        case "content.request_changes":
          details = {
            revision_id: p.revision_id,
            comment: p.comment,
          };
          break;
        default:
          details = p;
          break;
      }

      timeline.push({
        id: ae.id,
        action: ae.action,
        actor: ae.actor,
        actor_name: ae.actor_name,
        time: ae.at,
        details,
      });
    }

    for (const c of commentRows) {
      // Do not return a separate "comment" item when the same comment is already in a content.request_changes/approve event (same revision_id + body)
      const isCoveredByDecision = auditRows.some(
        (ae) =>
          (ae.action === "content.request_changes" || ae.action === "content.approve") &&
          ae.payload?.revision_id === c.revision_id &&
          typeof ae.payload?.comment === "string" &&
          ae.payload.comment.trim() === c.body.trim(),
      );

      if (!isCoveredByDecision) {
        timeline.push({
          id: c.id,
          action: "comment",
          actor: c.user_id,
          actor_name: c.actor_name,
          time: c.created_at,
          details: {
            body: c.body,
            revision_id: c.revision_id,
          },
        });
      }
    }

    // Sort timeline oldest first (time ASC)
    timeline.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return res.json({ activity: timeline });
  } catch (err) {
    console.error("GET /api/contents/:id/activity error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default contentsRouter;

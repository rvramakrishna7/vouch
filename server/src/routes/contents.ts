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

// GET /api/contents/:id/reviews/latest (any role that can see content)
contentsRouter.get("/:id/reviews/latest", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    // Check content access
    const { rows: contentRows } = await pool.query<{ id: string; created_by: string }>(
      "SELECT id, created_by FROM contents WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = contentRows[0];
    if (req.user!.role === "creator" && content.created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // Get latest review for this content
    const { rows: reviewRows } = await pool.query(
      `SELECT rw.id, rw.organization_id, rw.revision_id, rw.provider, rw.model,
              rw.started_at, rw.finished_at, rw.created_at
       FROM reviews rw
       JOIN revisions rv ON rw.revision_id = rv.id
       WHERE rv.content_id = $1 AND rw.organization_id = $2
       ORDER BY rw.created_at DESC
       LIMIT 1`,
      [id, orgId],
    );

    if (reviewRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const review = reviewRows[0];

    // Join findings with rule_code and rule_text
    const { rows: findings } = await pool.query(
      `SELECT f.id, f.organization_id, f.review_id, f.kind, f.span_text,
              f.start_offset, f.end_offset, f.verdict, f.rule_id,
              r.code AS rule_code, r.text AS rule_text,
              f.reason, f.severity, f.confidence, f.suggested_fix,
              f.resolution, f.dismiss_reason, f.created_at
       FROM findings f
       LEFT JOIN rules r ON f.rule_id = r.id
       WHERE f.review_id = $1 AND f.organization_id = $2
       ORDER BY f.start_offset ASC, f.id ASC`,
      [review.id, orgId],
    );

    return res.json({ review, findings });
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
    // 1. Verify content exists in org and user has access
    const { rows: contentRows } = await pool.query<{
      id: string;
      created_by: string;
    }>(
      "SELECT id, created_by FROM contents WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = contentRows[0];
    if (req.user!.role === "creator" && content.created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // 2. Fetch latest revision
    const { rows: revisionRows } = await pool.query<{
      id: string;
      n: number;
      body: string;
    }>(
      `SELECT id, n, body
       FROM revisions
       WHERE content_id = $1 AND organization_id = $2
       ORDER BY n DESC
       LIMIT 1`,
      [id, orgId],
    );

    if (revisionRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const latestRevision = revisionRows[0];

    // 3. Fetch rules and terms for this organization
    const { rows: rules } = await pool.query<RuleInput>(
      `SELECT id, code, category, severity, text, status
       FROM rules
       WHERE organization_id = $1`,
      [orgId],
    );

    const { rows: terms } = await pool.query<TermInput>(
      `SELECT t.id, t.term, t.type, t.replacement, t.rule_id, r.code AS rule_code, t.note
       FROM terms t
       LEFT JOIN rules r ON t.rule_id = r.id
       WHERE t.organization_id = $1`,
      [orgId],
    );

    // Map rule_code -> rule_id
    const ruleCodeToId = new Map(rules.map((r) => [r.code, r.id]));

    // 4. Run pure rule checks
    const computedFindings = runRuleChecks(latestRevision.body, { rules, terms });

    // 5. In one transaction: save review, findings, and audit log
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: reviewRows } = await client.query(
        `INSERT INTO reviews (organization_id, revision_id, provider, model, started_at, finished_at)
         VALUES ($1, $2, 'rules', 'vouch-rules-v1', now(), now())
         RETURNING id, organization_id, revision_id, provider, model, started_at, finished_at, created_at`,
        [orgId, latestRevision.id],
      );
      const review = reviewRows[0];

      for (const f of computedFindings) {
        const resolvedRuleId = f.rule_code
          ? (ruleCodeToId.get(f.rule_code) ?? null)
          : null;

        await client.query(
          `INSERT INTO findings (
             organization_id, review_id, kind, span_text, start_offset, end_offset,
             verdict, rule_id, reason, severity, confidence, suggested_fix
           )
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11)`,
          [
            orgId,
            review.id,
            f.kind,
            f.span_text,
            f.start_offset,
            f.end_offset,
            resolvedRuleId,
            f.reason,
            f.severity,
            f.confidence,
            f.suggested_fix,
          ],
        );
      }

      await logAudit({
        organizationId: orgId,
        actor: req.user!.id,
        action: "review.run",
        entity: `review:${review.id}`,
        payload: {
          content_id: content.id,
          revision_id: latestRevision.id,
          findings_count: computedFindings.length,
        },
        client,
      });

      await client.query("COMMIT");

      // Query findings joined with rules table for response
      const { rows: findings } = await pool.query(
        `SELECT f.id, f.organization_id, f.review_id, f.kind, f.span_text,
                f.start_offset, f.end_offset, f.verdict, f.rule_id,
                r.code AS rule_code, r.text AS rule_text,
                f.reason, f.severity, f.confidence, f.suggested_fix,
                f.resolution, f.dismiss_reason, f.created_at
         FROM findings f
         LEFT JOIN rules r ON f.rule_id = r.id
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

// GET /api/contents/:id (all roles, but creators can only view own)
contentsRouter.get("/:id", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const { rows: contentRows } = await pool.query(
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
         c.updated_at
       FROM contents c
       LEFT JOIN users u ON c.created_by = u.id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, orgId],
    );

    if (contentRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const content = contentRows[0];

    // If role is creator, they can only view content they created
    if (req.user!.role === "creator" && content.created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const { rows: revisionRows } = await pool.query(
      `SELECT 
         r.id,
         r.n,
         r.body,
         r.created_by,
         COALESCE(u.name, '') AS created_by_name,
         r.created_at
       FROM revisions r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.content_id = $1 AND r.organization_id = $2
       ORDER BY r.n DESC`,
      [id, orgId],
    );

    return res.json({
      ...content,
      revisions: revisionRows,
    });
  } catch (err) {
    console.error("GET /api/contents/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default contentsRouter;

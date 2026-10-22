import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import mammoth from "mammoth";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";

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

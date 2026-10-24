import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";
import { invalidateOrgRuleEmbeddingCache } from "../guidelines/pipeline.js";

export const rulesRouter = Router();

// Apply requireAuth to all rules routes
rulesRouter.use(requireAuth);

const CATEGORY_PREFIXES: Record<string, string> = {
  claims: "CLAIM",
  tone: "TONE",
  terminology: "TERM",
  accessibility: "ACC",
};

const createRuleSchema = z.object({
  category: z.enum(["claims", "tone", "terminology", "accessibility"]),
  severity: z.enum(["high", "medium", "low"]),
  text: z.string().min(1),
});

const patchRuleSchema = z
  .object({
    severity: z.enum(["high", "medium", "low"]).optional(),
    text: z.string().min(1).optional(),
    status: z.enum(["active", "archived", "draft"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// GET /api/rules
rulesRouter.get("/", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const statusQuery = req.query.status as string | undefined;

  if (statusQuery && !["active", "archived", "draft"].includes(statusQuery)) {
    return res.status(400).json({ error: "invalid_input", details: "Invalid status query" });
  }

  try {
    let query =
      "SELECT id, organization_id, code, category, severity, text, version, status, created_at FROM rules WHERE organization_id = $1";
    const params: unknown[] = [orgId];

    if (statusQuery) {
      query += " AND status = $2";
      params.push(statusQuery);
    }

    query += " ORDER BY code ASC";

    const { rows } = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error("GET /api/rules error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/rules/:id
rulesRouter.get("/:id", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      "SELECT id, organization_id, code, category, severity, text, version, status, created_at FROM rules WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/rules/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/rules (brand_manager only)
rulesRouter.post("/", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const parseResult = createRuleSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const { category, severity, text } = parseResult.data;
  const orgId = req.user!.organizationId;
  const prefix = CATEGORY_PREFIXES[category];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock matching rule codes in this org to prevent concurrency collisions
    const { rows } = await client.query<{ code: string }>(
      "SELECT code FROM rules WHERE organization_id = $1 AND code LIKE $2 FOR UPDATE",
      [orgId, `${prefix}-%`],
    );

    let maxNum = 0;
    for (const r of rows) {
      const parts = r.code.split("-");
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextCode = `${prefix}-${String(maxNum + 1).padStart(2, "0")}`;

    const { rows: inserted } = await client.query(
      `INSERT INTO rules (organization_id, code, category, severity, text, version, status)
       VALUES ($1, $2, $3, $4, $5, 1, 'active')
       RETURNING id, organization_id, code, category, severity, text, version, status, created_at`,
      [orgId, nextCode, category, severity, text],
    );

    const createdRule = inserted[0];

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "rules.create",
      entity: `rule:${createdRule.id}`,
      payload: { code: createdRule.code, category: createdRule.category },
      client,
    });

    await client.query("COMMIT");
    invalidateOrgRuleEmbeddingCache(orgId);
    return res.status(201).json(createdRule);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/rules error:", err);
    return res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

// PATCH /api/rules/:id (brand_manager only)
rulesRouter.patch("/:id", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const parseResult = patchRuleSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const orgId = req.user!.organizationId;
  const { id } = req.params;
  const { severity, text, status } = parseResult.data;

  try {
    // Check rule existence in this org
    const { rows: existingRows } = await pool.query<{
      id: string;
      text: string;
      version: number;
    }>(
      "SELECT id, text, version FROM rules WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const existing = existingRows[0];
    const textChanged = text !== undefined && text !== existing.text;
    const newVersion = textChanged ? existing.version + 1 : existing.version;

    const { rows: updatedRows } = await pool.query(
      `UPDATE rules
       SET severity = COALESCE($3, severity),
           text = COALESCE($4, text),
           status = COALESCE($5, status),
           version = $6
       WHERE id = $1 AND organization_id = $2
       RETURNING id, organization_id, code, category, severity, text, version, status, created_at`,
      [id, orgId, severity ?? null, text ?? null, status ?? null, newVersion],
    );

    const updated = updatedRows[0];

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: status === "archived" ? "rules.archive" : "rules.update",
      entity: `rule:${id}`,
      payload: { changes: parseResult.data, version: updated.version },
    });

    invalidateOrgRuleEmbeddingCache(orgId);
    return res.json(updated);
  } catch (err) {
    console.error("PATCH /api/rules/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default rulesRouter;

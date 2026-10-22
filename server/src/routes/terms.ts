import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";

export const termsRouter = Router();

termsRouter.use(requireAuth);

const createTermSchema = z.object({
  term: z.string().min(1),
  type: z.enum(["preferred", "banned", "regulated"]),
  replacement: z.string().optional(),
});

const patchTermSchema = z
  .object({
    term: z.string().min(1).optional(),
    type: z.enum(["preferred", "banned", "regulated"]).optional(),
    replacement: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// GET /api/terms
termsRouter.get("/", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;

  try {
    const { rows } = await pool.query(
      `SELECT id, organization_id, term, type, replacement, created_at
       FROM terms
       WHERE organization_id = $1
       ORDER BY term ASC`,
      [orgId],
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET /api/terms error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/terms/:id
termsRouter.get("/:id", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, organization_id, term, type, replacement, created_at
       FROM terms
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/terms/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/terms (brand_manager only)
termsRouter.post("/", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const parseResult = createTermSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const { term, type, replacement } = parseResult.data;
  const orgId = req.user!.organizationId;

  try {
    const { rows } = await pool.query(
      `INSERT INTO terms (organization_id, term, type, replacement)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, term, type, replacement, created_at`,
      [orgId, term, type, replacement ?? null],
    );

    const createdTerm = rows[0];

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "terms.create",
      entity: `term:${createdTerm.id}`,
      payload: { term: createdTerm.term, type: createdTerm.type },
    });

    return res.status(201).json(createdTerm);
  } catch (err) {
    console.error("POST /api/terms error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// PATCH /api/terms/:id (brand_manager only)
termsRouter.patch("/:id", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const parseResult = patchTermSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const orgId = req.user!.organizationId;
  const { id } = req.params;
  const { term, type, replacement } = parseResult.data;

  try {
    const { rows } = await pool.query(
      `UPDATE terms
       SET term = COALESCE($3, term),
           type = COALESCE($4, type),
           replacement = CASE WHEN $5::text IS NULL THEN replacement ELSE $5 END
       WHERE id = $1 AND organization_id = $2
       RETURNING id, organization_id, term, type, replacement, created_at`,
      [id, orgId, term ?? null, type ?? null, replacement ?? null],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const updated = rows[0];

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "terms.update",
      entity: `term:${id}`,
      payload: { changes: parseResult.data },
    });

    return res.json(updated);
  } catch (err) {
    console.error("PATCH /api/terms/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// DELETE /api/terms/:id (brand_manager only)
termsRouter.delete("/:id", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      "DELETE FROM terms WHERE id = $1 AND organization_id = $2 RETURNING id, term",
      [id, orgId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "terms.delete",
      entity: `term:${id}`,
      payload: { term: rows[0].term },
    });

    return res.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/terms/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default termsRouter;

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";

export const factsRouter = Router();

factsRouter.use(requireAuth);

const createFactSchema = z.object({
  statement: z.string().min(1),
  source: z.string().min(1),
  owner: z.string().optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

const patchFactSchema = z
  .object({
    statement: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    owner: z.string().nullable().optional(),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// GET /api/facts
factsRouter.get("/", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;

  try {
    const { rows } = await pool.query(
      `SELECT id, organization_id, code, statement, source, owner,
              valid_until::text AS valid_until,
              (valid_until < CURRENT_DATE) AS expired,
              created_at
       FROM facts
       WHERE organization_id = $1
       ORDER BY code ASC`,
      [orgId],
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET /api/facts error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/facts/:id
factsRouter.get("/:id", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, organization_id, code, statement, source, owner,
              valid_until::text AS valid_until,
              (valid_until < CURRENT_DATE) AS expired,
              created_at
       FROM facts
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/facts/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/facts (brand_manager only)
factsRouter.post("/", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const parseResult = createFactSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const { statement, source, owner, valid_until } = parseResult.data;
  const orgId = req.user!.organizationId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock matching facts in this org
    const { rows } = await client.query<{ code: string }>(
      "SELECT code FROM facts WHERE organization_id = $1 AND code LIKE 'F-%' FOR UPDATE",
      [orgId],
    );

    let maxNum = 0;
    for (const r of rows) {
      const parts = r.code.split("-");
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextCode = `F-${String(maxNum + 1).padStart(2, "0")}`;

    const { rows: inserted } = await client.query(
      `INSERT INTO facts (organization_id, code, statement, source, owner, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, code, statement, source, owner,
                 valid_until::text AS valid_until,
                 (valid_until < CURRENT_DATE) AS expired,
                 created_at`,
      [orgId, nextCode, statement, source, owner ?? null, valid_until],
    );

    const createdFact = inserted[0];

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "facts.create",
      entity: `fact:${createdFact.id}`,
      payload: { code: createdFact.code },
      client,
    });

    await client.query("COMMIT");
    return res.status(201).json(createdFact);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/facts error:", err);
    return res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

// PATCH /api/facts/:id (brand_manager only)
factsRouter.patch("/:id", requireRole("brand_manager"), async (req: Request, res: Response) => {
  const parseResult = patchFactSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: parseResult.error.format(),
    });
  }

  const orgId = req.user!.organizationId;
  const { id } = req.params;
  const { statement, source, owner, valid_until } = parseResult.data;

  try {
    const { rows: existingRows } = await pool.query<{
      id: string;
      statement: string;
    }>(
      "SELECT id, statement FROM facts WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const existing = existingRows[0];
    const statementChanged =
      statement !== undefined && statement !== existing.statement;

    const { rows: updatedRows } = await pool.query(
      `UPDATE facts
       SET statement = COALESCE($3, statement),
           source = COALESCE($4, source),
           owner = CASE WHEN $5::text IS NULL THEN owner ELSE $5 END,
           valid_until = COALESCE($6, valid_until),
           embedding = CASE WHEN $7 THEN NULL ELSE embedding END
       WHERE id = $1 AND organization_id = $2
       RETURNING id, organization_id, code, statement, source, owner,
                 valid_until::text AS valid_until,
                 (valid_until < CURRENT_DATE) AS expired,
                 created_at`,
      [
        id,
        orgId,
        statement ?? null,
        source ?? null,
        owner ?? null,
        valid_until ?? null,
        statementChanged,
      ],
    );

    const updated = updatedRows[0];

    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "facts.update",
      entity: `fact:${id}`,
      payload: { changes: parseResult.data },
    });

    return res.json(updated);
  } catch (err) {
    console.error("PATCH /api/facts/:id error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default factsRouter;

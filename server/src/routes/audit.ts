import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.use(requireRole("brand_manager", "reviewer"));

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().optional(),
  action: z.string().optional(),
});

// GET /api/audit (brand_manager and reviewer only; creator 403)
auditRouter.get("/", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;

  const parseResult = querySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: "invalid_input", details: parseResult.error.format() });
  }

  const { limit, before, action } = parseResult.data;

  try {
    const conditions: string[] = ["ae.organization_id = $1"];
    const params: unknown[] = [orgId];

    if (before) {
      const parts = before.split("|");
      if (parts.length === 2) {
        const [beforeIso, beforeId] = parts;
        const beforeDate = new Date(beforeIso);
        if (!isNaN(beforeDate.getTime())) {
          params.push(beforeDate.toISOString());
          const atParam = `$${params.length}`;
          params.push(beforeId.trim());
          const idParam = `$${params.length}`;
          conditions.push(`(ae.at, ae.id) < (${atParam}, ${idParam}::uuid)`);
        }
      } else {
        const beforeDate = new Date(before);
        if (!isNaN(beforeDate.getTime())) {
          params.push(beforeDate.toISOString());
          conditions.push(`ae.at < $${params.length}`);
        }
      }
    }

    if (action && action.trim()) {
      params.push(action.trim());
      conditions.push(`ae.action = $${params.length}`);
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const query = `
      SELECT 
        ae.id,
        ae.organization_id,
        ae.actor,
        COALESCE(u.name, 'System') AS actor_name,
        ae.action,
        ae.entity,
        ae.payload,
        ae.at
      FROM audit_events ae
      LEFT JOIN users u ON (u.id::text = ae.actor OR lower(u.email) = lower(ae.actor))
      WHERE ${conditions.join(" AND ")}
      ORDER BY ae.at DESC, ae.id DESC
      LIMIT ${limitPlaceholder}
    `;

    const { rows } = await pool.query<{
      id: string;
      organization_id: string;
      actor: string;
      actor_name: string;
      action: string;
      entity: string;
      payload: Record<string, unknown>;
      at: string;
    }>(query, params);

    const nextCursor =
      rows.length === limit
        ? `${new Date(rows[rows.length - 1].at).toISOString()}|${rows[rows.length - 1].id}`
        : null;

    return res.json({
      events: rows,
      next_cursor: nextCursor,
    });
  } catch (err) {
    console.error("GET /api/audit error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default auditRouter;

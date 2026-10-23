import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { requireAuth } from "../auth/middleware.js";
import pool from "../db/pool.js";

export const findingsRouter = Router();

findingsRouter.use(requireAuth);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const resolutionSchema = z.object({
  action: z.enum(["accept", "edit", "dismiss"]),
  text: z.string().optional(),
  reason: z.string().optional(),
});

// PATCH /api/findings/:id/resolution
// Creator who owns the content only; others 403/404
findingsRouter.patch("/:id/resolution", async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);

  if (!UUID_REGEX.test(id)) {
    return res.status(404).json({ error: "not_found" });
  }

  // Creator only
  if (req.user!.role !== "creator") {
    return res.status(403).json({ error: "forbidden" });
  }

  const parseResult = resolutionSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "invalid_input", details: parseResult.error.format() });
  }

  const { action, text, reason } = parseResult.data;

  // Validate action-specific parameters
  if (action === "edit") {
    if (!text || typeof text !== "string" || text.trim().length < 1 || text.trim().length > 500) {
      return res.status(400).json({
        error: "invalid_input",
        details: "Text is required (1-500 characters)",
      });
    }
  } else if (action === "dismiss") {
    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      return res.status(400).json({
        error: "invalid_input",
        details: "Reason is required (min 5 characters)",
      });
    }
  }

  try {
    // 1. Fetch finding, review, revision, content in one query
    const { rows: findingRows } = await pool.query<{
      id: string;
      organization_id: string;
      review_id: string;
      kind: string;
      span_text: string;
      start_offset: number | null;
      end_offset: number | null;
      verdict: string | null;
      suggested_fix: string | null;
      resolution: string;
      dismiss_reason: string | null;
      replacement_text: string | null;
      revision_id: string;
      content_id: string;
      content_created_by: string;
      content_status: string;
    }>(
      `SELECT 
         f.id,
         f.organization_id,
         f.review_id,
         f.kind,
         f.span_text,
         f.start_offset,
         f.end_offset,
         f.verdict,
         f.suggested_fix,
         f.resolution,
         f.dismiss_reason,
         f.replacement_text,
         rw.revision_id,
         rv.content_id,
         c.created_by AS content_created_by,
         c.status AS content_status
       FROM findings f
       JOIN reviews rw ON rw.id = f.review_id
       JOIN revisions rv ON rv.id = rw.revision_id
       JOIN contents c ON c.id = rv.content_id
       WHERE f.id = $1 AND f.organization_id = $2`,
      [id, orgId],
    );

    if (findingRows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const finding = findingRows[0];

    // Creator owner only: creators cannot access other creators' contents
    if (finding.content_created_by !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // Locked if content is approved
    if (finding.content_status === "approved") {
      return res.status(409).json({ error: "approved_locked" });
    }

    // Locked if content is in_review
    if (finding.content_status === "in_review") {
      return res.status(409).json({ error: "in_review_locked" });
    }

    // Supported claims cannot be resolved
    if (finding.kind === "claim" && finding.verdict === "supported") {
      return res.status(400).json({ error: "nothing_to_fix" });
    }

    // accept: only if the finding has suggested_fix
    if (action === "accept") {
      if (!finding.suggested_fix || !finding.suggested_fix.trim()) {
        return res.status(400).json({ error: "no_suggested_fix" });
      }
    }

    // Only findings of the content's LATEST review on the LATEST revision can be resolved
    // 2. Fetch latest revision of content
    const { rows: latestRevRows } = await pool.query<{ id: string; n: number }>(
      `SELECT id, n FROM revisions
       WHERE content_id = $1 AND organization_id = $2
       ORDER BY n DESC LIMIT 1`,
      [finding.content_id, orgId],
    );

    if (latestRevRows.length === 0 || latestRevRows[0].id !== finding.revision_id) {
      return res.status(409).json({ error: "stale_review" });
    }

    // 3. Fetch latest review of that latest revision
    const { rows: latestReviewRows } = await pool.query<{ id: string }>(
      `SELECT id FROM reviews
       WHERE revision_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [finding.revision_id, orgId],
    );

    if (latestReviewRows.length === 0 || latestReviewRows[0].id !== finding.review_id) {
      return res.status(409).json({ error: "stale_review" });
    }

    // 4. Update the finding
    let updatedRows;
    if (action === "accept") {
      updatedRows = await pool.query(
        `UPDATE findings
         SET resolution = 'accepted', replacement_text = NULL, dismiss_reason = NULL
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, orgId],
      );
    } else if (action === "edit") {
      updatedRows = await pool.query(
        `UPDATE findings
         SET resolution = 'edited', replacement_text = $3, dismiss_reason = NULL
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, orgId, text!.trim()],
      );
    } else {
      updatedRows = await pool.query(
        `UPDATE findings
         SET resolution = 'dismissed', dismiss_reason = $3, replacement_text = NULL
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, orgId, reason!.trim()],
      );
    }

    const updatedFinding = updatedRows.rows[0];

    // 5. Audit row per write
    await logAudit({
      organizationId: orgId,
      actor: req.user!.id,
      action: "finding.resolve",
      entity: `finding:${id}`,
      payload: {
        finding_id: id,
        content_id: finding.content_id,
        action,
        ...(action === "edit" ? { replacement_text: text!.trim() } : {}),
        ...(action === "dismiss" ? { dismiss_reason: reason!.trim() } : {}),
      },
    });

    return res.json({ finding: updatedFinding, ...updatedFinding });
  } catch (err) {
    console.error("PATCH /api/findings/:id/resolution error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default findingsRouter;

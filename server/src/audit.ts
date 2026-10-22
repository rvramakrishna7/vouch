import pool from "./db/pool.js";

export interface LogAuditParams {
  organizationId: string;
  actor: string;
  action: string;
  entity: string;
  payload?: Record<string, unknown> | null;
}

export async function logAudit({
  organizationId,
  actor,
  action,
  entity,
  payload = {},
}: LogAuditParams): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (organization_id, actor, action, entity, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, actor, action, entity, JSON.stringify(payload ?? {})],
  );
}

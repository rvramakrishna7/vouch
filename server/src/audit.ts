import type pg from "pg";
import pool from "./db/pool.js";

export interface LogAuditParams {
  organizationId: string;
  actor: string;
  action: string;
  entity: string;
  payload?: Record<string, unknown> | null;
  client?: pg.Pool | pg.PoolClient;
}

export async function logAudit({
  organizationId,
  actor,
  action,
  entity,
  payload = {},
  client = pool,
}: LogAuditParams): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (organization_id, actor, action, entity, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, actor, action, entity, JSON.stringify(payload ?? {})],
  );
}

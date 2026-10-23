import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import pool from "../src/db/pool.js";
import { signToken } from "../src/auth/jwt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

const hasDb = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDb)("Submit, Approval and Audit API (Task S10a)", () => {
  let creatorToken: string;
  let reviewerToken: string;
  let brandManagerToken: string;
  let northwindToken: string;
  let creatorOrgId: string;
  let creatorUserId: string;

  const createdContentIds: string[] = [];

  beforeAll(async () => {
    // 1. Creator login
    const creatorRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator" });
    expect(creatorRes.status).toBe(200);
    creatorToken = creatorRes.body.token;
    creatorOrgId = creatorRes.body.organization.id;
    creatorUserId = creatorRes.body.user.id;

    // 2. Reviewer login
    const reviewerRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "reviewer" });
    expect(reviewerRes.status).toBe(200);
    reviewerToken = reviewerRes.body.token;

    // 3. Brand manager login
    const bmRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "brand_manager" });
    expect(bmRes.status).toBe(200);
    brandManagerToken = bmRes.body.token;

    // 4. Northwind token
    const { rows: nwRows } = await pool.query<{
      id: string;
      organization_id: string;
      role: string;
    }>(
      `SELECT u.id, u.organization_id, u.role
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE o.slug = 'northwind-labs'
       LIMIT 1`,
    );
    expect(nwRows.length).toBeGreaterThan(0);
    northwindToken = signToken({
      sub: nwRows[0].id,
      org: nwRows[0].organization_id,
      role: nwRows[0].role,
    });
  });

  afterAll(async () => {
    for (const cid of createdContentIds) {
      await pool.query("DELETE FROM contents WHERE id = $1", [cid]);
    }
  });

  async function setupTestContent(body = "Test caption content") {
    const { rows: cRows } = await pool.query<{ id: string }>(
      `INSERT INTO contents (organization_id, title, purpose, audience, channel, status, created_by)
       VALUES ($1, 'Approval Test Content', 'Test purpose', 'Audience', 'Instagram', 'draft', $2)
       RETURNING id`,
      [creatorOrgId, creatorUserId],
    );
    const contentId = cRows[0].id;
    createdContentIds.push(contentId);

    const { rows: rRows } = await pool.query<{ id: string; n: number; body: string }>(
      `INSERT INTO revisions (organization_id, content_id, n, body, created_by)
       VALUES ($1, $2, 1, $3, $4)
       RETURNING id, n, body`,
      [creatorOrgId, contentId, body, creatorUserId],
    );
    const revision = rRows[0];

    return { contentId, revision };
  }

  it("submit without review -> 409", async () => {
    const { contentId } = await setupTestContent();

    const res = await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("review_required");
  });

  it("submit ok", async () => {
    const { contentId, revision } = await setupTestContent();

    // Create review for revision 1
    await pool.query(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')`,
      [creatorOrgId, revision.id],
    );

    const res = await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.content.status).toBe("in_review");

    // Verify audit event
    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_events WHERE entity = $1 AND action = 'content.submit'`,
      [`content:${contentId}`],
    );
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it("creator decision -> 403", async () => {
    const { contentId, revision } = await setupTestContent();
    await pool.query(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')`,
      [creatorOrgId, revision.id],
    );
    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    const res = await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ decision: "approve" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("request_changes without comment -> 400", async () => {
    const { contentId, revision } = await setupTestContent();
    await pool.query(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')`,
      [creatorOrgId, revision.id],
    );
    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    const res = await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "request_changes", comment: "bad" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  it("approve with open high finding and no override -> 409 override_required", async () => {
    const { contentId, revision } = await setupTestContent();
    const { rows: rwRows } = await pool.query<{ id: string }>(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')
       RETURNING id`,
      [creatorOrgId, revision.id],
    );
    const reviewId = rwRows[0].id;

    // Insert open high finding
    await pool.query(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, severity, reason, resolution)
       VALUES ($1, $2, 'term', 'banned word', 'high', 'Violates policy', 'open')`,
      [creatorOrgId, reviewId],
    );

    // Submit content
    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    // Reviewer attempts to approve without override_reason
    const res = await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "approve" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("override_required");
    expect(res.body.open_high).toBe(1);
    expect(res.body.ai_status).toBe("ok");
  });

  it("approve with override -> approved + override stored + audit row", async () => {
    const { contentId, revision } = await setupTestContent();
    const { rows: rwRows } = await pool.query<{ id: string }>(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')
       RETURNING id`,
      [creatorOrgId, revision.id],
    );
    const reviewId = rwRows[0].id;

    await pool.query(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, severity, reason, resolution)
       VALUES ($1, $2, 'term', 'banned word', 'high', 'Violates policy', 'open')`,
      [creatorOrgId, reviewId],
    );

    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    const res = await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        decision: "approve",
        override_reason: "Approved exception per VP of Marketing",
      });

    expect(res.status).toBe(200);
    expect(res.body.content.status).toBe("approved");
    expect(res.body.approval.decision).toBe("approved");
    expect(res.body.approval.override_reason).toBe("Approved exception per VP of Marketing");

    // Verify approval stored in db
    const { rows: appRows } = await pool.query<{ decision: string; override_reason: string }>(
      `SELECT decision, override_reason FROM approvals WHERE content_id = $1`,
      [contentId],
    );
    expect(appRows.length).toBe(1);
    expect(appRows[0].decision).toBe("approved");
    expect(appRows[0].override_reason).toBe("Approved exception per VP of Marketing");

    // Verify audit event
    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_events WHERE entity = $1 AND action = 'content.approve'`,
      [`content:${contentId}`],
    );
    expect(auditRows.length).toBe(1);
  });

  it("resolving after approval -> 409 approved_locked", async () => {
    const { contentId, revision } = await setupTestContent();
    const { rows: rwRows } = await pool.query<{ id: string }>(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')
       RETURNING id`,
      [creatorOrgId, revision.id],
    );
    const reviewId = rwRows[0].id;

    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, severity, reason, resolution, suggested_fix)
       VALUES ($1, $2, 'term', 'word', 'low', 'Violates policy', 'open', 'replacement')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "approve" });

    // Try resolving finding
    const resolveRes = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    expect(resolveRes.status).toBe(409);
    expect(resolveRes.body.error).toBe("approved_locked");

    // Try creating revision
    const revRes = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "manual", body: "Trying to modify approved content" });

    expect(revRes.status).toBe(409);
    expect(revRes.body.error).toBe("approved_locked");
  });

  it("new revision after changes_requested -> draft", async () => {
    const { contentId, revision } = await setupTestContent();
    await pool.query(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')`,
      [creatorOrgId, revision.id],
    );

    // Submit
    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    // Request changes
    const reqRes = await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "request_changes", comment: "Please rephrase the headline" });

    expect(reqRes.status).toBe(200);
    expect(reqRes.body.content.status).toBe("changes_requested");

    // Create new revision
    const revRes = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "manual", body: "Rephrased headline revision 2" });

    expect(revRes.status).toBe(201);

    // Verify content status returned to 'draft'
    const { rows: contentRows } = await pool.query<{ status: string }>(
      `SELECT status FROM contents WHERE id = $1`,
      [contentId],
    );
    expect(contentRows[0].status).toBe("draft");
  });

  it("Northwind user -> 404 on activity", async () => {
    const { contentId } = await setupTestContent();

    const res = await request(app)
      .get(`/api/contents/${contentId}/activity`)
      .set("Authorization", `Bearer ${northwindToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("audit list filtered by org", async () => {
    // Creator cannot access audit list -> 403
    const creatorRes = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(creatorRes.status).toBe(403);
    expect(creatorRes.body.error).toBe("forbidden");

    // Brand manager can access audit list -> 200
    const bmRes = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${brandManagerToken}`);

    expect(bmRes.status).toBe(200);
    expect(Array.isArray(bmRes.body.events)).toBe(true);

    // All events belong to Aqualeaf org
    for (const ev of bmRes.body.events) {
      expect(ev.organization_id).toBe(creatorOrgId);
      expect(ev).toHaveProperty("actor_name");
      expect(ev).toHaveProperty("action");
    }
  });

  it("activity timeline returns ordered items with actor details", async () => {
    const { contentId, revision } = await setupTestContent();

    // Add review
    await pool.query(
      `INSERT INTO reviews (organization_id, revision_id, provider, model, ai_status)
       VALUES ($1, $2, 'test-provider', 'test-model', 'ok')`,
      [creatorOrgId, revision.id],
    );

    // Submit
    await request(app)
      .post(`/api/contents/${contentId}/submit`)
      .set("Authorization", `Bearer ${creatorToken}`);

    // Request changes with comment
    await request(app)
      .post(`/api/contents/${contentId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "request_changes", comment: "Need tighter copy" });

    // Creator checks activity
    const actRes = await request(app)
      .get(`/api/contents/${contentId}/activity`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(actRes.status).toBe(200);
    expect(Array.isArray(actRes.body.activity)).toBe(true);
    expect(actRes.body.activity.length).toBeGreaterThanOrEqual(3);

    const actions = actRes.body.activity.map((a: any) => a.action);
    expect(actions).toContain("content.submit");
    expect(actions).toContain("content.request_changes");
    expect(actions).toContain("comment");

    // Check actor_name
    const commentItem = actRes.body.activity.find((a: any) => a.action === "comment");
    expect(commentItem).toBeDefined();
    expect(commentItem.actor_name).toBeTruthy();
    expect(commentItem.details.body).toBe("Need tighter copy");
  });
});

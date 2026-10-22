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

describe.runIf(hasDb)("Finding Resolutions and Revisions API (Task S9a)", () => {
  let creatorToken: string;
  let reviewerToken: string;
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

    // 3. Northwind token
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

  // Helper to create test content, revision, review, and findings directly
  async function setupTestContent(body: string) {
    const { rows: cRows } = await pool.query<{ id: string }>(
      `INSERT INTO contents (organization_id, title, purpose, audience, channel, status, created_by)
       VALUES ($1, 'Resolutions Test Content', 'Test purpose', 'Audience', 'Instagram', 'draft', $2)
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

    const { rows: rwRows } = await pool.query<{ id: string }>(
      `INSERT INTO reviews (organization_id, revision_id, provider, model)
       VALUES ($1, $2, 'test-provider', 'test-model')
       RETURNING id`,
      [creatorOrgId, revision.id],
    );
    const reviewId = rwRows[0].id;

    return { contentId, revision, reviewId };
  }

  it("reviewer resolving -> 403", async () => {
    const { contentId, reviewId } = await setupTestContent("Sample text for test");
    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'Sample', 0, 6, 'low', 'Test reason', 'Replacement')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    const res = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ action: "accept" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("Northwind user -> 404", async () => {
    const { contentId, reviewId } = await setupTestContent("Sample text for test");
    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'Sample', 0, 6, 'low', 'Test reason', 'Replacement')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    const res = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${northwindToken}`)
      .send({ action: "accept" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("dismiss without reason -> 400", async () => {
    const { contentId, reviewId } = await setupTestContent("Sample text for test");
    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'Sample', 0, 6, 'low', 'Test reason', 'Replacement')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    // Without reason
    const resNoReason = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "dismiss" });

    expect(resNoReason.status).toBe(400);

    // With reason shorter than 5 characters
    const resShortReason = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "dismiss", reason: "no" });

    expect(resShortReason.status).toBe(400);

    // Valid dismiss (min 5 chars) -> 200
    const resValid = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "dismiss", reason: "Valid dismiss reason" });

    expect(resValid.status).toBe(200);
    expect(resValid.body.resolution).toBe("dismissed");
    expect(resValid.body.dismiss_reason).toBe("Valid dismiss reason");
  });

  it("accept without suggested_fix -> 400", async () => {
    const { contentId, reviewId } = await setupTestContent("Sample text for test");
    // Finding without suggested_fix
    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'Sample', 0, 6, 'low', 'Test reason', NULL)
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    const res = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_suggested_fix");
  });

  it("supported claims cannot be resolved -> 400", async () => {
    const { contentId, reviewId } = await setupTestContent("Sample text for test");
    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, verdict, suggested_fix)
       VALUES ($1, $2, 'claim', 'Sample', 0, 6, 'low', 'Supported claim', 'supported', 'Fix')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    const res = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("nothing_to_fix");
  });

  it("manual revision -> n+1", async () => {
    const { contentId } = await setupTestContent("Initial revision text");

    const res = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "manual", body: "Manual revision text" });

    expect(res.status).toBe(201);
    expect(res.body.revision.n).toBe(2);
    expect(res.body.revision.body).toBe("Manual revision text");
    expect(res.body.applied).toEqual([]);
    expect(res.body.skipped).toEqual([]);

    // Check content updated_at was touched
    const { rows: cRows } = await pool.query<{ updated_at: string }>(
      "SELECT updated_at FROM contents WHERE id = $1",
      [contentId],
    );
    expect(cRows[0].updated_at).toBeDefined();
  });

  it("stale review -> 409", async () => {
    const { contentId, reviewId } = await setupTestContent("Initial text");
    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'Initial', 0, 7, 'low', 'Reason', 'Updated')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    // Create a new revision n=2
    await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "manual", body: "Revision 2 text" });

    // Now the finding on revision 1 is stale
    const res = await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("stale_review");
  });

  it("apply_fixes with two non-overlapping fixes produces the exact expected new body (assert the string)", async () => {
    const initialText = "The quick brown fox jumps over the lazy dog.";
    const { contentId, reviewId } = await setupTestContent(initialText);

    // Finding 1: "brown" at [10, 15) -> accept fix "red"
    const { rows: f1Rows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'brown', 10, 15, 'low', 'Reason 1', 'red')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const f1Id = f1Rows[0].id;

    // Finding 2: "lazy" at [35, 39) -> edit with "sleepy"
    const { rows: f2Rows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason)
       VALUES ($1, $2, 'tone', 'lazy', 35, 39, 'medium', 'Reason 2')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const f2Id = f2Rows[0].id;

    // Accept finding 1
    const resAccept = await request(app)
      .patch(`/api/findings/${f1Id}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });
    expect(resAccept.status).toBe(200);

    // Edit finding 2
    const resEdit = await request(app)
      .patch(`/api/findings/${f2Id}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "edit", text: "sleepy" });
    expect(resEdit.status).toBe(200);

    // Call POST /api/contents/:id/revisions with apply_fixes
    const resApply = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "apply_fixes" });

    expect(resApply.status).toBe(201);
    expect(resApply.body.revision.n).toBe(2);
    expect(resApply.body.applied).toContain(f1Id);
    expect(resApply.body.applied).toContain(f2Id);
    expect(resApply.body.skipped).toEqual([]);

    // Assert exact expected string
    const expectedBody = "The quick red fox jumps over the sleepy dog.";
    expect(resApply.body.revision.body).toBe(expectedBody);
  });

  it("overlapping fixes -> one applied, one skipped", async () => {
    const initialText = "I have an eco-friendly bottle here.";
    const { contentId, reviewId } = await setupTestContent(initialText);

    // Finding 1: "eco-friendly" at [10, 22) -> fix "sustainable"
    const { rows: f1Rows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'eco-friendly', 10, 22, 'high', 'Reason 1', 'sustainable')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const f1Id = f1Rows[0].id;

    // Finding 2: "friendly bottle" at [14, 29) -> fix "green bottle" (overlaps [10, 22))
    const { rows: f2Rows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'friendly bottle', 14, 29, 'medium', 'Reason 2', 'green bottle')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const f2Id = f2Rows[0].id;

    // Accept both
    await request(app)
      .patch(`/api/findings/${f1Id}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    await request(app)
      .patch(`/api/findings/${f2Id}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    const resApply = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "apply_fixes" });

    expect(resApply.status).toBe(201);
    expect(resApply.body.applied.length).toBe(1);
    expect(resApply.body.skipped.length).toBe(1);

    // Verify exactly one was applied and the other skipped
    const allIds = [f1Id, f2Id];
    expect(allIds).toContain(resApply.body.applied[0]);
    expect(allIds).toContain(resApply.body.skipped[0]);
    expect(resApply.body.applied[0]).not.toBe(resApply.body.skipped[0]);
  });

  it("mode: 'preview' returns preview body without saving a revision", async () => {
    const initialText = "The quick brown fox jumps over the lazy dog.";
    const { contentId, reviewId } = await setupTestContent(initialText);

    const { rows: fRows } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'brown', 10, 15, 'low', 'Color check', 'red')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    const findingId = fRows[0].id;

    await request(app)
      .patch(`/api/findings/${findingId}/resolution`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ action: "accept" });

    // Call preview
    const resPreview = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "preview" });

    expect(resPreview.status).toBe(200);
    expect(resPreview.body.body).toBe("The quick red fox jumps over the lazy dog.");
    expect(resPreview.body.applied).toEqual([findingId]);
    expect(resPreview.body.skipped).toEqual([]);

    // Verify database revisions count is STILL 1 (no new revision saved)
    const { rows: revRows } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM revisions WHERE content_id = $1",
      [contentId],
    );
    expect(revRows[0].c).toBe(1);
  });

  it("capitalises first letter when replacement starts at beginning of sentence (offset 0 or after '. ', '! ', '? ')", async () => {
    const initialText = "hello world. another test! one more? final sentence.";
    const { contentId, reviewId } = await setupTestContent(initialText);

    // 1. Offset 0: "hello" [0, 5) -> "hi"
    const { rows: [f1] } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'hello', 0, 5, 'low', 'r1', 'hi')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    // 2. Mid-sentence: "world" [6, 11) -> "earth" (should NOT capitalize)
    const { rows: [f2] } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'world', 6, 11, 'low', 'r2', 'earth')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    // 3. After ". ": "another" [13, 20) -> "next"
    const { rows: [f3] } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'another', 13, 20, 'low', 'r3', 'next')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    // 4. After "! ": "one" [27, 30) -> "two"
    const { rows: [f4] } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'one', 27, 30, 'low', 'r4', 'two')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );
    // 5. After "? ": "final" [37, 42) -> "last"
    const { rows: [f5] } = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, review_id, kind, span_text, start_offset, end_offset, severity, reason, suggested_fix)
       VALUES ($1, $2, 'term', 'final', 37, 42, 'low', 'r5', 'last')
       RETURNING id`,
      [creatorOrgId, reviewId],
    );

    // Accept all 5 findings
    for (const fid of [f1.id, f2.id, f3.id, f4.id, f5.id]) {
      await request(app)
        .patch(`/api/findings/${fid}/resolution`)
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({ action: "accept" });
    }

    const resApply = await request(app)
      .post(`/api/contents/${contentId}/revisions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ mode: "apply_fixes" });

    expect(resApply.status).toBe(201);
    expect(resApply.body.revision.body).toBe(
      "Hi earth. Next test! Two more? Last sentence.",
    );
  });
});

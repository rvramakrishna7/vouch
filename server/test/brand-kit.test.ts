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

describe.runIf(hasDb)("Brand Kit API (rules, facts, terms)", () => {
  let creatorToken: string;
  let brandManagerToken: string;
  let northwindToken: string;
  let createdRuleId: string | undefined;
  let createdFactId: string | undefined;
  let createdTermId: string | undefined;

  beforeAll(async () => {
    // Demo login as creator
    const creatorRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator" });
    creatorToken = creatorRes.body.token;

    // Demo login as brand manager
    const bmRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "brand_manager" });
    brandManagerToken = bmRes.body.token;

    // Generate token for Northwind user
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
    if (nwRows.length > 0) {
      northwindToken = signToken({
        sub: nwRows[0].id,
        org: nwRows[0].organization_id,
        role: nwRows[0].role,
      });
    }
  });

  afterAll(async () => {
    // Clean up created entities
    if (createdRuleId) {
      await pool.query("DELETE FROM rules WHERE id = $1", [createdRuleId]);
    }
    if (createdFactId) {
      await pool.query("DELETE FROM facts WHERE id = $1", [createdFactId]);
    }
    if (createdTermId) {
      await pool.query("DELETE FROM terms WHERE id = $1", [createdTermId]);
    }
    await pool.end();
  });

  it("creator can GET rules, facts, and terms", async () => {
    const rulesRes = await request(app)
      .get("/api/rules")
      .set("Authorization", `Bearer ${creatorToken}`);
    expect(rulesRes.status).toBe(200);
    expect(Array.isArray(rulesRes.body)).toBe(true);
    expect(rulesRes.body.length).toBeGreaterThanOrEqual(10);

    const factsRes = await request(app)
      .get("/api/facts")
      .set("Authorization", `Bearer ${creatorToken}`);
    expect(factsRes.status).toBe(200);
    expect(Array.isArray(factsRes.body)).toBe(true);
    expect(factsRes.body.length).toBeGreaterThanOrEqual(8);

    const termsRes = await request(app)
      .get("/api/terms")
      .set("Authorization", `Bearer ${creatorToken}`);
    expect(termsRes.status).toBe(200);
    expect(Array.isArray(termsRes.body)).toBe(true);
    expect(termsRes.body.length).toBeGreaterThanOrEqual(9);
  });

  it("creator POST rule returns 403 forbidden", async () => {
    const res = await request(app)
      .post("/api/rules")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        category: "claims",
        severity: "high",
        text: "Creator cannot add rules",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("brand manager creates a claims rule and gets the next CLAIM-xx code", async () => {
    const res = await request(app)
      .post("/api/rules")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        category: "claims",
        severity: "high",
        text: "Automated test rule for claims numbering",
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("CLAIM-05");
    expect(res.body.version).toBe(1);
    createdRuleId = res.body.id;
  });

  it("editing rule text bumps version", async () => {
    expect(createdRuleId).toBeDefined();

    const res = await request(app)
      .patch(`/api/rules/${createdRuleId}`)
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        text: "Updated automated test rule text with version bump",
      });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it("fact F-03 has expired=true and F-12 has expired=false", async () => {
    const res = await request(app)
      .get("/api/facts")
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(200);
    const facts = res.body as Array<{
      code: string;
      expired: boolean;
      embedding?: unknown;
    }>;

    const f03 = facts.find((f) => f.code === "F-03");
    expect(f03).toBeDefined();
    expect(f03!.expired).toBe(true);
    expect(f03!.embedding).toBeUndefined();

    const f12 = facts.find((f) => f.code === "F-12");
    expect(f12).toBeDefined();
    expect(f12!.expired).toBe(false);
    expect(f12!.embedding).toBeUndefined();
  });

  it("brand manager creates a fact with code F-21 or higher", async () => {
    const res = await request(app)
      .post("/api/facts")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        statement: "Automated test fact for number generation.",
        source: "Internal test report",
        valid_until: "2027-12-31",
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("F-21");
    expect(res.body.expired).toBe(false);
    createdFactId = res.body.id;
  });

  it("brand manager creates, updates, and deletes a term", async () => {
    const createRes = await request(app)
      .post("/api/terms")
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        term: "test-banned-phrase",
        type: "banned",
        replacement: "safe-alternative",
      });

    expect(createRes.status).toBe(201);
    createdTermId = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/api/terms/${createdTermId}`)
      .set("Authorization", `Bearer ${brandManagerToken}`)
      .send({
        replacement: "updated-alternative",
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.replacement).toBe("updated-alternative");

    const deleteRes = await request(app)
      .delete(`/api/terms/${createdTermId}`)
      .set("Authorization", `Bearer ${brandManagerToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deleted).toBe(true);
    createdTermId = undefined; // already cleaned up
  });

  it("a Northwind user cannot read an Aqualeaf rule by id (returns 404)", async () => {
    expect(northwindToken).toBeDefined();
    expect(createdRuleId).toBeDefined();

    const res = await request(app)
      .get(`/api/rules/${createdRuleId}`)
      .set("Authorization", `Bearer ${northwindToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("an audit row is written on create", async () => {
    expect(createdRuleId).toBeDefined();

    const { rows } = await pool.query<{ count: number }>(
      "SELECT count(*)::int as count FROM audit_events WHERE action = 'rules.create' AND entity = $1",
      [`rule:${createdRuleId}`],
    );

    expect(rows[0].count).toBeGreaterThanOrEqual(1);
  });
});

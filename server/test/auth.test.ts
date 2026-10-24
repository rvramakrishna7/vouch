import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import pool from "../src/db/pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded if running vitest directly
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

const hasDb = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDb)("Auth routes and middleware", () => {
  afterAll(async () => {
    await pool.end();
  });

  const roles = ["brand_manager", "creator", "reviewer"] as const;

  for (const role of roles) {
    it(`demo login works for role: ${role}`, async () => {
      const res = await request(app)
        .post("/api/auth/demo")
        .send({ role });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe("string");
      expect(res.body.user.role).toBe(role);
      expect(res.body.organization.name).toBe("Aqualeaf");

      // Verify /me with that token returns the right role and org name "Aqualeaf"
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${res.body.token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.role).toBe(role);
      expect(meRes.body.organization.name).toBe("Aqualeaf");
    });
  }

  it("login with wrong password returns 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "demo.brand@aqualeaf.test", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("login with non-existent email returns 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nonexistent@aqualeaf.test", password: "password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("/me without token returns 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("demo returns 404 when DEMO_LOGIN_ENABLED is 'false'", async () => {
    const original = process.env.DEMO_LOGIN_ENABLED;
    try {
      process.env.DEMO_LOGIN_ENABLED = "false";
      const res = await request(app)
        .post("/api/auth/demo")
        .send({ role: "creator" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    } finally {
      process.env.DEMO_LOGIN_ENABLED = original;
    }
  });

  it("a test-only route behind requireRole('reviewer') returns 403 for a creator token", async () => {
    const loginRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator" });
    expect(loginRes.status).toBe(200);
    const creatorToken = loginRes.body.token;

    const res = await request(app)
      .get("/api/auth/test-role-reviewer")
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");

    // Also verify that a reviewer token returns 200
    const reviewerLogin = await request(app)
      .post("/api/auth/demo")
      .send({ role: "reviewer" });
    const reviewerToken = reviewerLogin.body.token;

    const reviewerRes = await request(app)
      .get("/api/auth/test-role-reviewer")
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect(reviewerRes.status).toBe(200);
    expect(reviewerRes.body.ok).toBe(true);
  });

  it("one audit_events row is added after a demo login", async () => {
    const { rows: [{ count: beforeCount }] } = await pool.query<{ count: number }>(
      "SELECT count(*)::int as count FROM audit_events WHERE action = 'auth.demo_login'",
    );

    const res = await request(app)
      .post("/api/auth/demo")
      .send({ role: "reviewer" });
    expect(res.status).toBe(200);

    const { rows: [{ count: afterCount }] } = await pool.query<{ count: number }>(
      "SELECT count(*)::int as count FROM audit_events WHERE action = 'auth.demo_login'",
    );

    expect(afterCount).toBe(beforeCount + 1);
  });

  it("demo login with org: 'northwind-labs' logs in as Northwind user", async () => {
    const res = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator", org: "northwind-labs" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe("creator");
    expect(res.body.organization.name).toBe("Northwind Labs");
  });

  it("demo login with unknown org returns 400 invalid_input", async () => {
    const res = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator", org: "unknown-org-slug" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });
});

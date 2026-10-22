import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Document, Packer, Paragraph, TextRun } from "docx";
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

describe.runIf(hasDb)("Contents API (submission, revisions, isolation)", () => {
  let creatorToken: string;
  let reviewerToken: string;
  let northwindToken: string;
  let createdContentId: string | undefined;

  beforeAll(async () => {
    // Demo login as creator (Arjun)
    const creatorRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "creator" });
    creatorToken = creatorRes.body.token;

    // Demo login as reviewer (Meera)
    const reviewerRes = await request(app)
      .post("/api/auth/demo")
      .send({ role: "reviewer" });
    reviewerToken = reviewerRes.body.token;

    // Northwind user token
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
    if (createdContentId) {
      // Revisions are deleted via ON DELETE CASCADE on contents(id)
      await pool.query("DELETE FROM contents WHERE id = $1", [createdContentId]);
    }
    await pool.end();
  });

  it("extract returns text for .docx and 415 for .txt", async () => {
    // Generate a minimal .docx in memory
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun("Hello Vouch Docx Extract Test Content")],
            }),
          ],
        },
      ],
    });
    const docxBuffer = await Packer.toBuffer(doc);

    // POST .docx as creator -> 200
    const extractRes = await request(app)
      .post("/api/contents/extract")
      .set("Authorization", `Bearer ${creatorToken}`)
      .attach("file", docxBuffer, "sample.docx");

    expect(extractRes.status).toBe(200);
    expect(extractRes.body.text).toContain("Hello Vouch Docx Extract Test Content");
    expect(extractRes.body.characters).toBeGreaterThan(0);

    // POST .txt as creator -> 415
    const txtBuffer = Buffer.from("Plain text content");
    const txtRes = await request(app)
      .post("/api/contents/extract")
      .set("Authorization", `Bearer ${creatorToken}`)
      .attach("file", txtBuffer, "sample.txt");

    expect(txtRes.status).toBe(415);
    expect(txtRes.body.error).toBe("unsupported_type");
    expect(txtRes.body.accepted).toEqual([".docx"]);

    // POST without file -> 400
    const emptyRes = await request(app)
      .post("/api/contents/extract")
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.error).toBe("invalid_input");
  });

  it("reviewer cannot extract or create content (403)", async () => {
    // Reviewer trying to extract
    const txtBuffer = Buffer.from("dummy");
    const extractRes = await request(app)
      .post("/api/contents/extract")
      .set("Authorization", `Bearer ${reviewerToken}`)
      .attach("file", txtBuffer, "sample.docx");

    expect(extractRes.status).toBe(403);
    expect(extractRes.body.error).toBe("forbidden");

    // Reviewer trying to create content
    const createRes = await request(app)
      .post("/api/contents")
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        title: "Unauthorized Reviewer Post",
        purpose: "Should fail with 403",
        audience: "General audience",
        channel: "Instagram",
        body: "This should not be allowed.",
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error).toBe("forbidden");
  });

  it("creator creates content -> draft + revision 1", async () => {
    const payload = {
      title: "Flow Bottle Social Campaign",
      purpose: "Highlight durability and lightness of the bottle",
      audience: "Urban professionals aged 22-35",
      channel: "Instagram",
      body: "India's No.1 eco-friendly water bottle, now 40% lighter. Made with 70% recycled steel. #StayHydrated",
    };

    const res = await request(app)
      .post("/api/contents")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.content).toBeDefined();
    expect(res.body.content.id).toBeDefined();
    expect(res.body.content.title).toBe(payload.title);
    expect(res.body.content.purpose).toBe(payload.purpose);
    expect(res.body.content.audience).toBe(payload.audience);
    expect(res.body.content.channel).toBe(payload.channel);
    expect(res.body.content.status).toBe("draft");

    expect(res.body.revision).toBeDefined();
    expect(res.body.revision.content_id).toBe(res.body.content.id);
    expect(res.body.revision.n).toBe(1);
    expect(res.body.revision.body).toBe(payload.body);

    createdContentId = res.body.content.id;
  });

  it("creator lists only own contents; reviewer sees seeded Aqualeaf draft", async () => {
    // Creator lists contents
    const creatorListRes = await request(app)
      .get("/api/contents")
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(creatorListRes.status).toBe(200);
    expect(Array.isArray(creatorListRes.body)).toBe(true);
    expect(creatorListRes.body.length).toBeGreaterThanOrEqual(1);

    const createdItem = creatorListRes.body.find(
      (c: { id: string }) => c.id === createdContentId,
    );
    expect(createdItem).toBeDefined();
    expect(createdItem.title).toBe("Flow Bottle Social Campaign");
    expect(createdItem.channel).toBe("Instagram");
    expect(createdItem.status).toBe("draft");
    expect(createdItem.latest_revision_number).toBe(1);
    expect(createdItem.created_by_name).toBeTruthy();

    // Reviewer lists contents - sees seeded Aqualeaf draft and newly created content
    const reviewerListRes = await request(app)
      .get("/api/contents")
      .set("Authorization", `Bearer ${reviewerToken}`);

    expect(reviewerListRes.status).toBe(200);
    expect(Array.isArray(reviewerListRes.body)).toBe(true);
    expect(reviewerListRes.body.length).toBeGreaterThanOrEqual(2);

    const seededDraft = reviewerListRes.body.find(
      (c: { title: string }) => c.title === "Instagram caption: Flow launch",
    );
    expect(seededDraft).toBeDefined();
    expect(seededDraft.channel).toBe("Instagram");
    expect(seededDraft.status).toBe("draft");

    const createdDraftForReviewer = reviewerListRes.body.find(
      (c: { id: string }) => c.id === createdContentId,
    );
    expect(createdDraftForReviewer).toBeDefined();
  });

  it("GET /api/contents/:id returns content + all revisions newest first", async () => {
    const res = await request(app)
      .get(`/api/contents/${createdContentId}`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdContentId);
    expect(res.body.title).toBe("Flow Bottle Social Campaign");
    expect(res.body.revisions).toBeDefined();
    expect(Array.isArray(res.body.revisions)).toBe(true);
    expect(res.body.revisions.length).toBe(1);
    expect(res.body.revisions[0].n).toBe(1);
    expect(res.body.revisions[0].body).toContain("eco-friendly water bottle");
    expect(res.body.revisions[0].created_by_name).toBeTruthy();
  });

  it("Northwind user gets 404 for Aqualeaf content (TEST-011 tenant isolation)", async () => {
    // Northwind user tries to GET Aqualeaf created content
    const res = await request(app)
      .get(`/api/contents/${createdContentId}`)
      .set("Authorization", `Bearer ${northwindToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");

    // Northwind user lists contents; should not include Aqualeaf content
    const listRes = await request(app)
      .get("/api/contents")
      .set("Authorization", `Bearer ${northwindToken}`);

    expect(listRes.status).toBe(200);
    const aqualeafInNorthwind = listRes.body.find(
      (c: { id: string }) => c.id === createdContentId,
    );
    expect(aqualeafInNorthwind).toBeUndefined();
  });

  it("returns 400 for invalid inputs on POST /api/contents", async () => {
    // Missing title
    const res1 = await request(app)
      .post("/api/contents")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        purpose: "Testing invalid",
        audience: "Audience",
        channel: "Instagram",
        body: "Body text",
      });

    expect(res1.status).toBe(400);
    expect(res1.body.error).toBe("invalid_input");

    // Invalid channel
    const res2 = await request(app)
      .post("/api/contents")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        title: "Invalid Channel Post",
        purpose: "Testing invalid",
        audience: "Audience",
        channel: "NotAChannel",
        body: "Body text",
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toBe("invalid_input");
  });
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";

describe("GET /api/health", () => {
  it("returns ok status, service name and ISO time", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("vouch-server");
    expect(new Date(res.body.time).toISOString()).toBe(res.body.time);
  });
});

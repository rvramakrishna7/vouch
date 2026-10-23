import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
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

describe.runIf(hasDb)("Database schema and invariants", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("has applied migrations including 001_init.sql", async () => {
    const { rows } = await pool.query(
      "SELECT name FROM schema_migrations WHERE name = '001_init.sql'",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("001_init.sql");
  });

  it("seed counts match demo-brand.md", async () => {
    const { rows: orgs } = await pool.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM organizations WHERE slug IN ('aqualeaf', 'northwind-labs') ORDER BY slug",
    );
    expect(orgs.length).toBe(2);
    const aqualeaf = orgs.find((o) => o.slug === "aqualeaf");
    const northwind = orgs.find((o) => o.slug === "northwind-labs");
    expect(aqualeaf).toBeDefined();
    expect(northwind).toBeDefined();

    if (!aqualeaf || !northwind) return;

    // Aqualeaf checks: 3 users, 10 rules, 8 facts, 9 terms, 1 content, 1 revision
    const { rows: [aqUsers] } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM users WHERE organization_id = $1",
      [aqualeaf.id],
    );
    expect(aqUsers.c).toBe(3);

    // Assert all 10 seed rules from docs/demo-brand.md exist
    const { rows: ruleRows } = await pool.query<{ code: string }>(
      "SELECT code FROM rules WHERE organization_id = $1",
      [aqualeaf.id],
    );
    const existingRuleCodes = new Set(ruleRows.map((r) => r.code));
    const SEED_RULE_CODES = [
      "CLAIM-01", "CLAIM-02", "CLAIM-03", "CLAIM-04",
      "TONE-01", "TONE-02",
      "TERM-01", "TERM-02",
      "ACC-01", "ACC-02",
    ];
    for (const code of SEED_RULE_CODES) {
      expect(existingRuleCodes.has(code), `Expected seed rule ${code} to exist`).toBe(true);
    }

    // Assert all 8 seed facts from docs/demo-brand.md exist
    const { rows: factRows } = await pool.query<{ code: string }>(
      "SELECT code FROM facts WHERE organization_id = $1",
      [aqualeaf.id],
    );
    const existingFactCodes = new Set(factRows.map((f) => f.code));
    const SEED_FACT_CODES = ["F-01", "F-07", "F-12", "F-15", "F-18", "F-20", "F-03", "F-09"];
    for (const code of SEED_FACT_CODES) {
      expect(existingFactCodes.has(code), `Expected seed fact ${code} to exist`).toBe(true);
    }

    // Assert all 9 seed terms from docs/demo-brand.md exist
    const { rows: termRows } = await pool.query<{ term: string }>(
      "SELECT term FROM terms WHERE organization_id = $1",
      [aqualeaf.id],
    );
    const existingTerms = new Set(termRows.map((t) => t.term));
    const SEED_TERMS = [
      "No.1", "best in India", "100% natural", "guaranteed", "chemical-free",
      "eco-friendly", "sustainable", "metal flask", "Aqualeaf",
    ];
    for (const term of SEED_TERMS) {
      expect(existingTerms.has(term), `Expected seed term ${term} to exist`).toBe(true);
    }

    const { rows: [aqContents] } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM contents WHERE organization_id = $1 AND title = 'Instagram caption: Flow launch'",
      [aqualeaf.id],
    );
    expect(aqContents.c).toBeGreaterThanOrEqual(1);

    const { rows: [aqRevisions] } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM revisions r JOIN contents c ON c.id = r.content_id WHERE c.organization_id = $1 AND c.title = 'Instagram caption: Flow launch'",
      [aqualeaf.id],
    );
    expect(aqRevisions.c).toBeGreaterThanOrEqual(1);

    // Northwind checks: 1 user, 1 content, 1 revision
    const { rows: [nwUsers] } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM users WHERE organization_id = $1",
      [northwind.id],
    );
    expect(nwUsers.c).toBe(1);

    const { rows: [nwContents] } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM contents WHERE organization_id = $1",
      [northwind.id],
    );
    expect(nwContents.c).toBe(1);

    const { rows: [nwRevisions] } = await pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM revisions WHERE organization_id = $1",
      [northwind.id],
    );
    expect(nwRevisions.c).toBe(1);
  });

  it("invariant 7: UPDATE on audit_events fails", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM audit_events LIMIT 1",
    );
    expect(rows.length).toBeGreaterThan(0);
    const id = rows[0].id;

    await expect(
      pool.query("UPDATE audit_events SET action = 'tampered' WHERE id = $1", [id]),
    ).rejects.toThrow(/append-only: UPDATE is not permitted/i);
  });

  it("invariant 7: DELETE on audit_events fails without the setting", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM audit_events LIMIT 1",
    );
    expect(rows.length).toBeGreaterThan(0);
    const id = rows[0].id;

    await expect(
      pool.query("DELETE FROM audit_events WHERE id = $1", [id]),
    ).rejects.toThrow(/append-only: DELETE is not permitted/i);
  });

  it("duplicate fact code in one org fails", async () => {
    const { rows: [org] } = await pool.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'aqualeaf'",
    );
    await expect(
      pool.query(
        `INSERT INTO facts (organization_id, code, statement, source, valid_until)
         VALUES ($1, 'F-01', 'Duplicate fact statement', 'Source', '2027-01-01')`,
        [org.id],
      ),
    ).rejects.toThrow(/uq_facts_org_code|duplicate key/i);
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attempt to load .env if DATABASE_URL is not set
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 10000,
});

async function runSeed() {
  await client.connect();

  try {
    await client.query("BEGIN");

    // Allow audit events purge for seed idempotency
    await client.query("SET LOCAL vouch.allow_audit_purge = 'on';");

    // 1. Purge existing seed orgs
    await client.query(
      "DELETE FROM organizations WHERE slug IN ('aqualeaf', 'northwind-labs')",
    );

    // 2. Insert Org 1: Aqualeaf
    const { rows: [aqualeaf] } = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Aqualeaf', 'aqualeaf')
       RETURNING id`,
    );
    const aqualeafId = aqualeaf.id;

    // Helper to generate password hash
    const hashPassword = () => {
      const randomPassword = crypto.randomBytes(16).toString("hex");
      return bcrypt.hashSync(randomPassword, 10);
    };

    // Users for Aqualeaf
    const { rows: [priya] } = await client.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, password_hash, role)
       VALUES ($1, 'Priya Sharma', 'demo.brand@aqualeaf.test', $2, 'brand_manager')
       RETURNING id`,
      [aqualeafId, hashPassword()],
    );

    const { rows: [arjun] } = await client.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, password_hash, role)
       VALUES ($1, 'Arjun Mehta', 'demo.creator@aqualeaf.test', $2, 'creator')
       RETURNING id`,
      [aqualeafId, hashPassword()],
    );

    const { rows: [neha] } = await client.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, password_hash, role)
       VALUES ($1, 'Neha Iyer', 'demo.reviewer@aqualeaf.test', $2, 'reviewer')
       RETURNING id`,
      [aqualeafId, hashPassword()],
    );

    // Rules for Aqualeaf (10 rules)
    const rules = [
      {
        code: "CLAIM-01",
        category: "claims",
        severity: "high",
        text: `No superlatives or rankings ("No.1", "best", "India's leading") unless backed by an approved ranking fact. (Based on ASCI Code, Chapter I.)`,
      },
      {
        code: "CLAIM-02",
        category: "claims",
        severity: "high",
        text: `Environmental claims ("eco-friendly", "sustainable", "green") must name the specific attribute and be backed by an approved fact or accreditation. (Based on ASCI green-claims guidelines, 2024.)`,
      },
      {
        code: "CLAIM-03",
        category: "claims",
        severity: "high",
        text: `Every number, percentage or duration must match an approved, in-date fact.`,
      },
      {
        code: "CLAIM-04",
        category: "claims",
        severity: "high",
        text: `No health or medical benefit claims.`,
      },
      {
        code: "TONE-01",
        category: "tone",
        severity: "medium",
        text: `Friendly, confident and plain. No fear-based or shaming language.`,
      },
      {
        code: "TONE-02",
        category: "tone",
        severity: "low",
        text: `Speak to the reader as "you", in active voice. No ALL CAPS words; at most one exclamation mark per piece.`,
      },
      {
        code: "TERM-01",
        category: "terminology",
        severity: "medium",
        text: `The brand name is always "Aqualeaf" (never "AquaLeaf" or "Aqua Leaf").`,
      },
      {
        code: "TERM-02",
        category: "terminology",
        severity: "low",
        text: `Say "steel bottle", not "metal flask".`,
      },
      {
        code: "ACC-01",
        category: "accessibility",
        severity: "medium",
        text: `Sentences of 25 words or fewer; plain words a general audience understands.`,
      },
      {
        code: "ACC-02",
        category: "accessibility",
        severity: "low",
        text: `Multi-word hashtags use CamelCase (#StayHydrated) so screen readers read them correctly.`,
      },
    ];

    for (const rule of rules) {
      await client.query(
        `INSERT INTO rules (organization_id, code, category, severity, text)
         VALUES ($1, $2, $3, $4, $5)`,
        [aqualeafId, rule.code, rule.category, rule.severity, rule.text],
      );
    }

    // Query inserted rules for Aqualeaf to map rule_code -> rule_id
    const { rows: aqRules } = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM rules WHERE organization_id = $1",
      [aqualeafId],
    );
    const ruleCodeToId = new Map(aqRules.map((r) => [r.code, r.id]));

    // Facts for Aqualeaf (8 facts)
    const facts = [
      {
        code: "F-01",
        statement: "Aqualeaf bottles are made from food-grade 304 stainless steel.",
        source: "Supplier material certificate",
        valid_until: "2027-06-30",
      },
      {
        code: "F-07",
        statement: "The Aqualeaf Flow bottle is made from 70% recycled stainless steel.",
        source: "Recycled-content audit report",
        valid_until: "2027-03-31",
      },
      {
        code: "F-12",
        statement: "The Aqualeaf Flow (2026) is 40% lighter than the previous Aqualeaf Classic.",
        source: "In-house lab weight test",
        valid_until: "2027-03-31",
      },
      {
        code: "F-15",
        statement: "Aqualeaf Flow keeps drinks cold for 24 hours and hot for 12 hours.",
        source: "Lab temperature test",
        valid_until: "2027-01-31",
      },
      {
        code: "F-18",
        statement: "Aqualeaf has served over 2 lakh customers in India.",
        source: "Order database export",
        valid_until: "2026-12-31",
      },
      {
        code: "F-20",
        statement: "The Aqualeaf Flow lid is BPA-free.",
        source: "Lid supplier certificate",
        valid_until: "2027-06-30",
      },
      {
        code: "F-03",
        statement: "Aqualeaf is rated 4.8 out of 5 by customers on aqualeaf.example.",
        source: "Review dashboard snapshot",
        valid_until: "2026-06-30",
      },
      {
        code: "F-09",
        statement: "Aqualeaf gives 10% of profits to river clean-up projects.",
        source: "Partnership letter",
        valid_until: "2026-03-31",
      },
    ];

    for (const fact of facts) {
      await client.query(
        `INSERT INTO facts (organization_id, code, statement, source, valid_until)
         VALUES ($1, $2, $3, $4, $5)`,
        [aqualeafId, fact.code, fact.statement, fact.source, fact.valid_until],
      );
    }

    // Terms for Aqualeaf (9 terms) matching docs/demo-brand.md exactly
    const terms: Array<{
      term: string;
      type: "preferred" | "banned" | "regulated";
      rule_code: string | null;
      replacement: string | null;
      note: string | null;
    }> = [
      {
        term: "No.1",
        type: "banned",
        rule_code: "CLAIM-01",
        replacement: null,
        note: "Remove, or cite an approved ranking fact",
      },
      {
        term: "best in India",
        type: "banned",
        rule_code: "CLAIM-01",
        replacement: null,
        note: "Remove; superlatives need a ranking fact",
      },
      {
        term: "100% natural",
        type: "banned",
        rule_code: "CLAIM-02",
        replacement: null,
        note: "Not applicable to steel products",
      },
      {
        term: "guaranteed",
        type: "banned",
        rule_code: "CLAIM-03",
        replacement: "tested",
        note: "Avoid absolute promises",
      },
      {
        term: "chemical-free",
        type: "banned",
        rule_code: "CLAIM-02",
        replacement: "BPA-free lid",
        note: "Name the specific attribute (F-20)",
      },
      {
        term: "eco-friendly",
        type: "regulated",
        rule_code: "CLAIM-02",
        replacement: null,
        note: "Allowed only with a specific supporting fact",
      },
      {
        term: "sustainable",
        type: "regulated",
        rule_code: "CLAIM-02",
        replacement: null,
        note: "Allowed only with a specific supporting fact",
      },
      {
        term: "metal flask",
        type: "banned",
        rule_code: "TERM-02",
        replacement: "steel bottle",
        note: "Use the brand's product term",
      },
      {
        term: "Aqualeaf",
        type: "preferred",
        rule_code: "TERM-01",
        replacement: "Aqualeaf",
        note: 'Exact spelling; flag variants like "AquaLeaf" or "Aqua Leaf"',
      },
    ];

    for (const term of terms) {
      const ruleId = term.rule_code ? ruleCodeToId.get(term.rule_code) ?? null : null;
      await client.query(
        `INSERT INTO terms (organization_id, term, type, replacement, rule_id, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [aqualeafId, term.term, term.type, term.replacement, ruleId, term.note],
      );
    }

    // Draft content for Aqualeaf
    const { rows: [content] } = await client.query<{ id: string }>(
      `INSERT INTO contents (organization_id, title, purpose, audience, channel, status, created_by)
       VALUES ($1, 'Instagram caption: Flow launch',
               'Highlight sustainability and lightness of the new bottle',
               'Urban buyers aged 22 to 35',
               'Instagram',
               'draft',
               $2)
       RETURNING id`,
      [aqualeafId, arjun.id],
    );

    // Revision 1 for Aqualeaf draft
    await client.query(
      `INSERT INTO revisions (organization_id, content_id, n, body, created_by)
       VALUES ($1, $2, 1,
               $3,
               $4)`,
      [
        aqualeafId,
        content.id,
        "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated",
        arjun.id,
      ],
    );

    // Audit event for Aqualeaf
    await client.query(
      `INSERT INTO audit_events (organization_id, actor, action, entity, payload)
       VALUES ($1, 'system:seed', 'seed:init', 'organization:aqualeaf', $2)`,
      [aqualeafId, JSON.stringify({ message: "Aqualeaf demo brand seeded" })],
    );

    // 3. Insert Org 2: Northwind Labs
    const { rows: [northwind] } = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Northwind Labs', 'northwind-labs')
       RETURNING id`,
    );
    const northwindId = northwind.id;

    const { rows: [kabir] } = await client.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, password_hash, role)
       VALUES ($1, 'Kabir Rao', 'creator@northwind.test', $2, 'creator')
       RETURNING id`,
      [northwindId, hashPassword()],
    );

    const { rows: [northwindContent] } = await client.query<{ id: string }>(
      `INSERT INTO contents (organization_id, title, purpose, audience, channel, status, created_by)
       VALUES ($1, 'Northwind newsletter intro', 'Team introduction', 'Developers', 'Email', 'draft', $2)
       RETURNING id`,
      [northwindId, kabir.id],
    );

    await client.query(
      `INSERT INTO revisions (organization_id, content_id, n, body, created_by)
       VALUES ($1, $2, 1, 'Northwind Labs builds tools for teams.', $3)`,
      [northwindId, northwindContent.id, kabir.id],
    );

    // Audit event for Northwind Labs
    await client.query(
      `INSERT INTO audit_events (organization_id, actor, action, entity, payload)
       VALUES ($1, 'system:seed', 'seed:init', 'organization:northwind-labs', $2)`,
      [northwindId, JSON.stringify({ message: "Northwind Labs demo brand seeded" })],
    );

    await client.query("COMMIT");
    console.log("Successfully seeded demo brand data for Aqualeaf and Northwind Labs.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seeding failed:", err);
    throw err;
  } finally {
    await client.end();
  }
}

runSeed().catch((err) => {
  console.error("Seed execution failed:", err);
  process.exit(1);
});

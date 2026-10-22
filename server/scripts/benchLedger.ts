import pool from "../src/db/pool.js";
import { runClaimLedger } from "../src/ledger/pipeline.js";

interface BenchConfig {
  name: string;
  label: string;
  env: Record<string, string | undefined>;
}

const configs: BenchConfig[] = [
  {
    name: "A",
    label: "gemini-3.5-flash (thinkingLevel: MINIMAL)",
    env: {
      PRIMARY_AI_PROVIDER: "gemini",
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_THINKING: "MINIMAL",
      GROQ_REASONING_EFFORT: undefined,
    },
  },
  {
    name: "B",
    label: "gemini-3.5-flash-lite (thinkingLevel: MINIMAL)",
    env: {
      PRIMARY_AI_PROVIDER: "gemini",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
      GEMINI_THINKING: "MINIMAL",
      GROQ_REASONING_EFFORT: undefined,
    },
  },
  {
    name: "C",
    label: "Groq openai/gpt-oss-120b (reasoning_effort: low)",
    env: {
      PRIMARY_AI_PROVIDER: "groq",
      GROQ_MODEL: "openai/gpt-oss-120b",
      GROQ_REASONING_EFFORT: "low",
      GEMINI_THINKING: undefined,
    },
  },
  {
    name: "D",
    label: "Groq qwen/qwen3.8-27b (documented equivalent in JSON mode)",
    env: {
      PRIMARY_AI_PROVIDER: "groq",
      GROQ_MODEL: "qwen/qwen3.8-27b",
      GROQ_REASONING_EFFORT: undefined,
      GEMINI_THINKING: undefined,
    },
  },
  {
    name: "E",
    label: "gemini-3.5-flash baseline (no thinking setting)",
    env: {
      PRIMARY_AI_PROVIDER: "gemini",
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_THINKING: undefined,
      GROQ_REASONING_EFFORT: undefined,
    },
  },
];

function evaluateFindings(findings: any[]): { count: number; details: string[] } {
  let count = 0;
  const details: string[] = [];

  // 1. India's No.1 unsupported CLAIM-01
  const c1 = findings.find(
    (f) =>
      f.kind === "claim" &&
      f.span_text.includes("No.1") &&
      f.verdict === "unsupported" &&
      f.rule_code === "CLAIM-01",
  );
  if (c1) {
    count++;
    details.push("No.1: OK");
  } else {
    details.push("No.1: MISMATCH");
  }

  // 2. eco-friendly unsupported CLAIM-02
  const c2 = findings.find(
    (f) =>
      f.kind === "claim" &&
      f.span_text.includes("eco-friendly") &&
      f.verdict === "unsupported" &&
      f.rule_code === "CLAIM-02",
  );
  if (c2) {
    count++;
    details.push("eco-friendly: OK");
  } else {
    details.push("eco-friendly: MISMATCH");
  }

  // 3. 40% lighter supported F-12
  const c3 = findings.find(
    (f) =>
      f.kind === "claim" &&
      f.span_text.includes("40%") &&
      f.verdict === "supported" &&
      f.fact_code === "F-12",
  );
  if (c3) {
    count++;
    details.push("40% lighter: OK");
  } else {
    details.push("40% lighter: MISMATCH");
  }

  // 4. Rated 4.8 outdated F-03 (+ CLAIM-03)
  const c4 = findings.find(
    (f) =>
      f.kind === "claim" &&
      f.span_text.includes("4.8") &&
      f.verdict === "outdated" &&
      f.fact_code === "F-03",
  );
  if (c4) {
    count++;
    details.push("Rated 4.8: OK");
  } else {
    details.push("Rated 4.8: MISMATCH");
  }

  // 5. cold for 48 hours contradicted F-15 (+ CLAIM-03)
  const c5 = findings.find(
    (f) =>
      f.kind === "claim" &&
      (f.span_text.includes("cold") || f.span_text.includes("48")) &&
      f.verdict === "contradicted" &&
      f.fact_code === "F-15",
  );
  if (c5) {
    count++;
    details.push("cold 48h: OK");
  } else {
    details.push("cold 48h: MISMATCH");
  }

  return { count, details };
}

async function main() {
  console.log("=== Claim Ledger AI Latency & Accuracy Benchmark (S8a.1) ===");

  // Fetch Aqualeaf organization and seeded draft content
  const { rows: orgRows } = await pool.query<{ id: string }>(
    "SELECT id FROM organizations WHERE name = 'Aqualeaf' LIMIT 1",
  );
  const organizationId = orgRows[0].id;

  const { rows: contentRows } = await pool.query<{
    id: string;
    purpose: string;
    audience: string;
    channel: string;
    body: string;
  }>(
    `SELECT c.id, c.purpose, c.audience, c.channel, r.body
     FROM contents c
     JOIN revisions r ON r.content_id = c.id
     WHERE c.organization_id = $1 AND c.title = 'Instagram caption: Flow launch'
     ORDER BY r.n DESC
     LIMIT 1`,
    [organizationId],
  );

  const draft = contentRows[0];
  console.log(`Target Content: "${draft.body}"\n`);

  interface BenchResult {
    configName: string;
    label: string;
    latencies: number[];
    scores: number[];
  }

  const results: BenchResult[] = [];

  for (const cfg of configs) {
    console.log(`--- Running Config ${cfg.name}: ${cfg.label} ---`);
    const latencies: number[] = [];
    const scores: number[] = [];

    // Apply config env vars
    for (const [k, v] of Object.entries(cfg.env)) {
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }

    for (let run = 1; run <= 3; run++) {
      process.stdout.write(`  Run ${run}/3... `);
      const start = performance.now();
      try {
        const res = await runClaimLedger({
          organizationId,
          body: draft.body,
          purpose: draft.purpose,
          audience: draft.audience,
          channel: draft.channel,
          pool,
        });

        const totalSec = (res.aiLatencyMs || Math.round(performance.now() - start)) / 1000;
        const evalRes = evaluateFindings(res.findings);
        latencies.push(totalSec);
        scores.push(evalRes.count);

        console.log(
          `${totalSec.toFixed(2)}s | ${evalRes.count}/5 correct [${evalRes.details.join(", ")}] (provider=${res.aiProvider})`,
        );
      } catch (err: any) {
        latencies.push(999);
        scores.push(0);
        console.log(`FAILED: ${err.message}`);
      }
    }

    results.push({
      configName: cfg.name,
      label: cfg.label,
      latencies,
      scores,
    });
    console.log();
  }

  await pool.end();

  console.log("=== BENCHMARK SUMMARY TABLE ===");
  console.log("| Config | Description | Run 1 (s) | Run 2 (s) | Run 3 (s) | Verdicts (Run 1/2/3) | All 5/5? |");
  console.log("|---|---|---|---|---|---|---|");

  for (const r of results) {
    const lStr = r.latencies.map((l) => (l === 999 ? "ERR" : `${l.toFixed(2)}s`));
    const sStr = r.scores.map((s) => `${s}/5`).join(" / ");
    const all5 = r.scores.every((s) => s === 5) ? "**YES**" : "NO";
    console.log(
      `| **${r.configName}** | ${r.label} | ${lStr[0]} | ${lStr[1]} | ${lStr[2]} | ${sStr} | ${all5} |`,
    );
  }
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});

import pool from "../src/db/pool.js";
import { runClaimLedger } from "../src/ledger/pipeline.js";

interface ExpectedRow {
  name: string;
  expectedVerdict: string;
  expectedCites: string;
  matcher: (findings: any[]) => {
    matched: boolean;
    actualQuote: string;
    actualVerdict: string;
    actualFact: string;
    actualRule: string;
  };
}

const expectedRows: ExpectedRow[] = [
  {
    name: "India's No.1",
    expectedVerdict: "unsupported",
    expectedCites: "CLAIM-01",
    matcher: (findings) => {
      const f = findings.find(
        (x) => x.kind === "claim" && (x.span_text.includes("No.1") || x.span_text.includes("India")),
      );
      if (!f) {
        return { matched: false, actualQuote: "NONE", actualVerdict: "NONE", actualFact: "NONE", actualRule: "NONE" };
      }
      const matched = f.verdict === "unsupported" && f.rule_code === "CLAIM-01";
      return {
        matched,
        actualQuote: f.span_text,
        actualVerdict: f.verdict,
        actualFact: f.fact_code || "none",
        actualRule: f.rule_code || "none",
      };
    },
  },
  {
    name: "eco-friendly",
    expectedVerdict: "unsupported OR needs_human_judgement (never supported)",
    expectedCites: "CLAIM-02 / regulated term guard",
    matcher: (findings) => {
      const f = findings.find((x) => x.kind === "claim" && x.span_text.includes("eco-friendly"));
      if (!f) {
        return { matched: false, actualQuote: "NONE", actualVerdict: "NONE", actualFact: "NONE", actualRule: "NONE" };
      }
      // Never supported; acceptable is unsupported (with CLAIM-02) or needs_human_judgement
      const isAcceptable = f.verdict === "unsupported" || f.verdict === "needs_human_judgement";
      const isNeverSupported = f.verdict !== "supported";
      const matched = isAcceptable && isNeverSupported;
      return {
        matched,
        actualQuote: f.span_text,
        actualVerdict: f.verdict,
        actualFact: f.fact_code || "none",
        actualRule: f.rule_code || "none",
      };
    },
  },
  {
    name: "40% lighter",
    expectedVerdict: "supported",
    expectedCites: "F-12",
    matcher: (findings) => {
      const f = findings.find((x) => x.kind === "claim" && x.span_text.includes("40%"));
      if (!f) {
        return { matched: false, actualQuote: "NONE", actualVerdict: "NONE", actualFact: "NONE", actualRule: "NONE" };
      }
      const matched = f.verdict === "supported" && f.fact_code === "F-12";
      return {
        matched,
        actualQuote: f.span_text,
        actualVerdict: f.verdict,
        actualFact: f.fact_code || "none",
        actualRule: f.rule_code || "none",
      };
    },
  },
  {
    name: "Rated 4.8",
    expectedVerdict: "outdated",
    expectedCites: "F-03 (+ CLAIM-03)",
    matcher: (findings) => {
      const f = findings.find((x) => x.kind === "claim" && x.span_text.includes("4.8"));
      if (!f) {
        return { matched: false, actualQuote: "NONE", actualVerdict: "NONE", actualFact: "NONE", actualRule: "NONE" };
      }
      const matched = f.verdict === "outdated" && f.fact_code === "F-03";
      return {
        matched,
        actualQuote: f.span_text,
        actualVerdict: f.verdict,
        actualFact: f.fact_code || "none",
        actualRule: f.rule_code || "none",
      };
    },
  },
  {
    name: "cold for 48 hours",
    expectedVerdict: "contradicted",
    expectedCites: "F-15 (+ CLAIM-03)",
    matcher: (findings) => {
      const f = findings.find(
        (x) => x.kind === "claim" && (x.span_text.includes("cold") || x.span_text.includes("48")),
      );
      if (!f) {
        return { matched: false, actualQuote: "NONE", actualVerdict: "NONE", actualFact: "NONE", actualRule: "NONE" };
      }
      const matched = f.verdict === "contradicted" && f.fact_code === "F-15";
      return {
        matched,
        actualQuote: f.span_text,
        actualVerdict: f.verdict,
        actualFact: f.fact_code || "none",
        actualRule: f.rule_code || "none",
      };
    },
  },
];

async function main() {
  const timeoutTimer = setTimeout(() => {
    console.error("TIMEOUT");
    process.exit(1);
  }, 300000);

  console.log("=== Claim Ledger 10-Run Benchmark (S8a.2 Owner Decision) ===");
  console.log("Configuration: Groq primary (openai/gpt-oss-120b, temp=0), Gemini fallback (8000ms timeout)\n");

  delete process.env.PRIMARY_AI_PROVIDER;
  delete process.env.AI_FORCE_FAIL;

  const rowMatchCounts: Record<string, number> = {};
  for (const row of expectedRows) {
    rowMatchCounts[row.name] = 0;
  }

  try {
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
    console.log(`Content Body: "${draft.body}"\n`);

    const numRuns = 10;
    const runSummaries: { run: number; latencySec: number; provider: string; model: string; score: number; status: string }[] = [];
    let evaluatedRuns = 0;

    for (let run = 1; run <= numRuns; run++) {
      console.log(`### Run ${run}/${numRuns}`);
      const start = performance.now();
      const res = await runClaimLedger({
        organizationId,
        body: draft.body,
        purpose: draft.purpose,
        audience: draft.audience,
        channel: draft.channel,
        pool,
      });
      const totalSec = (res.aiLatencyMs || Math.round(performance.now() - start)) / 1000;

      if (res.aiStatus === "unavailable") {
        console.log(`Result: UNAVAILABLE (provider outage) [latency=${totalSec.toFixed(2)}s]\n`);
        runSummaries.push({
          run,
          latencySec: totalSec,
          provider: "none",
          model: "none",
          score: 0,
          status: "unavailable",
        });
      } else {
        evaluatedRuns++;
        let runScore = 0;
        console.log(`AI Latency: ${totalSec.toFixed(2)}s | Provider: ${res.aiProvider} | Model: ${res.aiModel}`);
        console.log("| Expected Claim | Expected Verdict | Actual Quote | Actual Verdict | Actual Fact | Actual Rule | Status |");
        console.log("|---|---|---|---|---|---|---|");

        for (const row of expectedRows) {
          const matchRes = row.matcher(res.findings);
          if (matchRes.matched) {
            runScore++;
            rowMatchCounts[row.name]++;
          }
          const statusStr = matchRes.matched ? "**MATCH**" : "**MISMATCH**";
          console.log(
            `| ${row.name} | ${row.expectedVerdict} | ${matchRes.actualQuote} | ${matchRes.actualVerdict} | ${matchRes.actualFact} | ${matchRes.actualRule} | ${statusStr} |`,
          );
        }

        console.log(`Result: ${runScore}/5 correct\n`);
        runSummaries.push({
          run,
          latencySec: totalSec,
          provider: res.aiProvider || "unknown",
          model: res.aiModel || "unknown",
          score: runScore,
          status: "ok",
        });

        // HARD rule check: NO wrong "supported"
        const wrongSupported = res.findings.some(
          (f) =>
            f.kind === "claim" &&
            f.verdict === "supported" &&
            (f.span_text.includes("eco-friendly") ||
              f.span_text.includes("No.1") ||
              f.span_text.includes("48") ||
              f.span_text.includes("4.8")),
        );
        if (wrongSupported) {
          console.error(`FATAL HARD RULE BREAK: Run ${run} produced a wrong 'supported' verdict!`);
          process.exit(1);
        }

        // SOFT rule check: at least 4/5 on runs that got an AI answer
        if (runScore < 4) {
          console.error(`FATAL SOFT RULE BREAK: Run ${run} scored ${runScore}/5 (below 4/5)!`);
          process.exit(1);
        }
      }

      if (run < numRuns) {
        console.log("Pausing 10s between runs (realistic usage)...\n");
        await new Promise((r) => setTimeout(r, 10000));
      }
    }

    console.log("=== 10-RUN BENCHMARK SUMMARY ===");
    console.log("| Run | Provider | Latency (s) | Score (/5) | Meets Soft Acceptance (>=4/5)? |");
    console.log("|---|---|---|---|---|");
    for (const s of runSummaries) {
      if (s.status === "unavailable") {
        console.log(`| Run ${s.run} | unavailable | ${s.latencySec.toFixed(2)}s | N/A (outage) | N/A |`);
      } else {
        console.log(
          `| Run ${s.run} | ${s.provider} | ${s.latencySec.toFixed(2)}s | ${s.score}/5 | ${s.score >= 4 ? "**YES**" : "**NO**"} |`,
        );
      }
    }

    console.log("\n=== EXACT MATCH PER ROW (Out of Completed Runs) ===");
    console.log(`Total completed AI runs: ${evaluatedRuns}/${numRuns}`);
    console.log("| Expected Item | Exact Matches | Accuracy | Notes |");
    console.log("|---|---|---|---|");
    for (const row of expectedRows) {
      const count = rowMatchCounts[row.name];
      const pct = evaluatedRuns > 0 ? `${((count / evaluatedRuns) * 100).toFixed(0)}%` : "0%";
      console.log(`| ${row.name} | ${count}/${evaluatedRuns} | ${pct} | ${row.expectedVerdict} |`);
    }
  } finally {
    clearTimeout(timeoutTimer);
    await pool.end();
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});

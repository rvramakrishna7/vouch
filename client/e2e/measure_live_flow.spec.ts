import { test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Measure live user flow (3 runs in fresh contexts)", async ({ browser }) => {
  for (let run = 1; run <= 3; run++) {
    console.log(`\n=================== RUN ${run} ===================`);
    const context = await browser.newContext();
    const page = await context.newPage();

    const requests: Array<{
      method: string;
      url: string;
      status?: number;
      start: number;
      duration?: number;
      serverTiming?: string;
    }> = [];

    page.on("request", (req) => {
      requests.push({
        method: req.method(),
        url: req.url(),
        start: performance.now(),
      });
    });

    page.on("response", (res) => {
      const match = requests.find(
        (r) => r.url === res.url() && r.method === res.request().method() && r.duration === undefined,
      );
      if (match) {
        match.duration = performance.now() - match.start;
        match.status = res.status();
        match.serverTiming = res.headers()["server-timing"] || "-";
      }
    });

    console.log(`[Run ${run}] Navigating to https://vouch-app-beta.vercel.app/login ...`);
    await page.goto("https://vouch-app-beta.vercel.app/login", { waitUntil: "networkidle" });

    const btn = page.getByRole("button", { name: "Try as Creator" });
    await btn.waitFor({ state: "visible" });

    const clickStart = performance.now();
    console.log(`[Run ${run}] Clicking 'Try as Creator'...`);
    await btn.click();

    // Wait until the content list is FULLY shown (either rows in table or empty state, loading spinner gone)
    await page.locator("table.stack-table, :text('No content yet.')").first().waitFor({ state: "visible", timeout: 20000 });
    const contentListTime = performance.now() - clickStart;

    console.log(`\n[Run ${run}] Click -> Content list fully shown: ${contentListTime.toFixed(0)} ms`);
    console.log(`[Run ${run}] Network Requests during flow:`);
    for (const r of requests) {
      if (r.url.includes("/api/")) {
        const urlObj = new URL(r.url);
        const relUrl = urlObj.pathname + urlObj.search;
        console.log(
          `  ${r.method.padEnd(7)} ${relUrl.padEnd(35)} -> ${r.status ?? "pending"} (${(r.duration ?? 0).toFixed(0)} ms) [Server-Timing: ${r.serverTiming ?? "-"}]`,
        );
      }
    }

    await context.close();
  }
});

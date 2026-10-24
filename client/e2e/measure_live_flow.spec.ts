import { test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Measure live user flow (3 runs in fresh contexts)", async ({ browser }) => {
  for (let run = 1; run <= 3; run++) {
    console.log(`\n=================== RUN ${run} ===================`);
    const context = await browser.newContext();
    const page = await context.newPage();

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");

    const requests = new Map<string, {
      requestId: string;
      method: string;
      url: string;
      status?: number;
      startTime: number;
      duration?: number;
      serverTiming?: string;
    }>();

    cdp.on("Network.requestWillBeSent", (event) => {
      requests.set(event.requestId, {
        requestId: event.requestId,
        method: event.request.method,
        url: event.request.url,
        startTime: performance.now(),
      });
    });

    cdp.on("Network.responseReceived", (event) => {
      const req = requests.get(event.requestId);
      if (req) {
        req.status = event.response.status;
        const timingHeader = event.response.headers["server-timing"] || event.response.headers["Server-Timing"];
        req.serverTiming = timingHeader || "-";
      }
      if (event.response.url.includes("/api/")) {
        console.log(`[API Response] ${event.response.status} ${event.response.url}`);
      }
    });

    cdp.on("Network.loadingFinished", (event) => {
      const req = requests.get(event.requestId);
      if (req) {
        req.duration = performance.now() - req.startTime;
      }
    });

    page.on("console", (msg) => console.log(`[Browser console] ${msg.type()}: ${msg.text()}`));
    page.on("requestfailed", (req) => console.log(`[Request failed] ${req.method()} ${req.url()}: ${req.failure()?.errorText}`));

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
    for (const r of requests.values()) {
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

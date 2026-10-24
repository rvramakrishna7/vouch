import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";

const screenshotsDir = fs.existsSync(path.join(process.cwd(), "client"))
  ? path.join(process.cwd(), "client", "e2e", "screenshots")
  : path.join(process.cwd(), "e2e", "screenshots");

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function assertCleanText(page: Page) {
  const text = await page.innerText("body");
  const entityMatch = text.match(/&[a-zA-Z]+;/);
  expect(
    entityMatch,
    `Page text should not contain unescaped HTML entities, found: ${entityMatch?.[0]}`,
  ).toBeNull();

  const badPatterns = [
    { pattern: /\bUnknown\b/, label: "Unknown" },
    { pattern: /\bInvalid Date\b/, label: "Invalid Date" },
    { pattern: /\bNaN\b/, label: "NaN" },
    { pattern: /\bundefined\b/, label: "undefined" },
    { pattern: /\bnull\b/, label: "null" },
    { pattern: /\[object Object\]/, label: "[object Object]" },
    { pattern: /\{"/, label: 'raw JSON ({" )' },
    { pattern: /""|“”/, label: 'empty quote ("" or “”) in visible text' },
    { pattern: /•\s*–|•\s*-|•\s*•/, label: 'broken separator/activity ("• –" or "• •")' },
  ];

  for (const { pattern, label } of badPatterns) {
    expect(
      pattern.test(text),
      `Page text should not contain placeholder/broken string "${label}". Text sample: ${text.slice(0, 300)}...`,
    ).toBe(false);
  }
}

async function checkContrast(page: Page, contextName: string) {
  const results = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();

  expect(
    results.violations,
    `Contrast violations found in ${contextName}: ${JSON.stringify(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })),
      null,
      2,
    )}`,
  ).toEqual([]);
}

const mockOrg = {
  id: "3ec5de87-e0a9-4288-90e0-08d7021a1e99",
  name: "Aqualeaf",
};

const mockBrandManager = {
  id: "95f005a6-6973-4667-be85-99d33c5f3624",
  organizationId: mockOrg.id,
  name: "Priya Sharma",
  email: "demo.brand@aqualeaf.test",
  role: "brand_manager",
};

const mockCreator = {
  id: "22222222-2222-2222-2222-222222222222",
  organizationId: mockOrg.id,
  name: "Arjun Mehta",
  email: "demo.creator@aqualeaf.test",
  role: "creator",
};

const mockReviewer = {
  id: "33333333-3333-3333-3333-333333333333",
  organizationId: mockOrg.id,
  name: "Neha Iyer",
  email: "demo.reviewer@aqualeaf.test",
  role: "reviewer",
};

const BODY =
  "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated";

function span(s: string) {
  const i = BODY.indexOf(s);
  return { start: i, end: i + s.length };
}

function createFinding(
  id: string,
  kind: "claim" | "tone" | "term" | "accessibility",
  text: string,
  verdict: string | null,
  fix: string | null,
  sev: "high" | "medium" | "low" = "high",
  rule: string | null = null,
  fact: string | null = null,
  factStatement: string | null = null,
  factValidUntil: string | null = null,
  ruleText: string | null = null,
  reason = "Verified against brand governance database.",
) {
  const { start, end } = span(text);
  return {
    id,
    organization_id: mockOrg.id,
    review_id: "r1",
    kind,
    span_text: text,
    start_offset: start,
    end_offset: end,
    verdict,
    fact_code: fact,
    fact_statement: factStatement,
    fact_valid_until: factValidUntil,
    rule_code: rule,
    rule_text: ruleText,
    reason,
    severity: sev,
    confidence: 0.92,
    suggested_fix: fix,
    replacement_text: null,
    resolution: "open",
    dismiss_reason: null,
    created_at: "2026-10-24T09:32:00Z",
  };
}

// 5 claim verdicts + 1 rule finding with demo-brand codes
const initialFindings = [
  createFinding(
    "f-no1",
    "claim",
    "India's No.1 eco-friendly water bottle",
    "unsupported",
    null,
    "high",
    "CLAIM-01",
    null,
    null,
    null,
    "No superlatives or rankings unless backed by survey.",
    "Superlative ranking requires verified independent market survey evidence.",
  ),
  createFinding(
    "f-40",
    "claim",
    "40% lighter",
    "supported",
    null,
    "low",
    null,
    "F-12",
    "Aqualeaf Flow is 40% lighter than traditional glass bottles.",
    "2027-12-31",
    null,
    "Verified against approved brand specification fact F-12.",
  ),
  createFinding(
    "f-rating",
    "claim",
    "Rated 4.8 by our customers!",
    "outdated",
    "Rated 4.8 by our customers in Q3 2026!",
    "medium",
    null,
    "F-03",
    "Customer rating is 4.8/5 based on 2,400+ verified buyer reviews as of Q3 2026.",
    "2026-09-30",
    null,
    "Buyer review aggregate data expired on 30 Sep 2026. Needs quarterly renewal.",
  ),
  createFinding(
    "f-cold48",
    "claim",
    "Keeps drinks cold for 48 hours",
    "contradicted",
    "Keeps drinks cold for 24 hours",
    "high",
    "CLAIM-03",
    "F-15",
    "Keeps beverages cold for up to 24 hours (tested in standard ambient conditions).",
    "2027-12-31",
    "Performance numbers must match verified lab test facts.",
    "Lab fact F-15 specifies up to 24 hours cold retention, contradicting the 48-hour claim.",
  ),
  createFinding(
    "f-eco",
    "claim",
    "eco-friendly",
    "needs_human_judgement",
    "made from recyclable steel",
    "medium",
    "CLAIM-02",
    null,
    null,
    null,
    "Green claims (eco-friendly, sustainable) require specific lifecycle evidence.",
    "Regulated term: a reviewer must confirm the specific attribute is stated in the text.",
  ),
  createFinding(
    "f-hash",
    "accessibility",
    "#stayhydrated",
    null,
    "#StayHydrated",
    "low",
    "ACC-02",
    null,
    null,
    null,
    "Hashtags must use CamelCase for screen reader accessibility.",
    "All-lowercase hashtag impairs screen reader speech synthesizer pronunciation.",
  ),
];

const USERS = {
  creator: mockCreator,
  brand_manager: mockBrandManager,
  reviewer: mockReviewer,
};

function setupThemeApiMocks(page: Page) {
  const roleState = { current: "creator" as "creator" | "brand_manager" | "reviewer" };
  let findingsState = initialFindings.map((f) => ({ ...f }));
  let contentStatus = "draft";
  let revisions = [
    {
      id: "rev1",
      n: 1,
      body: BODY,
      created_by: mockCreator.id,
      created_by_name: mockCreator.name,
      created_at: "2026-10-24T09:30:00Z",
    },
  ];

  let review = {
    id: "r1",
    organization_id: mockOrg.id,
    revision_id: "rev1",
    provider: "rules",
    model: "vouch-rules-v1",
    started_at: "2026-10-24T09:32:00Z",
    finished_at: "2026-10-24T09:32:02Z",
    created_at: "2026-10-24T09:32:00Z",
    ai_status: "ok",
    ai_provider: "groq",
    ai_model: "openai/gpt-oss-120b",
    ai_latency_ms: 2800,
  };

  const activityList = [
    {
      id: "act-1",
      action: "contents.create",
      actor: mockCreator.id,
      actor_name: mockCreator.name,
      time: "2026-10-24T09:30:00Z",
      details: { title: "Aqualeaf Summer Campaign 2026", channel: "Instagram" },
    },
    {
      id: "act-2",
      action: "review.run",
      actor: "system",
      actor_name: "Vouch Engine",
      time: "2026-10-24T09:32:00Z",
      details: { provider: "groq", model: "openai/gpt-oss-120b", findings_count: 6 },
    },
    {
      id: "act-3",
      action: "finding.resolve",
      actor: mockCreator.id,
      actor_name: mockCreator.name,
      time: "2026-10-24T09:40:00Z",
      details: { finding_id: "f-cold48", resolution: "accept" },
    },
  ];

  page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathName = url.pathname;
    const method = req.method();

    const jsonFulfill = (data: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });

    if (pathName === "/api/health") {
      return jsonFulfill({ status: "ok" });
    }

    if (pathName === "/api/auth/me") {
      return jsonFulfill({ user: USERS[roleState.current], organization: mockOrg });
    }

    if (pathName === "/api/auth/demo" && method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      if (body.role) roleState.current = body.role;
      return jsonFulfill({ token: "test-token", user: USERS[roleState.current], organization: mockOrg });
    }

    if (pathName === "/api/contents" && method === "GET") {
      return jsonFulfill([
        {
          id: "c1",
          title: "Aqualeaf Summer Campaign 2026",
          channel: "Instagram",
          status: contentStatus,
          created_by_name: mockCreator.name,
          updated_at: "2026-10-24T09:40:00Z",
          latest_revision_number: revisions.length,
        },
      ]);
    }

    if (pathName === "/api/contents/c1" && method === "GET") {
      return jsonFulfill({
        id: "c1",
        title: "Aqualeaf Summer Campaign 2026",
        channel: "Instagram",
        audience: "Eco-conscious urban commuters aged 22-35",
        purpose: "Highlight lightweight stainless steel bottle with verified thermal insulation.",
        status: contentStatus,
        created_by: mockCreator.id,
        created_by_name: mockCreator.name,
        created_at: "2026-10-24T09:30:00Z",
        updated_at: "2026-10-24T09:40:00Z",
        revisions,
      });
    }

    if (pathName === "/api/contents/c1/reviews/latest" && method === "GET") {
      return jsonFulfill({ review, findings: findingsState });
    }

    if (pathName === "/api/contents/c1/activity") {
      return jsonFulfill({ activity: activityList });
    }

    // Resolving finding (Accept / Edit / Dismiss)
    const matchResolution = pathName.match(/\/api\/findings\/([^/]+)\/resolution/);
    if (matchResolution && method === "PATCH") {
      const fid = matchResolution[1];
      const body = JSON.parse(req.postData() || "{}");
      findingsState = findingsState.map((f) => {
        if (f.id === fid) {
          const resolution = body.action === "accept" ? "accepted" : body.action === "edit" ? "edited" : "dismissed";
          const replacement_text = body.action === "accept" ? f.suggested_fix : body.text || null;
          return {
            ...f,
            resolution,
            replacement_text,
            dismiss_reason: body.reason || null,
          };
        }
        return f;
      });
      const updated = findingsState.find((f) => f.id === fid);
      return jsonFulfill({ finding: updated, ...updated });
    }

    // Preview changes modal or create revision
    if (pathName === "/api/contents/c1/revisions" && method === "POST") {
      const postData = JSON.parse(req.postData() || "{}");
      const newBody = BODY.replace(
        "Keeps drinks cold for 48 hours",
        "Keeps drinks cold for 24 hours",
      ).replace("#stayhydrated", "#StayHydrated");

      if (postData.mode === "preview") {
        return jsonFulfill({
          body: newBody,
          applied: [
            {
              finding_id: "f-cold48",
              span_text: "Keeps drinks cold for 48 hours",
              replacement_text: "Keeps drinks cold for 24 hours",
            },
            {
              finding_id: "f-hash",
              span_text: "#stayhydrated",
              replacement_text: "#StayHydrated",
            },
          ],
          skipped: [],
        });
      }

      if (postData.mode === "apply_fixes") {
        const rev2 = {
          id: "rev2",
          n: 2,
          body: newBody,
          created_by: mockCreator.id,
          created_by_name: mockCreator.name,
          created_at: "2026-10-24T09:45:00Z",
        };
        revisions.push(rev2);
        return jsonFulfill({ revision: rev2 }, 201);
      }
    }

    // Reviewer decision panel: approve requires override
    if (pathName === "/api/contents/c1/decision" && method === "POST") {
      const postData = JSON.parse(req.postData() || "{}");
      if (!postData.override) {
        return jsonFulfill(
          {
            error: "override_required",
            open_high: 2,
            ai_status: "ok",
          },
          409,
        );
      }
      contentStatus = "approved";
      return jsonFulfill({
        status: "approved",
        approved_at: "2026-10-24T09:50:00Z",
      });
    }

    if (pathName === "/api/rules") {
      return jsonFulfill([
        {
          id: "rule-1",
          code: "CLAIM-01",
          category: "claims",
          severity: "high",
          text: "No superlatives or rankings unless backed by survey.",
          version: 1,
          status: "active",
          created_at: "2026-10-24T09:00:00Z",
        },
        {
          id: "rule-2",
          code: "CLAIM-03",
          category: "claims",
          severity: "high",
          text: "Performance numbers must match verified lab test facts.",
          version: 1,
          status: "active",
          created_at: "2026-10-24T09:00:00Z",
        },
        {
          id: "rule-3",
          code: "ACC-02",
          category: "accessibility",
          severity: "low",
          text: "Hashtags must use CamelCase for screen reader accessibility.",
          version: 1,
          status: "active",
          created_at: "2026-10-24T09:00:00Z",
        },
      ]);
    }

    if (pathName === "/api/facts") {
      return jsonFulfill([
        {
          id: "fact-12",
          code: "F-12",
          statement: "Aqualeaf Flow is 40% lighter than traditional glass bottles.",
          source: "Internal R&D specification doc v2.1 (2026)",
          owner: "Priya Sharma",
          valid_from: "2026-01-01",
          valid_until: "2027-12-31",
          expired: false,
          created_at: "2026-10-24T09:00:00Z",
        },
        {
          id: "fact-15",
          code: "F-15",
          statement: "Keeps beverages cold for up to 24 hours (tested in standard ambient conditions).",
          source: "Thermal lab test report #TL-2026-04",
          owner: "Priya Sharma",
          valid_from: "2026-01-01",
          valid_until: "2027-12-31",
          expired: false,
          created_at: "2026-10-24T09:00:00Z",
        },
        {
          id: "fact-03",
          code: "F-03",
          statement: "Customer rating is 4.8/5 based on 2,400+ verified buyer reviews as of Q3 2026.",
          source: "Verified buyer review aggregation report Q3 2026",
          owner: "Priya Sharma",
          valid_from: "2026-01-01",
          valid_until: "2026-09-30", // EXPIRED FACT (displays red Expired badge)
          expired: true,
          created_at: "2026-10-24T09:00:00Z",
        },
      ]);
    }

    if (pathName === "/api/terms") {
      return jsonFulfill([
        {
          id: "term-1",
          term: "metal flask",
          type: "banned",
          replacement: "steel bottle",
          rule_code: "TERM-01",
          note: "Say steel bottle, not metal flask",
          created_at: "2026-10-24T09:00:00Z",
        },
        {
          id: "term-2",
          term: "eco-friendly",
          type: "regulated",
          replacement: "made from recyclable steel",
          rule_code: "TERM-02",
          note: "Green claims require lifecycle certification",
          created_at: "2026-10-24T09:00:00Z",
        },
      ]);
    }

    if (pathName === "/api/reviews" && method === "GET") {
      return jsonFulfill([
        {
          id: "rev-item-1",
          content_id: "c1",
          title: "Aqualeaf Summer Campaign 2026",
          channel: "Instagram",
          status: contentStatus,
          submitted_by: mockCreator.name,
          submitted_at: "2026-10-24T09:30:00Z",
        },
      ]);
    }

    if (pathName === "/api/audit/actions") {
      return jsonFulfill([
        { action: "content.submit", count: 1 },
        { action: "content.approve", count: 1 },
        { action: "rule.create", count: 1 },
      ]);
    }

    if (pathName === "/api/audit") {
      return jsonFulfill({
        events: [
          {
            id: "audit-1",
            action: "content.submit",
            actor_name: mockCreator.name,
            actor: mockCreator.email,
            entity: "content · c1",
            at: "2026-10-24T09:42:00Z",
            payload: { title: "Aqualeaf Summer Campaign 2026", channel: "Instagram" },
          },
          {
            id: "audit-2",
            action: "content.approve",
            actor_name: mockReviewer.name,
            actor: mockReviewer.email,
            entity: "content · c1",
            at: "2026-10-24T09:50:00Z",
            payload: { override_reason: "Approved with marketing exceptions for initial social media launch" },
          },
          {
            id: "audit-3",
            action: "rule.create",
            actor_name: mockBrandManager.name,
            actor: mockBrandManager.email,
            entity: "rule · CLAIM-01",
            at: "2026-10-24T09:00:00Z",
            payload: { text: "No superlatives or rankings unless backed by survey" },
          },
        ],
      });
    }

    return jsonFulfill({ error: "not_found" }, 404);
  });

  return roleState;
}

test.describe("Dark mode theme toggling, persistence, contrast, and layout (S12e)", () => {
  test("Toggle switches theme, persists across reloads, and applies to desktop & mobile", async ({
    page,
  }) => {
    const roleState = setupThemeApiMocks(page);

    // 1. Visit login page on desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Vouch");

    // Initially light theme
    const isDarkInitially = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isDarkInitially).toBe(false);

    // Toggle theme to dark via login page ThemeToggle
    const loginThemeToggle = page.locator("button[aria-label='Switch to dark theme']").first();
    await loginThemeToggle.click();

    // Verify dark class applied to html
    const isDarkAfterToggle = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isDarkAfterToggle).toBe(true);

    // Verify localStorage persistence
    const savedTheme = await page.evaluate(() => localStorage.getItem("vouch_theme"));
    expect(savedTheme).toBe("dark");

    // Reload page to test anti-flash and persistence
    await page.reload();
    const isDarkAfterReload = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isDarkAfterReload).toBe(true);

    // 2. Test Mobile drawer toggle at 375px
    await page.setViewportSize({ width: 375, height: 667 });
    roleState.current = "brand_manager";
    await page.evaluate(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: mockBrandManager, org: mockOrg },
    );
    await page.goto("/brand-kit");
    await expect(page.locator("h1")).toContainText("Brand Kit");

    // Open mobile menu
    await page.click("button[aria-label='Menu']");
    const mobileMenu = page.locator("#mobile-menu");
    await expect(mobileMenu).toBeVisible();

    // Toggle to light theme from mobile menu
    const mobileLightToggle = mobileMenu.locator("button[aria-label='Switch to light theme']");
    await mobileLightToggle.click();

    const isLightNow = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isLightNow).toBe(false);

    // Toggle back to dark theme
    const mobileDarkToggle = mobileMenu.locator("button[aria-label='Switch to dark theme']");
    await mobileDarkToggle.click();

    const isDarkAgain = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isDarkAgain).toBe(true);
  });

  test("WCAG AA Contrast, clean text, and full Dark screenshots across required views (S12e.1)", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const roleState = setupThemeApiMocks(page);

    await page.addInitScript(
      ({ org, creator, brandManager, reviewer }) => {
        const path = window.location.pathname;
        if (path === "/login") {
          sessionStorage.removeItem("vouch_token");
          sessionStorage.removeItem("vouch_user");
          sessionStorage.removeItem("vouch_org");
          return;
        }
        let user = creator;
        if (path.startsWith("/brand-kit")) user = brandManager;
        if (path.startsWith("/reviews") || path.startsWith("/audit")) user = reviewer;

        sessionStorage.setItem("vouch_token", "valid-test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { org: mockOrg, creator: mockCreator, brandManager: mockBrandManager, reviewer: mockReviewer },
    );

    // 1. LIGHT MODE BASELINE (Clean text + WCAG AA contrast check)
    await page.goto("/login");
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("vouch_theme", "light");
    });

    const standardPages = [
      { name: "login", path: "/login" },
      { name: "content_list", path: "/content" },
      { name: "content_detail", path: "/content/c1" },
      { name: "reviews", path: "/reviews" },
      { name: "brand_kit", path: "/brand-kit" },
      { name: "audit", path: "/audit" },
    ];

    for (const p of standardPages) {
      if (p.path.startsWith("/brand-kit")) roleState.current = "brand_manager";
      else if (p.path.startsWith("/reviews") || p.path.startsWith("/audit")) roleState.current = "reviewer";
      else roleState.current = "creator";

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");

      await assertCleanText(page);
      await checkContrast(page, `Light Mode - ${p.name}`);
    }

    // 2. SWITCH TO DARK MODE
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("vouch_theme", "dark");
    });

    // Capture standard pages in dark mode at 1280px and 375px
    for (const p of standardPages) {
      if (p.path.startsWith("/brand-kit")) roleState.current = "brand_manager";
      else if (p.path.startsWith("/reviews") || p.path.startsWith("/audit")) roleState.current = "reviewer";
      else roleState.current = "creator";

      // 1280px desktop
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");

      await assertCleanText(page);
      await checkContrast(page, `Dark Mode (1280px) - ${p.name}`);
      await page.screenshot({
        path: path.join(screenshotsDir, `s12e_dark_${p.name}_1280.png`),
        fullPage: true,
      });

      // 375px mobile
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");

      await assertCleanText(page);
      await checkContrast(page, `Dark Mode (375px) - ${p.name}`);
      await page.screenshot({
        path: path.join(screenshotsDir, `s12e_dark_${p.name}_375.png`),
        fullPage: true,
      });
    }

    // 3. SPECIFIC VIEW: Brand Kit Facts tab with Expired Fact F-03 (Dark mode 1280px & 375px)
    roleState.current = "brand_manager";
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/brand-kit");
    await page.click("button:has-text('Approved Facts')");
    await expect(page.locator("text=Customer rating is 4.8/5")).toBeVisible();
    await expect(page.locator("span:has-text('Expired')")).toBeVisible();

    await assertCleanText(page);
    await checkContrast(page, "Dark Mode (1280px) - Brand Kit Facts");
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_brand_kit_facts_1280.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_brand_kit_facts_375.png"),
      fullPage: true,
    });

    // 4. SPECIFIC VIEW: Preview Diff Modal (Dark mode 1280px & 375px)
    roleState.current = "creator";
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/content/c1");
    await page.waitForLoadState("networkidle");

    // Accept fix on contradicted finding (f-cold48)
    const acceptBtn = page.locator("#finding-card-f-cold48 button:has-text('Accept fix')");
    await acceptBtn.click();
    await expect(page.locator("#finding-card-f-cold48 :text('Accepted')")).toBeVisible();

    // Click "Preview changes"
    const previewBtn = page.getByRole("button", { name: "Preview changes" });
    await expect(previewBtn).toBeEnabled();
    await previewBtn.click();

    const previewModal = page.locator(".fixed");
    await expect(previewModal.getByText("Diff Preview")).toBeVisible();
    await expect(previewModal.locator("ins").first()).toContainText("24");
    await expect(previewModal.locator("del").first()).toContainText("48");

    await assertCleanText(page);
    await checkContrast(page, "Dark Mode (1280px) - Preview Diff Modal");
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_preview_diff_modal_1280.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_preview_diff_modal_375.png"),
      fullPage: true,
    });

    // 5. SPECIFIC VIEW: Stale Review Notice (Dark mode 1280px & 375px)
    await page.setViewportSize({ width: 1280, height: 800 });
    const createRevBtn = previewModal.getByRole("button", { name: "Create revision" });
    await createRevBtn.click();

    // Verify stale notice banner rendered
    const staleNotice = page.locator("text=Revision 2 created. These findings are for Revision 1");
    await expect(staleNotice).toBeVisible();

    await assertCleanText(page);
    await checkContrast(page, "Dark Mode (1280px) - Stale Review Notice");
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_stale_notice_1280.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_stale_notice_375.png"),
      fullPage: true,
    });

    // 6. SPECIFIC VIEW: Reviewer Approval Override Dialog (Dark mode 1280px & 375px)
    // Switch to reviewer session on /content/c1
    roleState.current = "reviewer";
    await page.evaluate(({ reviewer, org }) => {
      sessionStorage.setItem("vouch_user", JSON.stringify(reviewer));
      sessionStorage.setItem("vouch_org", JSON.stringify(org));
    }, { reviewer: mockReviewer, org: mockOrg });

    // Mock content as in_review for the reviewer
    await page.route("**/api/contents/c1", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "c1",
            title: "Aqualeaf Summer Campaign 2026",
            channel: "Instagram",
            audience: "Eco-conscious urban commuters aged 22-35",
            purpose: "Highlight lightweight stainless steel bottle with verified thermal insulation.",
            status: "in_review",
            created_by: mockCreator.id,
            created_by_name: mockCreator.name,
            created_at: "2026-10-24T09:30:00Z",
            updated_at: "2026-10-24T09:40:00Z",
            revisions: [
              {
                id: "rev1",
                n: 1,
                body: BODY,
                created_by: mockCreator.id,
                created_by_name: mockCreator.name,
                created_at: "2026-10-24T09:30:00Z",
              },
            ],
          }),
        });
      }
      return route.fallback();
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/content/c1");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h3:has-text('Reviewer Decision')")).toBeVisible();
    const approveBtn = page.locator("button:has-text('Approve')").first();
    await approveBtn.click();

    // Approval requires override modal opens
    await expect(page.locator("h3:has-text('Approval Requires Override')")).toBeVisible();
    await expect(page.locator("text=Conditions requiring override")).toBeVisible();

    await assertCleanText(page);
    await checkContrast(page, "Dark Mode (1280px) - Override Dialog");
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_override_dialog_1280.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_override_dialog_375.png"),
      fullPage: true,
    });
  });
});

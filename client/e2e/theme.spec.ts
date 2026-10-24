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

const mockUser = {
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

const BODY =
  "Aqualeaf Flow is the best bottle in India. Keeps drinks ice cold for 24 hours. Say steel bottle, not metal flask.";

const mockContent = {
  id: "c1",
  title: "Aqualeaf Summer Campaign 2026",
  channel: "Instagram",
  audience: "Active lifestyle consumers",
  purpose: "Launch the 2026 insulated steel bottle collection",
  status: "draft",
  created_by: mockCreator.id,
  created_by_name: mockCreator.name,
  created_at: "2026-10-24T10:00:00Z",
  updated_at: "2026-10-24T10:00:00Z",
  revisions: [
    {
      id: "rev1",
      n: 1,
      body: BODY,
      created_by: mockCreator.id,
      created_by_name: mockCreator.name,
      created_at: "2026-10-24T10:00:00Z",
    },
  ],
};

const mockFindings = [
  {
    id: "f-1",
    kind: "claim",
    claim_text: "Keeps drinks ice cold for 24 hours",
    source_quote: "Keeps drinks ice cold for 24 hours",
    flagged_text: "Keeps drinks ice cold for 24 hours",
    verdict: "supported",
    rule_code: "FACT-01",
    severity: "low",
    confidence: 0.95,
    resolution: "open",
    suggested_fix: null,
    replacement_text: null,
    dismiss_reason: null,
    created_at: "2026-10-24T10:00:00Z",
  },
  {
    id: "f-2",
    kind: "rule",
    category: "claims",
    rule_id: "rule-1",
    rule_code: "CLAIM-01",
    rule_text: "No superlatives or rankings unless backed by survey.",
    flagged_text: "best bottle in India",
    source_quote: "best bottle in India",
    message: "Superlative ranking requires verified survey fact.",
    severity: "high",
    verdict: "contradicted",
    confidence: 0.9,
    resolution: "open",
    suggested_fix: "Remove superlative.",
    replacement_text: null,
    dismiss_reason: null,
    created_at: "2026-10-24T10:00:00Z",
  },
  {
    id: "f-3",
    kind: "rule",
    category: "terminology",
    rule_id: "rule-2",
    rule_code: "TERM-02",
    rule_text: "Say steel bottle, not metal flask.",
    flagged_text: "metal flask",
    source_quote: "metal flask",
    message: "Avoid outdated descriptor 'metal flask'.",
    severity: "medium",
    verdict: "outdated",
    confidence: 0.9,
    resolution: "open",
    suggested_fix: "steel bottle",
    replacement_text: null,
    dismiss_reason: null,
    created_at: "2026-10-24T10:00:00Z",
  },
];

const mockReview = {
  id: "r1",
  organization_id: mockOrg.id,
  revision_id: "rev1",
  provider: "rules",
  model: "vouch-rules-v1",
  status: "completed",
  started_at: "2026-10-24T10:00:00Z",
  finished_at: "2026-10-24T10:00:01Z",
  created_at: "2026-10-24T10:00:00Z",
  ai_status: "ok",
  ai_provider: "groq",
  ai_model: "openai/gpt-oss-120b",
  ai_latency_ms: 1500,
};

async function setupApiMocks(page: Page) {
  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;
    const method = route.request().method();

    const jsonFulfill = (data: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });

    if (method === "OPTIONS") return jsonFulfill({});

    if (pathName.endsWith("/api/health")) {
      return jsonFulfill({ status: "ok" });
    }

    if (pathName.endsWith("/api/auth/me")) {
      const authHeader = route.request().headers()["authorization"] || "";
      const isCreator = authHeader.includes("creator-token");
      return jsonFulfill({ user: isCreator ? mockCreator : mockUser, organization: mockOrg });
    }

    if (pathName.endsWith("/api/contents") && method === "GET") {
      return jsonFulfill([
        {
          id: "c1",
          title: "Aqualeaf Summer Campaign 2026",
          channel: "Instagram",
          purpose: "Launch the 2026 insulated steel bottle collection",
          audience: "Active lifestyle consumers",
          status: "draft",
          created_by_name: "Arjun Mehta",
          updated_at: "2026-10-24T10:00:00.000Z",
          latest_revision_number: 1,
        },
      ]);
    }

    if (pathName.endsWith("/api/contents/c1") && method === "GET") {
      return jsonFulfill(mockContent);
    }

    if (pathName.endsWith("/api/contents/c1/reviews/latest")) {
      return jsonFulfill({ review: mockReview, findings: mockFindings });
    }

    if (pathName.endsWith("/api/contents/c1/activity")) {
      return jsonFulfill({
        activity: [
          {
            id: "act-1",
            type: "review.completed",
            actor_name: "Vouch Engine",
            actor_role: "system",
            summary: "Automated review completed with 3 findings",
            created_at: "2026-10-24T10:00:00.000Z",
          },
        ],
      });
    }

    if (pathName.endsWith("/api/rules")) {
      return jsonFulfill([
        {
          id: "rule-1",
          code: "CLAIM-01",
          category: "claims",
          severity: "high",
          text: "No superlatives or rankings unless backed by survey.",
          version: 1,
          status: "active",
          created_at: "2026-10-24T10:00:00.000Z",
        },
      ]);
    }

    if (pathName.endsWith("/api/facts")) {
      return jsonFulfill([
        {
          id: "fact-1",
          code: "FACT-01",
          category: "thermal",
          text: "Keeps water cold for 24 hours verified by SGS test report #SGS-2026-8812.",
          source: "SGS lab test report #SGS-2026-8812",
          valid_from: "2026-01-01",
          valid_until: "2027-01-01",
          status: "active",
          created_at: "2026-10-24T10:00:00.000Z",
        },
      ]);
    }

    if (pathName.endsWith("/api/terms")) {
      return jsonFulfill([
        {
          id: "term-1",
          term: "metal flask",
          type: "forbidden",
          replacement: "steel bottle",
          rule_id: "rule-1",
          rule_code: "TERM-01",
          note: "Use approved nomenclature only",
          created_at: "2026-10-24T10:00:00.000Z",
        },
      ]);
    }

    if (pathName.endsWith("/api/reviews") && method === "GET") {
      return jsonFulfill([
        {
          id: "rev-item-1",
          content_id: "c1",
          title: "Aqualeaf Summer Campaign 2026",
          channel: "Instagram",
          status: "in_review",
          submitted_by: "Arjun Mehta",
          submitted_at: "2026-10-24T10:00:00.000Z",
        },
      ]);
    }

    if (pathName.endsWith("/api/audit")) {
      return jsonFulfill({
        events: [
          {
            id: "audit-1",
            action: "content.submit",
            actor_name: "Arjun Mehta",
            actor: "demo.creator@aqualeaf.test",
            entity: "content:c1",
            at: "2026-10-24T10:05:00.000Z",
            payload: { title: "Aqualeaf Summer Campaign 2026" },
          },
        ],
        total: 1,
      });
    }

    return jsonFulfill({ error: "not_found" }, 404);
  });
}

test.describe("Dark mode theme toggling, persistence, contrast, and layout (S12e)", () => {
  test("Toggle switches theme, persists across reloads, and applies to desktop & mobile", async ({
    page,
  }) => {
    await setupApiMocks(page);

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
    await page.addInitScript(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: mockUser, org: mockOrg },
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

  test("WCAG AA Contrast and clean text across all pages in both Light and Dark themes", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await setupApiMocks(page);

    await page.addInitScript(
      ({ org }) => {
        const path = window.location.pathname;
        if (path === "/login") {
          sessionStorage.removeItem("vouch_token");
          sessionStorage.removeItem("vouch_user");
          sessionStorage.removeItem("vouch_org");
          return;
        }
        const isCreator = path.startsWith("/content");
        const user = isCreator
          ? {
              id: "22222222-2222-2222-2222-222222222222",
              organizationId: org.id,
              name: "Arjun Mehta",
              email: "demo.creator@aqualeaf.test",
              role: "creator",
            }
          : {
              id: "95f005a6-6973-4667-be85-99d33c5f3624",
              organizationId: org.id,
              name: "Priya Sharma",
              email: "demo.brand@aqualeaf.test",
              role: "brand_manager",
            };
        sessionStorage.setItem("vouch_token", isCreator ? "creator-token" : "test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { org: mockOrg },
    );

    const pagesToTest = [
      { name: "login", path: "/login", title: "Vouch" },
      { name: "content_list", path: "/content", title: "Content" },
      { name: "content_detail", path: "/content/c1", title: "Aqualeaf Summer Campaign 2026" },
      { name: "reviews", path: "/reviews", title: "Reviews" },
      { name: "brand_kit", path: "/brand-kit", title: "Brand Kit" },
      { name: "audit", path: "/audit", title: "Audit log" },
    ];

    // Check in Light Mode first
    await page.goto("/login");
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("vouch_theme", "light");
    });

    for (const p of pagesToTest) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");

      await assertCleanText(page);
      await checkContrast(page, `Light Mode - ${p.name}`);
    }

    // Now switch to Dark Mode
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("vouch_theme", "dark");
    });

    for (const p of pagesToTest) {
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

    // Import Guideline Modal check in Dark mode
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/brand-kit");
    await page.click("button:has-text('Import from guideline')");
    await expect(page.locator("h2:has-text('Import rules from guideline')")).toBeVisible();

    await assertCleanText(page);
    await checkContrast(page, "Dark Mode (1280px) - Import Modal");
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_import_modal_1280.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(screenshotsDir, "s12e_dark_import_modal_375.png"),
      fullPage: true,
    });
  });
});

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { DEMO_GUIDELINE_TEXT as DEMO_TEXT } from "../src/data/demoGuideline.js";

const API = "http://api.test";

const LONG_GUIDELINE_DIRECTIVE =
  "Every claim regarding charitable donations or environmental initiatives must name the verified partner organization and specify the exact audited contribution percentage.";

async function assertCleanText(page: Page) {
  const text = await page.innerText("body");

  // HTML entities check
  const entityMatch = text.match(/&[a-zA-Z]+;/);
  expect(
    entityMatch,
    `Page text should not contain unescaped HTML entities, found: ${entityMatch?.[0]}`,
  ).toBeNull();

  // Forbidden icon words
  const forbiddenWords = ["checked", "check_circle", "close", "arrow_forward"];
  for (const word of forbiddenWords) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    expect(
      regex.test(text),
      `Page text should not contain icon name "${word}" as visible word`,
    ).toBe(false);
  }

  // AGENTS.md 7d.2 checks:
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

// AGENTS.md 7e.2: Every e2e test checks layout at 1280 px and 1440 px width
async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `Horizontal page overflow at ${width}px (${contextLabel}): scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`,
    ).toBeLessThanOrEqual(clientWidth);
  }
}

test.describe("Guideline Import Workflow (S11) E2E", () => {
  const screenshotsDir = path.join(process.cwd(), "e2e", "screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Brand Manager imports guideline, reviews AI-drafted rules, deselects duplicates, and applies rules", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const brandManagerUser = {
      id: "bm-1",
      name: "Priya Sharma",
      email: "demo.brand@aqualeaf.test",
      role: "brand_manager",
    };

    const org = {
      id: "o1",
      name: "Aqualeaf",
    };

    let existingRulesList: any[] = [
      {
        id: "r1",
        organization_id: "o1",
        code: "CLAIM-01",
        category: "claims",
        severity: "high",
        text: 'No superlatives or rankings ("No.1", "best", "India\'s leading") unless backed by an approved ranking fact.',
        version: 1,
        status: "active",
        created_at: "2026-10-23T04:00:00.000Z",
      },
      {
        id: "r2",
        organization_id: "o1",
        code: "TONE-01",
        category: "tone",
        severity: "medium",
        text: "Friendly, confident and plain. No fear-based or shaming language.",
        version: 1,
        status: "active",
        created_at: "2026-10-23T04:00:00.000Z",
      },
    ];

    const quote1 = "Never use unverified superlatives or number one rankings without approved survey backing.";
    const start1 = DEMO_TEXT.indexOf(quote1);
    const end1 = start1 + quote1.length;

    const quote2 = "Every claim regarding charitable donations or environmental initiatives must name the verified partner organization and specify the exact audited contribution percentage.";
    const start2 = DEMO_TEXT.indexOf(quote2);
    const end2 = start2 + quote2.length;

    const quote3 = 'Adopt an encouraging, active voice that speaks directly to the reader using "you" rather than impersonal third-person prose.';
    const start3 = DEMO_TEXT.indexOf(quote3);
    const end3 = start3 + quote3.length;

    const mockDraftResponse = {
      drafts: [
        {
          temp_id: "draft-1",
          code: "CLAIM-05",
          category: "claims",
          severity: "high",
          text: "Never use unverified superlatives or number one rankings without survey proof.",
          source_quote: quote1,
          source_start: start1,
          source_end: end1,
          duplicate_of: "CLAIM-01",
        },
        {
          temp_id: "draft-2",
          code: "CLAIM-06",
          category: "claims",
          severity: "high",
          text: "Every claim regarding charitable donations or environmental initiatives must specify the exact audited contribution percentage.",
          source_quote: quote2,
          source_start: start2,
          source_end: end2,
          duplicate_of: null,
        },
        {
          temp_id: "draft-3",
          code: "TONE-03",
          category: "tone",
          severity: "low",
          text: "Adopt an encouraging active voice that speaks directly to the reader as you.",
          source_quote: quote3,
          source_start: start3,
          source_end: end3,
          duplicate_of: null,
        },
      ],
      rejected: 1,
      source_text: DEMO_TEXT,
      ai: {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        latency_ms: 1250,
      },
    };

    // Route mocking
    await page.route(`${API}/**`, async (route, request) => {
      const url = request.url();
      const method = request.method();

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

      if (url.endsWith("/api/auth/me")) {
        return jsonFulfill({ user: brandManagerUser, organization: org });
      }

      if (url.endsWith("/api/rules") && method === "GET") {
        return jsonFulfill(existingRulesList);
      }

      if (url.endsWith("/api/guidelines/draft") && method === "POST") {
        return jsonFulfill(mockDraftResponse);
      }

      if (url.endsWith("/api/guidelines/apply") && method === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        const newlyCreated = body.rules.map((r: any, idx: number) => ({
          id: `new-r-${idx}`,
          organization_id: "o1",
          code: r.code,
          category: r.category,
          severity: r.severity,
          text: r.text,
          version: 1,
          status: "active",
          created_at: new Date().toISOString(),
        }));
        existingRulesList = [...existingRulesList, ...newlyCreated];
        return jsonFulfill({ rules: newlyCreated }, 201);
      }

      return jsonFulfill({ error: "not_found" }, 404);
    });

    // Seed session for Brand Manager
    await page.addInitScript(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: brandManagerUser, org },
    );

    // =========================================================================
    // Step 1: Open Brand Kit > Rules tab -> "Import from guideline" button visible
    // =========================================================================
    await page.goto("/brand-kit");
    await page.waitForSelector("h1:has-text('Brand Kit')");

    await assertNoHorizontalOverflow(page, "Step 1 Brand Kit Rules");

    const importBtn = page.locator("button:has-text('Import from guideline')");
    await expect(importBtn).toBeVisible();
    await expect(page.locator("button:has-text('+ Add rule')")).toBeVisible();

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s11_step1_rules_tab_import_button.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 2: Click "Import from guideline" -> Modal opens, click "Use sample guideline"
    // =========================================================================
    await importBtn.click();
    await page.waitForSelector("h2:has-text('Import Rules from Guideline')");

    const textarea = page.locator("textarea[placeholder*='Paste guideline text here']");
    await expect(textarea).toBeVisible();

    const sampleBtn = page.locator("button:has-text('Use sample guideline')");
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    // Verify textarea populated with sample text
    const textVal = await textarea.inputValue();
    expect(textVal.length).toBeGreaterThan(100);
    expect(textVal).toContain("Aqualeaf Brand & Communications Guideline");

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s11_step2_import_modal_sample_loaded.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 3: Click "Draft rules" -> Pending state -> Results view rendered
    // =========================================================================
    const draftRulesBtn = page.locator("button:has-text('Draft rules')");
    await draftRulesBtn.click();

    await page.waitForSelector("text=3 rules drafted");
    await expect(page.locator("text=1 dropped due to unverified quotes")).toBeVisible();

    // Check duplicate badge and tooltip
    const dupBadge = page.locator("span:has-text('Possible duplicate of CLAIM-01')");
    await expect(dupBadge).toBeVisible();
    await expect(dupBadge).toHaveAttribute("title", /Matched CLAIM-01/);

    const checkboxes = page.locator("input[type='checkbox']");
    await expect(checkboxes).toHaveCount(3);

    // Checkbox 1 (duplicate) should be unchecked
    await expect(checkboxes.nth(0)).not.toBeChecked();
    // Checkboxes 2 and 3 should be checked by default
    await expect(checkboxes.nth(1)).toBeChecked();
    await expect(checkboxes.nth(2)).toBeChecked();

    // Footer count: "2 selected of 3 rules"
    await expect(page.locator("text=2 selected of 3 rules")).toBeVisible();
    const addRulesBtn = page.locator("button:has-text('Add 2 rules')");
    await expect(addRulesBtn).toBeVisible();
    await expect(addRulesBtn).toBeEnabled();

    // Exact highlighted text matching each draft's source_quote
    const marks = page.locator("mark");
    await expect(marks).toHaveCount(3);
    await expect(marks.nth(0)).toHaveText(quote1);
    await expect(marks.nth(1)).toHaveText(quote2);
    await expect(marks.nth(2)).toHaveText(quote3);

    await assertNoHorizontalOverflow(page, "Step 3 Review Modal");
    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s11_step3_review_draft_rules.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 4: Toggle selection and edit rule text
    // =========================================================================
    // Uncheck Draft 3 -> now 1 selected
    await checkboxes.nth(2).click();
    await expect(page.locator("text=1 selected of 3 rules")).toBeVisible();
    await expect(page.locator("button:has-text('Add 1 rules')")).toBeVisible();

    // Re-check Draft 3 -> now 2 selected
    await checkboxes.nth(2).click();
    await expect(page.locator("text=2 selected of 3 rules")).toBeVisible();

    // =========================================================================
    // Step 5: Click "Add 2 rules" -> Rules applied, modal closes, success banner shown
    // =========================================================================
    await addRulesBtn.click();

    // Modal closes
    await expect(page.locator("h2:has-text('Import Rules from Guideline')")).toHaveCount(0);

    // Success banner visible in RulesTab
    await expect(page.locator("text=Successfully imported 2 rule(s) into Brand Kit.")).toBeVisible();

    // Newly added rules visible in rules list
    await expect(page.locator("text=CLAIM-06")).toBeVisible();
    await expect(page.locator("text=TONE-03")).toBeVisible();

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s11_step4_rules_imported_success.png"),
      fullPage: true,
    });

    expect(pageErrors).toEqual([]);
  });

  test("Handles AI unavailable error gracefully with friendly plain words", async ({ page }) => {
    const brandManagerUser = {
      id: "bm-1",
      name: "Priya Sharma",
      email: "demo.brand@aqualeaf.test",
      role: "brand_manager",
    };

    const org = { id: "o1", name: "Aqualeaf" };

    await page.route(`${API}/**`, async (route, request) => {
      const url = request.url();
      if (url.endsWith("/api/auth/me")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: brandManagerUser, organization: org }) });
      }
      if (url.endsWith("/api/rules")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      }
      if (url.endsWith("/api/guidelines/draft")) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "ai_unavailable" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await page.addInitScript(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: brandManagerUser, org },
    );

    await page.goto("/brand-kit");
    await page.click("button:has-text('Import from guideline')");
    await page.click("button:has-text('Use sample guideline')");
    await page.click("button:has-text('Draft rules')");

    // Plain words error shown
    await expect(
      page.locator("text=AI is unavailable right now. Try again in a minute."),
    ).toBeVisible();

    await assertCleanText(page);
  });
});

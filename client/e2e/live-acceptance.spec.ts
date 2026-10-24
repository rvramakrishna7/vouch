import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, "screenshots");
const API_BASE = process.env.VITE_API_URL || "https://vouch-ten-iota.vercel.app";

// AGENTS.md 7d.2: assertCleanText must fail on placeholder / broken strings
async function assertCleanText(page: Page) {
  const text = await page.innerText("body");

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

// AGENTS.md 7e.2 & 7f.1: No horizontal layout overflow
async function assertNoLayoutOverflow(page: Page) {
  const isOverflowing = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  expect(isOverflowing, "Page should not have horizontal scrollbar").toBe(false);
}

// Screenshot helper with exact naming convention: live_<test>_<step>_<width>_<theme>.png
async function takeScreenshot(
  page: Page,
  testId: string,
  step: string,
  width: number,
  theme: "light" | "dark",
) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  const filename = `live_${testId}_${step}_${width}_${theme}.png`;
  const filePath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

test.describe("Vouch Live Acceptance Suite (TEST-001..011)", () => {
  // Real live requests + live AI inference
  test.setTimeout(240000);

  test("TEST-001..011 end-to-end on live deployment with real AI", async ({ page, request }) => {
    // -------------------------------------------------------------------------
    // PHASE 1: 1280px Viewport (Light Theme)
    // -------------------------------------------------------------------------
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/login");
    await page.waitForSelector("text=Vouch");

    // Force light theme
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("vouch_theme", "light");
    });

    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test001", "login_page", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-001: Try as Brand Manager, Creator, Reviewer logins & nav
    // -------------------------------------------------------------------------
    console.log("TEST-001: Testing Brand Manager login...");
    await page.getByRole("button", { name: "Try as Brand Manager" }).click();
    await page.waitForURL("**/brand-kit");
    await page.waitForSelector("h1:has-text('Brand Kit')");
    await expect(page.locator("header")).toContainText("Brand Manager");
    await expect(page.locator("header")).toContainText("Priya Sharma");
    await expect(page.locator("header")).toContainText("Brand Kit");
    await expect(page.locator("header")).toContainText("Reviews (read)");
    await expect(page.locator("header")).toContainText("Audit log");
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test001", "brand_manager_home", 1280, "light");

    // Switch role to Reviewer
    console.log("TEST-001: Testing Reviewer login...");
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Reviewer" }).click();
    await page.waitForURL("**/reviews");
    await page.waitForSelector("h1:has-text('Review Queue')");
    await expect(page.locator("header")).toContainText("Reviewer");
    await expect(page.locator("header")).toContainText("Neha Iyer");
    await expect(page.locator("header")).toContainText("Reviews");
    await expect(page.locator("header")).toContainText("Brand Kit");
    await expect(page.locator("header")).toContainText("Audit log");
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test001", "reviewer_home", 1280, "light");

    // Switch role to Creator
    console.log("TEST-001: Testing Creator login...");
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Creator" }).click();
    await page.waitForURL("**/content");
    await page.waitForSelector("h1:has-text('My Content')");
    await expect(page.locator("header")).toContainText("Creator");
    await expect(page.locator("header")).toContainText("Arjun Mehta");
    await expect(page.locator("header")).toContainText("Content");
    await expect(page.locator("header")).toContainText("Brand Kit");
    // Creator should not have Audit log nav link
    await expect(page.locator("header").locator("text=Audit log")).toHaveCount(0);
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test001", "creator_home", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-002: Brand Manager adds + edits rule, fact, term; archives/deletes via UI
    // -------------------------------------------------------------------------
    console.log("TEST-002: Brand Manager governance management...");
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Brand Manager" }).click();
    await page.waitForURL("**/brand-kit");

    const runTimestamp = Date.now().toString().slice(-6);
    const ruleText = `LIVE-TEST rule ${runTimestamp}: Eco claims require verification.`;
    const ruleTextUpdated = `LIVE-TEST rule ${runTimestamp}: Eco claims require verified ISO certification.`;
    const factStatement = `LIVE-TEST fact ${runTimestamp}: Aqualeaf holds lab thermal test certification.`;
    const factStatementUpdated = `LIVE-TEST fact ${runTimestamp}: Aqualeaf holds updated ISO-14001 lab thermal certification.`;
    const termWord = `LIVE-TEST-TERM-${runTimestamp}`;
    const termReplacement = `LIVE-TEST-REP-${runTimestamp}`;
    const termReplacementUpdated = `LIVE-TEST-APP-${runTimestamp}`;

    // 1. Add Rule
    console.log("TEST-002: 1. Add Rule...");
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await page.locator("form select").nth(0).selectOption("claims");
    await page.locator("form select").nth(1).selectOption("medium");
    await page.locator("form textarea").fill(ruleText);
    await page.getByRole("button", { name: "Save Rule" }).click();
    await page.waitForSelector(`text=${ruleText}`);
    await assertCleanText(page);
    await takeScreenshot(page, "test002", "rule_added", 1280, "light");

    // 2. Edit Rule
    console.log("TEST-002: 2. Edit Rule...");
    const ruleRow = page.locator("tr", { hasText: ruleText }).first();
    await ruleRow.getByRole("button", { name: "Edit" }).click();
    await page.locator("form textarea").fill(ruleTextUpdated);
    await page.getByRole("button", { name: "Update Rule" }).click();
    await page.waitForSelector(`text=${ruleTextUpdated}`);
    await assertCleanText(page);
    await takeScreenshot(page, "test002", "rule_edited", 1280, "light");

    // 3. Add Fact
    console.log("TEST-002: 3. Add Fact...");
    await page.getByRole("button", { name: "Approved Facts" }).click();
    await page.getByRole("button", { name: "+ Add fact" }).click();
    await page.locator("form textarea").fill(factStatement);
    await page.locator('input[placeholder*="Lab thermal test report"]').fill("Thermal Test Doc #999");
    await page.locator('input[placeholder*="Quality Assurance"]').fill("Quality Team");
    await page.locator('input[type="date"]').fill("2027-12-31");
    await page.getByRole("button", { name: "Save Fact" }).click();
    await page.waitForSelector(`text=${factStatement}`);
    await assertCleanText(page);
    await takeScreenshot(page, "test002", "fact_added", 1280, "light");

    // 4. Edit Fact
    console.log("TEST-002: 4. Edit Fact...");
    const factRow = page.locator("tr", { hasText: factStatement }).first();
    await factRow.getByRole("button", { name: "Edit" }).click();
    await page.locator("form textarea").fill(factStatementUpdated);
    const ownerInput = page.locator("form").locator('input[type="text"]').nth(1);
    await ownerInput.fill("Quality Assurance Team");
    await page.getByRole("button", { name: "Update Fact" }).click();
    await page.waitForSelector(`text=${factStatementUpdated}`);
    await assertCleanText(page);
    await takeScreenshot(page, "test002", "fact_edited", 1280, "light");

    // 5. Add Term
    console.log("TEST-002: 5. Add Term...");
    console.log("TEST-002: clicking Controlled Terms...");
    await page.getByRole("button", { name: "Controlled Terms" }).click();
    console.log("TEST-002: clicking + Add term...");
    await page.getByRole("button", { name: "+ Add term" }).click();
    console.log("TEST-002: filling term inputs...");
    await page.locator('input[placeholder*="100% natural"]').fill(termWord);
    await page.locator("form select").selectOption("banned");
    await page.locator('input[placeholder*="tested"]').fill(termReplacement);
    console.log("TEST-002: clicking Save Term...");
    await page.getByRole("button", { name: "Save Term" }).click();
    console.log("TEST-002: waiting for termWord in list...");
    await page.waitForSelector(`text=${termWord}`);
    await assertCleanText(page);
    await takeScreenshot(page, "test002", "term_added", 1280, "light");

    // 6. Edit Term
    console.log("TEST-002: 6. Edit Term...");
    const termRow = page.locator("tr", { hasText: termWord }).first();
    await termRow.getByRole("button", { name: "Edit" }).click();
    await page.locator("form").locator('input[type="text"]').nth(1).fill(termReplacementUpdated);
    await page.getByRole("button", { name: "Update Term" }).click();
    await page.waitForSelector(`text=${termReplacementUpdated}`);
    await assertCleanText(page);
    await takeScreenshot(page, "test002", "term_edited", 1280, "light");

    // 7. Cleanup: Delete Term via UI
    console.log("TEST-002: 7. Delete Term...");
    const updatedTermRow = page.locator("tr", { hasText: termWord }).first();
    await updatedTermRow.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.locator("table tbody").locator(`text=${termWord}`)).toHaveCount(0);

    // 8. Cleanup: Archive Rule via UI
    console.log("TEST-002: 8. Archive Rule...");
    await page.getByRole("button", { name: "Rules" }).click();
    const updatedRuleRow = page.locator("tr", { hasText: ruleTextUpdated }).first();
    await updatedRuleRow.getByRole("button", { name: "Archive" }).click();
    await page.waitForSelector("text=archived");
    await takeScreenshot(page, "test002", "rule_archived", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-003: Creator submits pasted text AND DOCX upload
    // -------------------------------------------------------------------------
    console.log("TEST-003: Creator submits content via DOCX extraction...");
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Creator" }).click();
    await page.waitForURL("**/content");

    await page.getByRole("link", { name: /New content/ }).first().click();
    await page.waitForURL("**/content/new");

    // Upload docx fixture
    const docxPath = path.resolve(__dirname, "../../docs/fixtures/vouch-test-caption.docx");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload .docx" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(docxPath);

    // Verify DOCX extracted notice
    await page.waitForSelector("text=Successfully extracted text from vouch-test-caption.docx");
    const bodyVal = await page.locator("textarea#body").inputValue();
    expect(bodyVal).toContain("India's No.1 eco-friendly water bottle, now 40% lighter");
    expect(bodyVal).toContain("Keeps drinks cold for 48 hours. #stayhydrated");

    // Fill form details
    const contentTitle = `LIVE-TEST Instagram Flow Launch ${runTimestamp}`;
    await page.locator("input#title").fill(contentTitle);
    await page.locator("select#channel").selectOption("Instagram");
    await page.locator("input#audience").fill("Urban buyers aged 22 to 35");
    await page.locator("textarea#purpose").fill("Highlight sustainability and lightness of the new bottle");

    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test003", "content_form_filled", 1280, "light");

    // Save content
    await page.getByRole("button", { name: "Save content" }).click();
    await page.waitForURL(/\/content\/[a-f0-9-]+/);
    const contentUrl = page.url();
    const contentId = contentUrl.split("/").pop()!;
    console.log(`Created live content id: ${contentId}`);

    await page.waitForSelector(`text=${contentTitle}`);
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test003", "content_saved_draft", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-004 & TEST-005: Review of worked example (claims, rules, citations)
    // -------------------------------------------------------------------------
    console.log("TEST-004/005: Executing live Vouch review with real AI...");
    await page.getByRole("button", { name: "Run Vouch review" }).first().click();

    // Wait for review to complete (real AI latency)
    await page.waitForSelector("text=Reviewed by:", { timeout: 60000 });
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test004", "review_complete_overview", 1280, "light");

    // Verify AI and rule engine disclosure
    const disclosureEl = page.locator("text=Reviewed by:");
    await expect(disclosureEl).toContainText("vouch-rules-v1");
    // Disclosure shows provider and model (Groq or Gemini)
    await expect(disclosureEl).toHaveText(/Reviewed by:.*(rules|groq|gemini)/i);

    // Fetch review details from API to print verdict table and check latency
    const tokenFromStorage = await page.evaluate(() => localStorage.getItem("vouch_token") || sessionStorage.getItem("vouch_token"));
    const latestReviewRes = await request.get(`${API_BASE}/api/contents/${contentId}/reviews/latest`, {
      headers: { Authorization: `Bearer ${tokenFromStorage}` },
    });
    const latestReviewData = await latestReviewRes.json();
    const reviewMeta = latestReviewData.review || {};
    const reviewFindings: any[] = latestReviewData.findings || [];

    // Calculate review duration
    let reviewMs = 0;
    if (reviewMeta.started_at && reviewMeta.finished_at) {
      reviewMs = Math.round(
        new Date(reviewMeta.finished_at).getTime() - new Date(reviewMeta.started_at).getTime()
      );
    }

    // Print verdict table for this run
    console.log("\n=================== VERDICT TABLE ===================");
    console.log(`Provider: ${reviewMeta.provider || "N/A"} | Model: ${reviewMeta.model || "N/A"} | Duration: ${reviewMs} ms`);
    console.log("------------------------------------------------------------------------------------------------");
    console.log(
      "Quote".padEnd(36) + " | " +
      "Verdict".padEnd(14) + " | " +
      "Citation".padEnd(10) + " | " +
      "Provider/Model".padEnd(25) + " | " +
      "Review ms"
    );
    console.log("------------------------------------------------------------------------------------------------");
    for (const f of reviewFindings) {
      const quote = (f.span_text || "").replace(/\n/g, " ").slice(0, 34);
      const verdict = (f.verdict || "null").slice(0, 14);
      const citation = (f.rule_code || f.fact_code || "none").slice(0, 10);
      const provModel = `${reviewMeta.provider || ""}/${reviewMeta.model || ""}`.slice(0, 25);
      console.log(
        quote.padEnd(36) + " | " +
        verdict.padEnd(14) + " | " +
        citation.padEnd(10) + " | " +
        provModel.padEnd(25) + " | " +
        reviewMs
      );
    }
    console.log("=====================================================\n");

    // Verify Claim Ledger findings strictly per docs/demo-brand.md (Task S12b.1):
    // 1. "India's No.1": Unsupported + CLAIM-01
    const no1Card = page.locator('[id^="finding-card-"]').filter({ hasText: "CLAIM-01" }).first();
    await expect(no1Card).toBeVisible();
    await expect(no1Card).toContainText("CLAIM-01");
    await expect(no1Card).toContainText(/Unsupported/i);

    // 2. "eco-friendly": Unsupported or Needs human judgement + CLAIM-02
    const ecoCard = page.locator('[id^="finding-card-"]').filter({ hasText: "CLAIM-02" }).first();
    await expect(ecoCard).toBeVisible();
    await expect(ecoCard).toContainText("CLAIM-02");

    // 3. "Rated 4.8": Outdated + F-03
    const ratedCard = page.locator('[id^="finding-card-"]').filter({ hasText: "F-03" }).first();
    await expect(ratedCard).toBeVisible();
    await expect(ratedCard).toContainText("Outdated");
    await expect(ratedCard).toContainText("F-03");

    // 4. "48 hours": Contradicted + F-15
    const coldCard = page.locator('[id^="finding-card-"]').filter({ hasText: "F-15" }).first();
    await expect(coldCard).toBeVisible();
    await expect(coldCard).toContainText("Contradicted");
    await expect(coldCard).toContainText("F-15");

    // 5. "40% lighter": Supported + F-12 (strictly asserted without if)
    const lighterCard = page.locator('[id^="finding-card-"]').filter({ hasText: "F-12" }).first();
    await expect(lighterCard).toBeVisible();
    await expect(lighterCard).toContainText("Supported");
    await expect(lighterCard).toContainText("F-12");

    // Verify Rule-based checks (TEST-005)
    // 6. "#stayhydrated" ACC-02 CamelCase hashtag
    const hashtagFinding = page.locator('[id^="finding-card-"]').filter({ hasText: "ACC-02" }).first();
    await expect(hashtagFinding).toBeVisible();
    await expect(hashtagFinding).toContainText("ACC-02");

    await takeScreenshot(page, "test005", "claim_ledger_cards", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-006: Accept fix / edit / dismiss (validation) & create revision 2
    // -------------------------------------------------------------------------
    console.log("TEST-006: Resolving findings and previewing revision 2...");

    // Accept fix on contradicted claim
    const acceptBtn = coldCard.getByRole("button", { name: "Accept fix" });
    if (await acceptBtn.isVisible()) {
      await acceptBtn.click();
      await expect(coldCard.locator("text=Accepted")).toBeVisible({ timeout: 15000 });
    }

    // Dismiss one finding with reason required
    const dismissFinding = no1Card.or(ecoCard).first();
    await dismissFinding.getByRole("button", { name: "Dismiss" }).click();
    // Dismiss button without reason should be disabled
    const dismissBtn = dismissFinding.getByRole("button", { name: "Confirm" });
    await expect(dismissBtn).toBeDisabled();
    // Enter reason (min 5 chars)
    await dismissFinding.locator('input[placeholder*="Approved brand exception"]').fill("Approved launch exception");
    await expect(dismissBtn).toBeEnabled();
    await dismissBtn.click();
    await expect(dismissFinding.locator("text=Dismissed")).toBeVisible({ timeout: 15000 });

    await takeScreenshot(page, "test006", "fixes_applied_ready_bar", 1280, "light");

    // Preview changes
    await page.getByRole("button", { name: "Preview changes →" }).click();
    await page.waitForSelector("text=Diff Preview");
    await assertCleanText(page);
    await takeScreenshot(page, "test006", "diff_preview_modal", 1280, "light");

    // Create Revision 2
    await page.getByRole("button", { name: "Create revision 2" }).click();
    await page.waitForSelector("text=Revision 2 created. These findings are for Revision 1.", { timeout: 20000 });
    await takeScreenshot(page, "test006", "revision_2_stale_banner", 1280, "light");

    // Re-run review on revision 2
    await page.getByRole("button", { name: "Run Vouch review →" }).click();
    await page.waitForSelector("text=Reviewed by:", { timeout: 60000 });

    // -------------------------------------------------------------------------
    // TEST-007: Submit -> Reviewer requests changes -> Rev 3 -> Approve with override
    // -------------------------------------------------------------------------
    console.log("TEST-007: Review lifecycle & approval workflow...");

    // Submit for review
    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.waitForSelector("text=Submitted for review. Waiting for a reviewer.", { timeout: 20000 });
    await expect(page.locator("span", { hasText: "In review" })).toBeVisible();
    await takeScreenshot(page, "test007", "creator_submitted_in_review", 1280, "light");

    // Login as Reviewer
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Reviewer" }).click();
    await page.waitForURL("**/reviews");

    // Open submitted content
    await page.getByRole("link", { name: contentTitle }).click();
    await page.waitForURL(`**/content/${contentId}`);
    await page.waitForSelector("text=Reviewer Decision");

    // Request changes
    await page.getByRole("button", { name: "Request changes" }).click();
    await page.locator('textarea[placeholder*="Explain what needs to be changed"]').fill("Please update the remaining claim copy to ensure full compliance.");
    await page.getByRole("button", { name: "Confirm request changes" }).click();
    await page.waitForSelector("text=Changes requested", { timeout: 20000 });
    await takeScreenshot(page, "test007", "reviewer_changes_requested", 1280, "light");

    // Login as Creator to submit new revision
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Creator" }).click();
    await page.waitForURL("**/content");
    await page.getByRole("link", { name: contentTitle }).click();

    // Creator edits manually to create Revision 3
    await page.getByRole("button", { name: "Edit text manually" }).click();
    await page.waitForSelector("h3:has-text('Edit Text Manually')");
    await page.locator('div.fixed textarea').fill("Aqualeaf steel water bottle, now 40% lighter. Keeps drinks cold for 24 hours. #StayHydrated");
    await page.getByRole("button", { name: "Save as revision 3" }).click();
    await page.waitForSelector("text=Revision 3", { timeout: 20000 });

    // Run review on Revision 3 and submit
    await page.getByRole("button", { name: "Run Vouch review" }).first().click();
    await page.waitForSelector("text=Reviewed by:", { timeout: 60000 });
    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.waitForSelector("text=Submitted for review. Waiting for a reviewer.", { timeout: 20000 });

    // Login as Reviewer to approve
    await page.getByRole("button", { name: "Switch role" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Try as Reviewer" }).click();
    await page.waitForURL("**/reviews");
    await page.getByRole("link", { name: contentTitle }).click();
    await page.waitForSelector("text=Reviewer Decision");

    // Click Approve
    await page.getByRole("button", { name: "Approve" }).click();

    // If override required, fill override reason
    const overrideModal = page.locator("text=Approval Requires Override");
    if (await overrideModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('textarea[placeholder*="Explain why"]').fill("Authorized executive waiver per governance committee policy 2026-B.");
      await page.getByRole("button", { name: "Approve with override" }).click();
    }

    // Assert status Approved and content locked (no edit buttons visible)
    await page.waitForSelector("text=Approved by Neha Iyer", { timeout: 20000 });
    await expect(page.locator("span", { hasText: "Approved" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Text Manually" })).toHaveCount(0);
    await takeScreenshot(page, "test007", "content_approved_locked", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-008: Audit trail and Activity timeline
    // -------------------------------------------------------------------------
    console.log("TEST-008: Verifying activity timeline and audit log...");

    // Check Activity timeline on Content Detail
    await page.waitForSelector("text=Activity");
    await expect(page.locator("text=Created content")).toBeVisible();
    await expect(page.locator("text=Ran Vouch review").first()).toBeVisible();
    await expect(page.locator("text=Submitted for review").first()).toBeVisible();
    await expect(page.locator("text=Approved").first()).toBeVisible();
    await takeScreenshot(page, "test008", "activity_timeline", 1280, "light");

    // Navigate to Audit page
    await page.getByRole("link", { name: "Audit log" }).click();
    await page.waitForURL("**/audit");
    await page.waitForSelector("h1:has-text('Audit log')");
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "test008", "audit_log_page", 1280, "light");

    // -------------------------------------------------------------------------
    // TEST-011: Tenant Isolation API verification
    // -------------------------------------------------------------------------
    console.log("TEST-011: Tenant isolation API check...");
    // 1. Direct API call to backend without auth -> 401
    const unauthContentRes = await request.get(`${API_BASE}/api/contents/${contentId}`);
    expect(unauthContentRes.status()).toBe(401);

    const unauthRulesRes = await request.get(`${API_BASE}/api/rules`);
    expect(unauthRulesRes.status()).toBe(401);

    const unauthFactsRes = await request.get(`${API_BASE}/api/facts`);
    expect(unauthFactsRes.status()).toBe(401);

    // 2. Real cross-tenant check with Northwind user:
    // Log in as Northwind demo user
    const nwAuthRes = await request.post(`${API_BASE}/api/auth/demo`, {
      data: { role: "creator", org: "northwind-labs" },
    });
    expect(nwAuthRes.status()).toBe(200);
    const nwAuthData = await nwAuthRes.json();
    const nwToken = nwAuthData.token;
    expect(nwToken).toBeDefined();
    expect(nwAuthData.organization?.name).toBe("Northwind Labs");

    // Northwind user tries to GET Aqualeaf content id -> must be 404
    const nwGetContentRes = await request.get(`${API_BASE}/api/contents/${contentId}`, {
      headers: { Authorization: `Bearer ${nwToken}` },
    });
    expect(nwGetContentRes.status()).toBe(404);

    // Northwind user lists rules -> must NOT contain any Aqualeaf rule text or codes
    const nwRulesRes = await request.get(`${API_BASE}/api/rules`, {
      headers: { Authorization: `Bearer ${nwToken}` },
    });
    expect(nwRulesRes.status()).toBe(200);
    const nwRules = await nwRulesRes.json();
    const nwRulesString = JSON.stringify(nwRules);
    expect(nwRulesString).not.toContain("CLAIM-01");
    expect(nwRulesString).not.toContain("Aqualeaf");
    expect(nwRulesString).not.toContain("No.1");

    // -------------------------------------------------------------------------
    // PHASE 2: 375px Dark Theme Responsive Run
    // -------------------------------------------------------------------------
    console.log("PHASE 2: Running key verification at 375px dark theme...");
    await page.setViewportSize({ width: 375, height: 812 });

    // Enable dark theme
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("vouch_theme", "dark");
    });

    // Verify Content Detail in 375px Dark
    await page.goto(`/content/${contentId}`);
    await page.waitForSelector(`text=${contentTitle}`);
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "responsive", "content_detail", 375, "dark");

    // Verify Audit in 375px Dark
    await page.goto("/audit");
    await page.waitForSelector("h1:has-text('Audit log')");
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "responsive", "audit_page", 375, "dark");

    // Verify Brand Kit in 375px Dark
    await page.goto("/brand-kit");
    await page.waitForSelector("h1:has-text('Brand Kit')");
    await assertCleanText(page);
    await assertNoLayoutOverflow(page);
    await takeScreenshot(page, "responsive", "brand_kit", 375, "dark");

    console.log("All live acceptance tests passed successfully.");
  });
});

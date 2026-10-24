import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const API = "http://api.test";
const CONTENT_ID = "fd4ebc26-03e0-40d9-8a7b-5895dc216974";
const BODY = "India's No.1 eco-friendly water bottle, now 40% lighter.";

const LONG_TITLE =
  "Aqualeaf Pure Spring Water Edition 2026 - Comprehensive Multi-Channel Influencer Campaign Announcement (Official Launch Copy)";
const LONG_PURPOSE =
  "Comprehensive multi-tier brand awareness and product launch across digital, social, and print channels";
const LONG_AUDIENCE =
  "Eco-conscious urban young professionals and fitness enthusiasts in Tier-1 metropolitan cities";
const LONG_COMMENT =
  "The term No.1 cannot be substantiated without the Bureau of Indian Standards certificate number and the June 2026 consumer benchmark survey documentation clearly referenced.";
const LONG_OVERRIDE =
  "Authorized exceptional waiver by Vice President of Brand Governance Priya Sharma per Executive Committee Resolution EC-2026-88 pending final audit certification.";

// AGENTS.md 7d.2: assertCleanText must also fail on:
// Unknown, Invalid Date, NaN, undefined, null, [object Object], and raw JSON ({" ) in visible text.
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

    // Check table overflow if table exists on page
    const tableOverflow = await page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) return false;
      return table.scrollWidth > table.clientWidth;
    });
    expect(
      tableOverflow,
      `Table horizontal overflow at ${width}px (${contextLabel})`,
    ).toBe(false);
  }
}

test.describe("Approval workflow UI, Activity timeline, and Audit log (S10c) E2E", () => {
  const screenshotsDir = path.join(process.cwd(), "e2e", "screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Complete approval workflow, polish, layout at 1280/1440px, speed budget, and in-review lock", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Mock state
    let contentStatus = "draft";
    let hasReview = false;
    let currentUserRole = "creator"; // 'creator' | 'reviewer'
    let requestedBeforeCursor: string | null = null;

    const creatorUser = {
      id: "56ce36a5-bab2-4042-8290-f999e3d0437d",
      name: "Arjun Mehta",
      email: "demo.creator@aqualeaf.test",
      role: "creator",
    };

    const reviewerUser = {
      id: "8c321adb-119b-403b-8b2a-2bdfb3fad344",
      name: "Neha Iyer",
      email: "demo.reviewer@aqualeaf.test",
      role: "reviewer",
    };

    const org = {
      id: "998d3d5a-8015-469f-ae6d-3877d47366c6",
      name: "Aqualeaf",
    };

    const buildContentDetail = (status: string) => ({
      id: CONTENT_ID,
      organization_id: org.id,
      title: LONG_TITLE,
      channel: "Instagram",
      audience: LONG_AUDIENCE,
      purpose: LONG_PURPOSE,
      status,
      created_by: creatorUser.id,
      created_by_name: creatorUser.name,
      created_at: "2026-10-23T04:00:00.000Z",
      updated_at: "2026-10-23T04:30:00.000Z",
      revisions: [
        {
          id: "7b233a1e-8422-488b-a7e8-54b9f029341c",
          n: 1,
          body: BODY,
          created_by: creatorUser.id,
          created_by_name: creatorUser.name,
          created_at: "2026-10-23T04:00:00.000Z",
        },
      ],
    });

    const review = {
      id: "3a218d89-9811-4a25-a1c2-901b2c45e891",
      organization_id: org.id,
      revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      started_at: "2026-10-23T04:00:01.000Z",
      finished_at: "2026-10-23T04:00:03.000Z",
      created_at: "2026-10-23T04:00:03.000Z",
      ai_status: "ok",
      ai_provider: "groq",
      ai_model: "openai/gpt-oss-120b",
      ai_latency_ms: 2500,
    };

    const findings = [
      {
        id: "f1",
        organization_id: org.id,
        review_id: review.id,
        kind: "term",
        span_text: "No.1",
        start_offset: BODY.indexOf("No.1"),
        end_offset: BODY.indexOf("No.1") + 4,
        verdict: null,
        fact_code: null,
        fact_statement: null,
        fact_valid_until: null,
        rule_id: "r-term-01",
        rule_code: "TERM-01",
        rule_text: "Do not use unverified superlative claims such as No.1 or Best.",
        reason: "Banned superlative without certification",
        severity: "high",
        confidence: 0.95,
        suggested_fix: "leading",
        replacement_text: null,
        resolution: "open",
        dismiss_reason: null,
        created_at: "2026-10-23T04:00:03.000Z",
      },
      {
        id: "f2",
        organization_id: org.id,
        review_id: review.id,
        kind: "claim",
        span_text: "40% lighter",
        start_offset: BODY.indexOf("40% lighter"),
        end_offset: BODY.indexOf("40% lighter") + 11,
        verdict: "supported",
        fact_code: "F-12",
        fact_statement: "Aqualeaf bottle weight is 180g, 40% lighter than standard 300g stainless bottles.",
        fact_valid_until: "2027-06-30",
        rule_id: "r-claim-01",
        rule_code: "CLAIM-01",
        rule_text: "Every claim must cite verified brand kit facts",
        reason: "Claim verified against Fact F-12",
        severity: "low",
        confidence: 0.99,
        suggested_fix: null,
        replacement_text: null,
        resolution: "open",
        dismiss_reason: null,
        created_at: "2026-10-23T04:00:03.000Z",
      },
    ];

    const activityTimeline: any[] = [
      {
        id: "act-1",
        action: "contents.create",
        actor: creatorUser.id,
        actor_name: creatorUser.name,
        time: "2026-10-23T04:00:00.000Z",
        details: { title: LONG_TITLE, channel: "Instagram" },
      },
    ];

    // Mock network routes
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

      if (method === "OPTIONS") {
        return jsonFulfill({});
      }

      if (url.endsWith("/api/auth/me")) {
        const u = currentUserRole === "creator" ? creatorUser : reviewerUser;
        return jsonFulfill({ user: u, organization: org });
      }

      if (url.endsWith("/api/contents")) {
        return jsonFulfill([buildContentDetail(contentStatus)]);
      }

      if (url.endsWith(`/api/contents/${CONTENT_ID}`)) {
        return jsonFulfill(buildContentDetail(contentStatus));
      }

      if (url.endsWith(`/api/contents/${CONTENT_ID}/reviews/latest`)) {
        if (!hasReview) {
          return jsonFulfill({ error: "not_found" }, 404);
        }
        return jsonFulfill({ review, findings });
      }

      if (url.endsWith(`/api/contents/${CONTENT_ID}/reviews`) && method === "POST") {
        hasReview = true;
        activityTimeline.push({
          id: "act-rev",
          action: "review.run",
          actor: creatorUser.id,
          actor_name: creatorUser.name,
          time: "2026-10-23T04:05:00.000Z",
          details: { revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c", findings_count: 2, ai_status: "ok" },
        });
        return jsonFulfill({ review, findings });
      }

      // AGENTS 7e.4: Delay activity response by 3s to verify UI speed budget (< 1s from write response)
      if (url.endsWith(`/api/contents/${CONTENT_ID}/activity`)) {
        await new Promise((r) => setTimeout(r, 3000));
        return jsonFulfill({ activity: activityTimeline });
      }

      if (url.endsWith(`/api/contents/${CONTENT_ID}/submit`) && method === "POST") {
        if (!hasReview) {
          return jsonFulfill({ error: "review_required" }, 409);
        }
        contentStatus = "in_review";
        activityTimeline.push({
          id: "act-sub",
          action: "content.submit",
          actor: creatorUser.id,
          actor_name: creatorUser.name,
          time: "2026-10-23T04:10:00.000Z",
          details: { revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c" },
        });
        return jsonFulfill({
          content: buildContentDetail("in_review"),
        });
      }

      if (url.endsWith(`/api/contents/${CONTENT_ID}/decision`) && method === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        if (body.decision === "request_changes") {
          contentStatus = "changes_requested";
          activityTimeline.push({
            id: "act-req",
            action: "content.request_changes",
            actor: reviewerUser.id,
            actor_name: reviewerUser.name,
            time: "2026-10-23T04:15:00.000Z",
            details: { revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c", comment: body.comment },
          });
          return jsonFulfill({
            content: buildContentDetail("changes_requested"),
            approval: {
              decision: "changes_requested",
              user_id: reviewerUser.id,
            },
          });
        }
        if (body.decision === "approve") {
          if (!body.override_reason) {
            return jsonFulfill({ error: "override_required", open_high: 1, ai_status: "ok" }, 409);
          }
          contentStatus = "approved";
          activityTimeline.push({
            id: "act-appr",
            action: "content.approve",
            actor: reviewerUser.id,
            actor_name: reviewerUser.name,
            time: "2026-10-23T04:20:00.000Z",
            details: { revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c", override_reason: body.override_reason },
          });
          return jsonFulfill({
            content: buildContentDetail("approved"),
            approval: {
              decision: "approved",
              user_id: reviewerUser.id,
              override_reason: body.override_reason,
            },
          });
        }
      }

      if (url.includes("/api/audit/actions")) {
        return jsonFulfill({
          actions: [
            "content.submit",
            "content.request_changes",
            "contents.create",
            "rules.import",
            "auth.demo_login",
          ],
        });
      }

      const matchAudit = url.match(/\/api\/audit(\?.*)?$/);
      if (matchAudit) {
        const parsedUrl = new URL(url);
        const beforeParam = parsedUrl.searchParams.get("before");
        if (beforeParam) {
          requestedBeforeCursor = beforeParam;
          return jsonFulfill({
            events: [
              {
                id: "ae3",
                organization_id: org.id,
                actor: creatorUser.id,
                actor_name: creatorUser.name,
                action: "contents.create",
                entity: `content:${CONTENT_ID}`,
                payload: { title: LONG_TITLE, channel: "Instagram" },
                at: "2026-10-23T04:00:00.000Z",
              },
            ],
            next_cursor: null,
          });
        }
        return jsonFulfill({
          events: [
            {
              id: "ae1",
              organization_id: org.id,
              actor: creatorUser.id,
              actor_name: creatorUser.name,
              action: "content.submit",
              entity: `content:${CONTENT_ID}`,
              payload: { content_id: CONTENT_ID, revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c" },
              at: "2026-10-23T04:10:00.000Z",
            },
            {
              id: "ae2",
              organization_id: org.id,
              actor: reviewerUser.id,
              actor_name: reviewerUser.name,
              action: "content.request_changes",
              entity: `content:${CONTENT_ID}`,
              payload: {
                content_id: CONTENT_ID,
                revision_id: "7b233a1e-8422-488b-a7e8-54b9f029341c",
                comment: LONG_COMMENT,
              },
              at: "2026-10-23T04:05:00.000Z",
            },
          ],
          next_cursor: "2026-10-23T04:05:00.000Z|ae2",
        });
      }

      return jsonFulfill({ error: "not_found" }, 404);
    });

    // Seed session cache for creator
    await page.addInitScript(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "test-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: creatorUser, org },
    );

    // =========================================================================
    // Step 1: Submit disabled before review -> enabled after; header action row layout
    // =========================================================================
    await page.goto(`/content/${CONTENT_ID}`);
    await page.waitForSelector(`h1:has-text('Aqualeaf Pure Spring Water')`);

    // Verify layout at 1280 and 1440 px
    await assertNoHorizontalOverflow(page, "Step 1 Content Detail");

    const submitBtn = page.locator("button:has-text('Submit for review')");
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    // S10c: Hint below the action row in small grey text
    const hintLocator = page.locator("text=Run Vouch review on the latest revision first");
    await expect(hintLocator).toBeVisible();
    await expect(hintLocator).toHaveClass(/text-slate-500/);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step1_submit_disabled_before_review.png"),
      fullPage: true,
    });

    // Click Run Vouch review
    const runReviewBtn = page.locator("button:has-text('Run Vouch review')");
    await runReviewBtn.click();
    await page.waitForSelector("text=95% confidence");

    // Submit button should now be enabled and hint gone
    await expect(submitBtn).toBeEnabled();
    await expect(
      page.locator("text=Run Vouch review on the latest revision first"),
    ).toHaveCount(0);

    // Verify findings rendered cleanly
    await expect(page.locator("span:has-text('1 supported as proof')")).toBeVisible();
    await expect(page.locator("span:has-text('TERM-01')")).toBeVisible();
    await expect(page.locator("text=95% confidence")).toBeVisible();

    await assertCleanText(page);

    // =========================================================================
    // Step 2: Creator submit -> In review badge and locked state (S10c)
    // =========================================================================
    await submitBtn.click();
    await page.waitForSelector("span:has-text('In review')");

    // S10c: Neutral banner for in_review creator
    await expect(
      page.locator("text=Submitted for review. Waiting for a reviewer."),
    ).toBeVisible();

    // S13a: Verify Draft Body text, Revision badge, Revision history, and AI disclosure remain visible after submit
    await expect(page.locator("text=India's No.1 eco-friendly water bottle")).toBeVisible();
    await expect(page.locator("text=Revision 1").first()).toBeVisible();
    await expect(page.locator("text=Revision History")).toBeVisible();
    await expect(page.locator("text=Reviewed by:")).toContainText("vouch-rules-v1");
    await expect(page.locator("text=Reviewed by:")).toContainText("groq");

    // S10c: Creator in review has NO editing / resolving / submitting buttons
    await expect(page.locator("button:has-text('Submit for review')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Run Vouch review')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Accept fix')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Edit text manually')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Preview changes')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Dismiss')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Change')")).toHaveCount(0);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step2_creator_submitted_in_review.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 3: Creator cannot see Audit log link & gets redirected from /audit
    // =========================================================================
    await expect(page.locator("header nav a:has-text('Audit log')")).toHaveCount(0);

    // Direct access redirect test
    await page.goto("/audit");
    await page.waitForURL("**/content**");
    await expect(page.locator("header nav a:has-text('Audit log')")).toHaveCount(0);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step3_creator_no_audit_link.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 4: Reviewer requests changes with comment validation
    // =========================================================================
    currentUserRole = "reviewer";
    await page.evaluate(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: reviewerUser, org },
    );

    await page.goto(`/content/${CONTENT_ID}`);
    await page.waitForSelector("text=Reviewer Decision");

    // Reviewer Decision panel visible
    await expect(page.locator("text=Reviewer Decision")).toBeVisible();
    const reqChangesBtn = page.locator("button:has-text('Request changes')");
    await expect(reqChangesBtn).toBeVisible();

    // Click Request changes to open textarea
    await reqChangesBtn.click();
    const commentInput = page.locator("textarea[placeholder*='Explain what needs to be changed']");
    await expect(commentInput).toBeVisible();

    const confirmReqBtn = page.locator("button:has-text('Confirm request changes')");
    await expect(confirmReqBtn).toBeDisabled();

    // Type < 5 chars
    await commentInput.fill("Bad");
    await expect(confirmReqBtn).toBeDisabled();

    // Type valid long comment
    await commentInput.fill(LONG_COMMENT);
    await expect(confirmReqBtn).toBeEnabled();

    // Confirm request changes
    await confirmReqBtn.click();
    await page.waitForSelector("span:has-text('Changes requested')");
    await expect(page.locator("text=Changes requested by Neha Iyer")).toBeVisible();
    await expect(page.locator(`text="${LONG_COMMENT}"`)).toBeVisible();

    // S13a: Verify Draft Body text, Revision badge, Revision history, and AI disclosure remain visible after request_changes
    await expect(page.locator("text=India's No.1 eco-friendly water bottle")).toBeVisible();
    await expect(page.locator("text=Revision 1").first()).toBeVisible();
    await expect(page.locator("text=Revision History")).toBeVisible();
    await expect(page.locator("text=Reviewed by:")).toContainText("vouch-rules-v1");
    await expect(page.locator("text=Reviewed by:")).toContainText("groq");

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step4_reviewer_requested_changes.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 5: Reviewer approve -> 409 override_required -> dialog -> approve with override (Speed check: < 1s)
    // =========================================================================
    contentStatus = "in_review";
    await page.goto(`/content/${CONTENT_ID}`);
    await page.waitForSelector("text=Reviewer Decision");

    const approveBtn = page.locator("button:has-text('Approve')");
    await approveBtn.click();

    // Dialog opens on 409 override_required
    await page.waitForSelector("text=Approval Requires Override");
    await expect(page.locator("text=1 high-severity issue still open")).toBeVisible();

    const approveWithOverrideBtn = page.locator("button:has-text('Approve with override')");
    await expect(approveWithOverrideBtn).toBeDisabled();

    const overrideInput = page.locator("textarea[placeholder*='Explain why this content is approved']");
    await overrideInput.fill("Too short");
    await expect(approveWithOverrideBtn).toBeDisabled();

    await overrideInput.fill(LONG_OVERRIDE);
    await expect(approveWithOverrideBtn).toBeEnabled();

    // Confirm approval and test speed budget (AGENTS 7e.4: update visible within 1s, activity delayed by 3s)
    const approveStartTime = Date.now();
    await approveWithOverrideBtn.click();

    // Approved banner appears within 1000ms
    await page.waitForSelector("span:has-text('Approved by Neha Iyer')", { timeout: 1000 });
    const elapsedMs = Date.now() - approveStartTime;
    expect(elapsedMs).toBeLessThan(1000);

    await expect(
      page.locator(`text=(Override: ${LONG_OVERRIDE})`),
    ).toBeVisible();

    // S13a: Verify Draft Body text, Revision badge, Revision history, and AI disclosure remain visible after approve
    await expect(page.locator("text=India's No.1 eco-friendly water bottle")).toBeVisible();
    await expect(page.locator("text=Revision 1").first()).toBeVisible();
    await expect(page.locator("text=Revision History")).toBeVisible();
    await expect(page.locator("text=Reviewed by:")).toContainText("vouch-rules-v1");
    await expect(page.locator("text=Reviewed by:")).toContainText("groq");

    // Ensure all action buttons are hidden when approved
    await expect(page.locator("button:has-text('Run Vouch review')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Submit for review')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Approve')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Request changes')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Preview changes')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Edit text manually')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Accept fix')")).toHaveCount(0);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step5_approved_with_override.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 6: Activity timeline rendered with readable labels and shared date format
    // =========================================================================
    const activitySection = page.locator("h3:has-text('Activity')");
    await expect(activitySection).toBeVisible();

    await expect(page.locator("span:has-text('Created content')")).toBeVisible();
    await expect(page.locator("span:has-text('Ran Vouch review')")).toBeVisible();
    await expect(page.locator("span:has-text('Submitted for review')")).toBeVisible();
    await expect(page.locator("span:has-text('Requested changes')")).toBeVisible();
    await expect(page.locator("span:has-text('Approved with override')")).toBeVisible();

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step6_activity_timeline.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 7: /audit table with short entity, clamped details, and 1280/1440px layout
    // =========================================================================
    const auditLink = page.locator("header nav a:has-text('Audit log')");
    await expect(auditLink).toBeVisible();
    await auditLink.click();

    await page.waitForSelector("h1:has-text('Audit log')");

    // S13a: Verify active nav item "Audit log" has active styles matching other active items (bg-slate-900 text-white)
    await expect(auditLink).toHaveClass(/bg-slate-900.*text-white/);
    await expect(
      page.locator("text=Append-only system record of all governance events and decisions."),
    ).toBeVisible();

    // Layout check at 1280 and 1440 px on Audit page
    await assertNoHorizontalOverflow(page, "Step 7 Audit log page");

    // S10c: Entity shortened to "content · fd4ebc26"
    await expect(page.locator("text=content · fd4ebc26").first()).toBeVisible();

    // Verify initial Page 1 events
    const rowsInitial = page.locator("tbody tr");
    await expect(rowsInitial).toHaveCount(2);
    await expect(page.locator("span:has-text('content.submit')")).toBeVisible();
    await expect(page.locator("span:has-text('content.request_changes')")).toBeVisible();

    // Verify Load more button is visible on page 1
    const loadMoreBtn = page.locator("button:has-text('Load more')");
    await expect(loadMoreBtn).toBeVisible();
    await expect(loadMoreBtn).toBeEnabled();

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step7a_audit_log_page_with_load_more.png"),
      fullPage: true,
    });

    // Click Load more
    await loadMoreBtn.click();

    // Verify page 2 event loaded and appended
    await page.waitForSelector("span:has-text('contents.create')");
    const rowsAfter = page.locator("tbody tr");
    await expect(rowsAfter).toHaveCount(3);

    // Verify the API received the before cursor parameter
    expect(requestedBeforeCursor).toBe("2026-10-23T04:05:00.000Z|ae2");

    // "Load more" button disappears once next_cursor is null
    await expect(loadMoreBtn).toHaveCount(0);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step7b_audit_log_after_load_more.png"),
      fullPage: true,
    });

    expect(pageErrors).toEqual([]);
  });
});

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const API = "http://api.test";
const BODY = "India's No.1 eco-friendly water bottle, now 40% lighter.";

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

test.describe("Approval workflow UI, Activity timeline, and Audit log (S10b) E2E", () => {
  const screenshotsDir = path.join(process.cwd(), "e2e", "screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Complete approval workflow, activity timeline, and audit log with full realistic fields", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Mock state
    let contentStatus = "draft";
    let hasReview = false;
    let currentUserRole = "creator"; // 'creator' | 'reviewer' | 'brand_manager'
    let requestedBeforeCursor: string | null = null;

    const creatorUser = {
      id: "u1",
      name: "Arjun Mehta",
      email: "demo.creator@aqualeaf.test",
      role: "creator",
    };

    const reviewerUser = {
      id: "u2",
      name: "Neha Iyer",
      email: "demo.reviewer@aqualeaf.test",
      role: "reviewer",
    };

    const org = { id: "o1", name: "Aqualeaf" };

    const buildContentDetail = (status: string) => ({
      id: "c1",
      organization_id: "o1",
      title: "TEST-007 Workflow Post",
      channel: "Instagram",
      audience: "Eco-conscious consumers",
      purpose: "Product launch announcement",
      status,
      created_by: "u1",
      created_by_name: "Arjun Mehta",
      created_at: "2026-10-23T04:00:00.000Z",
      updated_at: "2026-10-23T04:30:00.000Z",
      revisions: [
        {
          id: "rev1",
          n: 1,
          body: BODY,
          created_by: "u1",
          created_by_name: "Arjun Mehta",
          created_at: "2026-10-23T04:00:00.000Z",
        },
      ],
    });

    const review = {
      id: "rw1",
      organization_id: "o1",
      revision_id: "rev1",
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
        organization_id: "o1",
        review_id: "rw1",
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
        organization_id: "o1",
        review_id: "rw1",
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
        actor: "u1",
        actor_name: "Arjun Mehta",
        time: "2026-10-23T04:00:00.000Z",
        details: { title: "TEST-007 Workflow Post", channel: "Instagram" },
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

      if (url.endsWith("/api/contents/c1")) {
        return jsonFulfill(buildContentDetail(contentStatus));
      }

      if (url.endsWith("/api/contents/c1/reviews/latest")) {
        if (!hasReview) {
          return jsonFulfill({ error: "not_found" }, 404);
        }
        return jsonFulfill({ review, findings });
      }

      if (url.endsWith("/api/contents/c1/reviews") && method === "POST") {
        hasReview = true;
        activityTimeline.push({
          id: "act-rev",
          action: "review.run",
          actor: "u1",
          actor_name: "Arjun Mehta",
          time: "2026-10-23T04:05:00.000Z",
          details: { revision_id: "rev1", findings_count: 2, ai_status: "ok" },
        });
        return jsonFulfill({ review, findings });
      }

      if (url.endsWith("/api/contents/c1/activity")) {
        return jsonFulfill({ activity: activityTimeline });
      }

      if (url.endsWith("/api/contents/c1/submit") && method === "POST") {
        if (!hasReview) {
          return jsonFulfill({ error: "review_required" }, 409);
        }
        contentStatus = "in_review";
        activityTimeline.push({
          id: "act-sub",
          action: "content.submit",
          actor: "u1",
          actor_name: "Arjun Mehta",
          time: "2026-10-23T04:10:00.000Z",
          details: { revision_id: "rev1" },
        });
        return jsonFulfill({
          content: buildContentDetail("in_review"),
        });
      }

      if (url.endsWith("/api/contents/c1/decision") && method === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        if (body.decision === "request_changes") {
          contentStatus = "changes_requested";
          activityTimeline.push({
            id: "act-req",
            action: "content.request_changes",
            actor: "u2",
            actor_name: "Neha Iyer",
            time: "2026-10-23T04:15:00.000Z",
            details: { revision_id: "rev1", comment: body.comment },
          });
          return jsonFulfill({
            content: buildContentDetail("changes_requested"),
            approval: {
              decision: "changes_requested",
              user_id: "u2",
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
            actor: "u2",
            actor_name: "Neha Iyer",
            time: "2026-10-23T04:20:00.000Z",
            details: { revision_id: "rev1", override_reason: body.override_reason },
          });
          return jsonFulfill({
            content: buildContentDetail("approved"),
            approval: {
              decision: "approved",
              user_id: "u2",
              override_reason: body.override_reason,
            },
          });
        }
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
                organization_id: "o1",
                actor: "u1",
                actor_name: "Arjun Mehta",
                action: "contents.create",
                entity: "content:c1",
                payload: { title: "TEST-007 Workflow Post", channel: "Instagram" },
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
              organization_id: "o1",
              actor: "u1",
              actor_name: "Arjun Mehta",
              action: "content.submit",
              entity: "content:c1",
              payload: { content_id: "c1", revision_id: "rev1" },
              at: "2026-10-23T04:10:00.000Z",
            },
            {
              id: "ae2",
              organization_id: "o1",
              actor: "u2",
              actor_name: "Neha Iyer",
              action: "content.request_changes",
              entity: "content:c1",
              payload: { content_id: "c1", revision_id: "rev1", comment: "Please remove superlative claims from text" },
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
    // Step 1: Submit disabled before review -> enabled after
    // =========================================================================
    await page.goto("/content/c1");
    await page.waitForSelector("h1:has-text('TEST-007 Workflow Post')");

    const submitBtn = page.locator("button:has-text('Submit for review')");
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
    await expect(
      page.locator("text=Run Vouch review on the latest revision first"),
    ).toBeVisible();

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

    // Verify claim and rule findings rendered cleanly
    await expect(page.locator("span:has-text('1 supported as proof')")).toBeVisible();
    await expect(page.locator("span:has-text('TERM-01')")).toBeVisible();
    await expect(page.locator("text=95% confidence")).toBeVisible();

    await assertCleanText(page);

    // =========================================================================
    // Step 2: Creator submit -> In review badge
    // =========================================================================
    await submitBtn.click();
    await page.waitForSelector("span:has-text('In review')");
    await expect(page.locator("button:has-text('Submit for review')")).toHaveCount(0);

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

    await page.goto("/content/c1");
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

    // Type valid comment
    await commentInput.fill("Please remove superlative claims from text");
    await expect(confirmReqBtn).toBeEnabled();

    // Confirm request changes
    await confirmReqBtn.click();
    await page.waitForSelector("span:has-text('Changes requested')");
    await expect(page.locator("text=Changes requested by Neha Iyer")).toBeVisible();
    await expect(page.locator("text=\"Please remove superlative claims from text\"")).toBeVisible();

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step4_reviewer_requested_changes.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 5: Reviewer approve -> 409 override_required -> dialog -> approve with override
    // =========================================================================
    contentStatus = "in_review";
    await page.goto("/content/c1");
    await page.waitForSelector("text=Reviewer Decision");

    const approveBtn = page.locator("button:has-text('Approve')");
    await approveBtn.click();

    // Dialog opens on 409 override_required
    await page.waitForSelector("text=Approval Requires Override");
    await expect(page.locator("text=1 high-severity issue(s) still open")).toBeVisible();

    const approveWithOverrideBtn = page.locator("button:has-text('Approve with override')");
    await expect(approveWithOverrideBtn).toBeDisabled();

    const overrideInput = page.locator("textarea[placeholder*='Explain why this content is approved']");
    await overrideInput.fill("Too short");
    await expect(approveWithOverrideBtn).toBeDisabled();

    await overrideInput.fill("Approved exception for product launch per VP");
    await expect(approveWithOverrideBtn).toBeEnabled();

    // Confirm approval
    await approveWithOverrideBtn.click();

    // Approved banner appears
    await page.waitForSelector("span:has-text('Approved by Neha Iyer')");
    await expect(
      page.locator("text=(Override: Approved exception for product launch per VP)"),
    ).toBeVisible();

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
    // Step 6: Activity timeline rendered with readable labels
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
    // Step 7: /audit table + Load more pagination test (Requirement 5)
    // =========================================================================
    const auditLink = page.locator("header nav a:has-text('Audit log')");
    await expect(auditLink).toBeVisible();
    await auditLink.click();

    await page.waitForSelector("h1:has-text('Audit log')");
    await expect(
      page.locator("text=Append-only system record of all governance events and decisions."),
    ).toBeVisible();

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
    // Screenshot 7a clearly displays the audit log with the "Load more" button
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
    // Screenshot 7b displays the appended rows
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step7b_audit_log_after_load_more.png"),
      fullPage: true,
    });

    expect(pageErrors).toEqual([]);
  });
});

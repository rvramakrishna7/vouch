import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const API = "http://api.test";
const BODY = "India's No.1 eco-friendly water bottle, now 40% lighter.";

async function assertCleanText(page: Page) {
  const text = await page.innerText("body");
  const entityMatch = text.match(/&[a-zA-Z]+;/);
  expect(
    entityMatch,
    `Page text should not contain unescaped HTML entities, found: ${entityMatch?.[0]}`,
  ).toBeNull();

  const forbiddenWords = ["checked", "check_circle", "close", "arrow_forward"];
  for (const word of forbiddenWords) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    expect(
      regex.test(text),
      `Page text should not contain icon name "${word}" as visible word`,
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

  test("Complete approval workflow, activity timeline, and audit log", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Current mock state
    let contentStatus = "draft";
    let hasReview = false;
    let currentUserRole = "creator"; // 'creator' | 'reviewer' | 'brand_manager'

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

    const review = {
      id: "rw1",
      organization_id: "o1",
      revision_id: "rev1",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      started_at: "2026-10-23T04:00:01Z",
      finished_at: "2026-10-23T04:00:03Z",
      created_at: "2026-10-23T04:00:03Z",
      ai_status: "ok",
      ai_provider: "groq",
      ai_model: "openai/gpt-oss-120b",
      ai_latency_ms: 2500,
    };

    const finding = {
      id: "f1",
      organization_id: "o1",
      review_id: "rw1",
      kind: "term",
      span_text: "No.1",
      start_offset: 8,
      end_offset: 12,
      severity: "high",
      reason: "Banned superlative",
      resolution: "open",
      suggested_fix: null,
      replacement_text: null,
      dismiss_reason: null,
      created_at: "2026-10-23T04:00:03Z",
    };

    const activityTimeline: any[] = [
      {
        id: "act-1",
        action: "contents.create",
        actor: "u1",
        actor_name: "Arjun Mehta",
        time: "2026-10-23T04:00:00Z",
        details: { title: "TEST-007 Workflow", channel: "Instagram" },
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

      if (url.endsWith("/api/contents/c1")) {
        return jsonFulfill({
          id: "c1",
          title: "TEST-007 Workflow",
          channel: "Instagram",
          audience: "General",
          purpose: "Approval test",
          status: contentStatus,
          created_by: "u1",
          created_by_name: "Arjun Mehta",
          created_at: "2026-10-23T04:00:00Z",
          updated_at: "2026-10-23T04:00:00Z",
          revisions: [
            {
              id: "rev1",
              n: 1,
              body: BODY,
              created_by: "u1",
              created_by_name: "Arjun Mehta",
              created_at: "2026-10-23T04:00:00Z",
            },
          ],
        });
      }

      if (url.endsWith("/api/contents/c1/reviews/latest")) {
        if (!hasReview) {
          return jsonFulfill({ error: "not_found" }, 404);
        }
        return jsonFulfill({ review, findings: [finding] });
      }

      if (url.endsWith("/api/contents/c1/reviews") && method === "POST") {
        hasReview = true;
        activityTimeline.push({
          id: "act-rev",
          action: "review.run",
          actor: "u1",
          actor_name: "Arjun Mehta",
          time: new Date().toISOString(),
          details: { revision_id: "rev1", findings_count: 1, ai_status: "ok" },
        });
        return jsonFulfill({ review, findings: [finding] });
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
          time: new Date().toISOString(),
          details: { revision_id: "rev1" },
        });
        return jsonFulfill({
          content: {
            id: "c1",
            title: "TEST-007 Workflow",
            channel: "Instagram",
            audience: "General",
            purpose: "Approval test",
            status: "in_review",
            created_by: "u1",
            created_by_name: "Arjun Mehta",
            created_at: "2026-10-23T04:00:00Z",
            updated_at: new Date().toISOString(),
            revisions: [
              {
                id: "rev1",
                n: 1,
                body: BODY,
                created_by: "u1",
                created_by_name: "Arjun Mehta",
                created_at: "2026-10-23T04:00:00Z",
              },
            ],
          },
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
            time: new Date().toISOString(),
            details: { revision_id: "rev1", comment: body.comment },
          });
          return jsonFulfill({
            content: {
              id: "c1",
              status: "changes_requested",
              title: "TEST-007 Workflow",
              revisions: [{ id: "rev1", n: 1, body: BODY }],
            },
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
            time: new Date().toISOString(),
            details: { revision_id: "rev1", override_reason: body.override_reason },
          });
          return jsonFulfill({
            content: {
              id: "c1",
              status: "approved",
              title: "TEST-007 Workflow",
              revisions: [{ id: "rev1", n: 1, body: BODY }],
            },
            approval: {
              decision: "approved",
              override_reason: body.override_reason,
              user_id: "u2",
            },
          });
        }
      }

      const matchAudit = url.match(/\/api\/audit(\?.*)?$/);
      if (matchAudit) {
        if (url.includes("before=")) {
          return jsonFulfill({
            events: [
              {
                id: "ae3",
                organization_id: "o1",
                actor: "u1",
                actor_name: "Arjun Mehta",
                action: "contents.create",
                entity: "content:c1",
                payload: { title: "TEST-007 Workflow", channel: "Instagram" },
                at: "2026-10-23T04:00:00Z",
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
              at: "2026-10-23T04:10:00Z",
            },
            {
              id: "ae2",
              organization_id: "o1",
              actor: "u2",
              actor_name: "Neha Iyer",
              action: "content.request_changes",
              entity: "content:c1",
              payload: { content_id: "c1", revision_id: "rev1", comment: "Please update the phrasing" },
              at: "2026-10-23T04:05:00Z",
            },
          ],
          next_cursor: "2026-10-23T04:05:00Z|ae2",
        });
      }

      return jsonFulfill({ error: "not_found" }, 404);
    });

    // Seed session cache for creator
    await page.addInitScript(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "fake-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: creatorUser, org },
    );

    // =========================================================================
    // Step 1: Submit disabled before review -> enabled after
    // =========================================================================
    await page.goto("/content/c1");
    await page.waitForSelector("h1:has-text('TEST-007 Workflow')");

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

    // Creator runs review
    const runReviewBtn = page.locator("button:has-text('Run Vouch review')");
    await runReviewBtn.click();
    await page.waitForSelector("text=Claim Ledger");

    // Submit button is now enabled
    await expect(submitBtn).toBeEnabled();

    // =========================================================================
    // Step 2: Creator submit -> In review badge
    // =========================================================================
    await submitBtn.click();
    await page.waitForSelector("span:has-text('In review')");

    // Submit button is hidden after submission
    await expect(page.locator("button:has-text('Submit for review')")).toHaveCount(0);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step2_creator_submitted_in_review.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 3: Creator cannot see Audit log link & gets redirected if visiting /audit
    // =========================================================================
    const auditLinkCreator = page.locator("header nav a:has-text('Audit log')");
    await expect(auditLinkCreator).toHaveCount(0);

    await page.goto("/audit");
    await page.waitForURL("**/content");
    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step3_creator_no_audit_link.png"),
      fullPage: true,
    });

    // =========================================================================
    // Step 4: Reviewer logs in, sees In review, requests changes (disabled < 5 chars)
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
    await page.waitForSelector("h1:has-text('TEST-007 Workflow')");

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
    // Switch content back to in_review
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
    // Step 7: /audit table + Load more (reviewer sees link and visits)
    // =========================================================================
    const auditLink = page.locator("header nav a:has-text('Audit log')");
    await expect(auditLink).toBeVisible();
    await auditLink.click();

    await page.waitForSelector("h1:has-text('Audit log')");
    await expect(
      page.locator("text=Append-only system record of all governance events and decisions."),
    ).toBeVisible();

    // Verify events on page 1
    await expect(page.locator("span:has-text('content.submit')")).toBeVisible();
    await expect(page.locator("span:has-text('content.request_changes')")).toBeVisible();

    // Load more
    const loadMoreBtn = page.locator("button:has-text('Load more')");
    await expect(loadMoreBtn).toBeVisible();
    await loadMoreBtn.click();

    // Verify page 2 event loaded
    await page.waitForSelector("span:has-text('contents.create')");
    await expect(loadMoreBtn).toHaveCount(0);

    await assertCleanText(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "s10b_step7_audit_log_page.png"),
      fullPage: true,
    });

    expect(pageErrors).toEqual([]);
  });
});

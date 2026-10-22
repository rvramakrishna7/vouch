import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const API = "http://api.test";
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
) {
  const { start, end } = span(text);
  return {
    id,
    organization_id: "o1",
    review_id: "r1",
    kind,
    span_text: text,
    start_offset: start,
    end_offset: end,
    verdict,
    fact_code: fact,
    fact_statement: fact ? "F" : null,
    fact_valid_until: fact ? "2027-01-31" : null,
    rule_code: rule,
    rule_text: rule ? "rule text" : null,
    reason: "reason",
    severity: sev,
    confidence: 0.9,
    suggested_fix: fix,
    replacement_text: null,
    resolution: "open",
    dismiss_reason: null,
    created_at: "2026-10-22T10:00:00Z",
  };
}

test.describe("Resolve findings (TEST-006) E2E Scenario", () => {
  const screenshotsDir = path.join(process.cwd(), "e2e", "screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Checks 1-7: Creator resolution flow on mocked API", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const findings = [
      createFinding(
        "f48",
        "claim",
        "Keeps drinks cold for 48 hours",
        "contradicted",
        "Keeps drinks cold for 24 hours",
        "high",
        "CLAIM-03",
        "F-15",
      ),
      createFinding(
        "fno1",
        "claim",
        "India's No.1 eco-friendly water bottle",
        "unsupported",
        null,
        "high",
        "CLAIM-01",
      ),
      createFinding(
        "fsup",
        "claim",
        "40% lighter",
        "supported",
        null,
        "low",
        null,
        "F-12",
      ),
      createFinding(
        "fhash",
        "accessibility",
        "#stayhydrated",
        null,
        null,
        "low",
        "ACC-02",
      ),
    ];

    const state: Record<string, any> = {};
    for (const f of findings) {
      state[f.id] = { ...f };
    }

    const content = {
      id: "c1",
      title: "TEST-006",
      channel: "Instagram",
      audience: "a",
      purpose: "p",
      status: "draft",
      created_by: "u1",
      created_by_name: "Arjun Mehta",
      created_at: "2026-10-22T10:00:00Z",
      updated_at: "2026-10-22T10:00:00Z",
      revisions: [
        {
          id: "rev1",
          n: 1,
          body: BODY,
          created_by: "u1",
          created_by_name: "Arjun Mehta",
          created_at: "2026-10-22T10:00:00Z",
        },
      ],
    };

    const review = {
      id: "r1",
      organization_id: "o1",
      revision_id: "rev1",
      provider: "rules",
      model: "vouch-rules-v1",
      started_at: "2026-10-22T10:00:00Z",
      finished_at: "2026-10-22T10:00:01Z",
      created_at: "2026-10-22T10:00:00Z",
      ai_status: "ok",
      ai_provider: "groq",
      ai_model: "openai/gpt-oss-120b",
      ai_latency_ms: 3000,
    };

    const creatorUser = {
      id: "u1",
      name: "Arjun Mehta",
      email: "demo.creator@aqualeaf.test",
      role: "creator",
    };
    const org = { id: "o1", name: "Aqualeaf" };

    // Setup network mocks
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
        return jsonFulfill({ user: creatorUser, organization: org });
      }

      if (url.endsWith("/api/contents/c1")) {
        return jsonFulfill(content);
      }

      if (url.endsWith("/api/contents/c1/reviews/latest")) {
        return jsonFulfill({ review, findings: Object.values(state) });
      }

      const matchResolution = url.match(/\/api\/findings\/(\w+)\/resolution/);
      if (matchResolution && method === "PATCH") {
        const fid = matchResolution[1];
        const body = JSON.parse(request.postData() || "{}");
        const current = { ...state[fid] };

        if (body.action === "accept") {
          if (!current.suggested_fix) {
            return jsonFulfill({ error: "no_suggested_fix" }, 400);
          }
          current.resolution = "accepted";
        } else if (body.action === "edit") {
          current.resolution = "edited";
          current.replacement_text = body.text;
        } else if (body.action === "dismiss") {
          if (!body.reason || body.reason.trim().length < 5) {
            return jsonFulfill({ error: "invalid_input" }, 400);
          }
          current.resolution = "dismissed";
          current.dismiss_reason = body.reason;
        }

        state[fid] = current;
        return jsonFulfill({ finding: current, ...current });
      }

      if (url.endsWith("/api/contents/c1/revisions") && method === "POST") {
        const newBody = BODY.replace(
          "Keeps drinks cold for 48 hours",
          "Keeps drinks cold for 24 hours",
        ).replace(
          "India's No.1 eco-friendly water bottle",
          "A water bottle made from 70% recycled stainless steel",
        );
        return jsonFulfill({
          body: newBody,
          applied: ["f48", "fno1"],
          skipped: [],
        });
      }

      return jsonFulfill({ error: "not_mocked", url }, 404);
    });

    // Populate creator session
    await page.goto("/login");
    await page.evaluate(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "mock-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: creatorUser, org },
    );

    await page.goto("/content/c1");
    await page.waitForLoadState("networkidle");

    // Check 1: "Accept fix" is visible before any action, and NO "Change" button before any action
    const acceptFixBtn = page.getByRole("button", { name: "Accept fix" });
    await expect(acceptFixBtn.first()).toBeVisible();
    const changeBtn = page.getByRole("button", { name: "Change", exact: true });
    await expect(changeBtn).toHaveCount(0);
    await page.screenshot({
      path: path.join(screenshotsDir, "check1_initial.png"),
      fullPage: true,
    });

    // Check 2: Click "Accept fix" on claim 1 -> an "Accepted" badge appears
    await acceptFixBtn.first().click();
    const acceptedBadge = page.getByText(/Accepted/);
    await expect(acceptedBadge.first()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "check2_accepted.png"),
      fullPage: true,
    });

    // Check 3: Click "Edit" -> replacement text box appears and STAYS open; fill, Save -> "Edited:" badge
    const editBtns = page.getByRole("button", { name: "Edit", exact: true });
    await expect(editBtns.first()).toBeVisible();
    await editBtns.first().click();

    const editInput = page.getByPlaceholder("Enter replacement text...");
    await expect(editInput).toBeVisible();
    // Verify it stays open
    await page.waitForTimeout(500);
    await expect(editInput).toBeVisible();

    await editInput.fill("A water bottle made from 70% recycled stainless steel");
    const saveBtn = page.getByRole("button", { name: "Save", exact: true });
    await saveBtn.click();

    const editedBadge = page.getByText(/Edited:/);
    await expect(editedBadge.first()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "check3_edited.png"),
      fullPage: true,
    });

    // Check 4: Click "Dismiss" -> reason box appears and STAYS open; Confirm disabled while empty, enabled after >=5 chars; Confirm -> "Dismissed:" badge
    const dismissBtns = page.getByRole("button", { name: "Dismiss", exact: true });
    await expect(dismissBtns.first()).toBeVisible();
    await dismissBtns.first().click();

    const reasonInput = page.getByPlaceholder("E.g. Approved brand exception...");
    await expect(reasonInput).toBeVisible();
    // Verify it stays open
    await page.waitForTimeout(500);
    await expect(reasonInput).toBeVisible();

    const confirmBtn = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirmBtn).toBeDisabled();

    await reasonInput.fill("Approved campaign hashtag");
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    const dismissedBadge = page.getByText(/Dismissed:/);
    await expect(dismissedBadge.first()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "check4_dismissed.png"),
      fullPage: true,
    });

    // Check 5: "Preview changes" is enabled; clicking it opens the preview showing "24 hours"
    const previewBtn = page.getByRole("button", { name: /Preview changes/ });
    await expect(previewBtn).toBeEnabled();
    await previewBtn.click();

    const previewModal = page.locator(".fixed");
    await expect(previewModal.getByText("24 hours")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "check5_preview.png"),
      fullPage: true,
    });

    // Check 6: No page errors in the browser console
    await page.screenshot({
      path: path.join(screenshotsDir, "check6_console.png"),
      fullPage: true,
    });
    expect(pageErrors).toEqual([]);

    // Check 7: Supported claim (claim 3 "40% lighter") shows no action buttons
    // Finding card for fsup should not contain Accept fix, Edit, or Dismiss
    const fsupCard = page.locator("#finding-card-fsup");
    await expect(fsupCard).toBeVisible();
    await expect(fsupCard.getByRole("button", { name: "Accept fix", exact: true })).toHaveCount(0);
    await expect(fsupCard.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(fsupCard.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
    await expect(fsupCard.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: path.join(screenshotsDir, "check7_supported.png"),
      fullPage: true,
    });
  });

  test("Check 8: Reviewer logged in sees no Accept/Edit/Dismiss/Change buttons", async ({ page }) => {
    const reviewerUser = {
      id: "u2",
      name: "Neha Iyer",
      email: "demo.reviewer@aqualeaf.test",
      role: "reviewer",
    };
    const org = { id: "o1", name: "Aqualeaf" };

    const findings = [
      createFinding(
        "f48",
        "claim",
        "Keeps drinks cold for 48 hours",
        "contradicted",
        "Keeps drinks cold for 24 hours",
        "high",
        "CLAIM-03",
        "F-15",
      ),
      createFinding(
        "fno1",
        "claim",
        "India's No.1 eco-friendly water bottle",
        "unsupported",
        null,
        "high",
        "CLAIM-01",
      ),
      createFinding(
        "fsup",
        "claim",
        "40% lighter",
        "supported",
        null,
        "low",
        null,
        "F-12",
      ),
    ];

    const content = {
      id: "c1",
      title: "TEST-006",
      channel: "Instagram",
      audience: "a",
      purpose: "p",
      status: "draft",
      created_by: "u1",
      created_by_name: "Arjun Mehta",
      created_at: "2026-10-22T10:00:00Z",
      updated_at: "2026-10-22T10:00:00Z",
      revisions: [
        {
          id: "rev1",
          n: 1,
          body: BODY,
          created_by: "u1",
          created_by_name: "Arjun Mehta",
          created_at: "2026-10-22T10:00:00Z",
        },
      ],
    };

    const review = {
      id: "r1",
      organization_id: "o1",
      revision_id: "rev1",
      provider: "rules",
      model: "vouch-rules-v1",
      started_at: "2026-10-22T10:00:00Z",
      finished_at: "2026-10-22T10:00:01Z",
      created_at: "2026-10-22T10:00:00Z",
      ai_status: "ok",
      ai_provider: "groq",
      ai_model: "openai/gpt-oss-120b",
      ai_latency_ms: 3000,
    };

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
        return jsonFulfill({ user: reviewerUser, organization: org });
      }
      if (url.endsWith("/api/contents/c1")) {
        return jsonFulfill(content);
      }
      if (url.endsWith("/api/contents/c1/reviews/latest")) {
        return jsonFulfill({ review, findings });
      }
      return jsonFulfill({ error: "not_mocked", url }, 404);
    });

    await page.goto("/login");
    await page.evaluate(
      ({ user, org }) => {
        sessionStorage.setItem("vouch_token", "mock-token");
        sessionStorage.setItem("vouch_user", JSON.stringify(user));
        sessionStorage.setItem("vouch_org", JSON.stringify(org));
      },
      { user: reviewerUser, org },
    );

    await page.goto("/content/c1");
    await page.waitForLoadState("networkidle");

    // Assert: zero Accept fix, Edit, Dismiss, Change buttons anywhere
    await expect(page.getByRole("button", { name: "Accept fix", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);

    await page.screenshot({
      path: path.join(screenshotsDir, "check8_reviewer.png"),
      fullPage: true,
    });
  });
});

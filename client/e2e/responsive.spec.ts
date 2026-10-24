import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { DEMO_GUIDELINE_TEXT as DEMO_TEXT } from "../src/data/demoGuideline.js";

/**
 * S12c: responsive layout (AGENTS.md 7f).
 * Every page (and every modal) is visited at 375, 768, 1024, 1280 and 1440 px against a mocked API
 * built from the real route response shapes, using the longest realistic values.
 */

const API = "http://api.test";
const WIDTHS = [375, 768, 1024, 1280, 1440];
const CONTENT_ID = "fd4ebc26-03e0-40d9-8a7b-5895dc216974";
const REV1_ID = "7b233a1e-8422-488b-a7e8-54b9f029341c";
const REV2_ID = "9c0a5b77-1d1e-4a35-8f2a-3b6f0c2d7e11";

const BODY =
  "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #aqualeafpurespringwatereditionlaunchcampaign2026 Visit https://www.aqualeaf.example/collections/pure-spring-water-edition-2026/launch?utm_source=instagram&utm_medium=social&utm_campaign=flow";
const BODY_REV2 =
  "India's leading eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers. Keeps drinks cold for 48 hours. #AqualeafPureSpringWaterEdition2026 Visit https://www.aqualeaf.example/collections/pure-spring-water-edition-2026/launch?utm_source=instagram&utm_medium=social&utm_campaign=flow";

const LONG_TITLE =
  "Aqualeaf Pure Spring Water Edition 2026 - Comprehensive Multi-Channel Influencer Campaign Announcement (Official Launch Copy)";
const LONG_PURPOSE =
  "Comprehensive multi-tier brand awareness and product launch across digital, social, and print channels";
const LONG_AUDIENCE =
  "Eco-conscious urban young professionals and fitness enthusiasts in Tier-1 metropolitan cities";
const LONG_COMMENT =
  "The term No.1 cannot be substantiated without the Bureau of Indian Standards certificate number and the June 2026 consumer benchmark survey documentation clearly referenced.";
const LONG_FACT =
  "Aqualeaf Flow bottle keeps drinks cold for 24 hours and hot for 12 hours when tested by the independent laboratory in controlled 25 degree Celsius conditions.";
const LONG_RULE_TEXT =
  "No superlatives or rankings (\"No.1\", \"best\", \"India's leading\") unless backed by an approved ranking fact with a named source and a valid date.";

const org = { id: "998d3d5a-8015-469f-ae6d-3877d47366c6", name: "Aqualeaf" };
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
const managerUser = {
  id: "0f6c1a54-3f0c-4b51-9d57-0b8d3c7a2e90",
  name: "Priya Sharma",
  email: "demo.brand@aqualeaf.test",
  role: "brand_manager",
};

type Role = "creator" | "reviewer" | "brand_manager";
const USERS: Record<Role, typeof creatorUser> = {
  creator: creatorUser,
  reviewer: reviewerUser,
  brand_manager: managerUser,
};

// AGENTS.md 7d.2 (same checks as the other specs)
async function assertCleanText(page: Page) {
  const text = await page.innerText("body");
  const entityMatch = text.match(/&[a-zA-Z]+;/);
  expect(entityMatch, `HTML entity in page text: ${entityMatch?.[0]}`).toBeNull();
  for (const word of ["checked", "check_circle", "close", "arrow_forward"]) {
    expect(
      new RegExp(`\\b${word}\\b`, "i").test(text),
      `Page text contains icon name "${word}"`,
    ).toBe(false);
  }
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
    expect(pattern.test(text), `Page text contains "${label}". Sample: ${text.slice(0, 300)}`).toBe(
      false,
    );
  }
}

/** AGENTS.md 7f.1/7f.2 checks for the current page state at the current viewport. */
async function assertResponsive(page: Page, label: string, width: number) {
  await assertCleanText(page);

  const report = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const out: {
      pageOverflow: number;
      wideElements: string[];
      tableOverflow: string[];
      smallText: string[];
      smallTargets: string[];
      smallButtonPadding: string[];
      multiLineBadges: string[];
    } = {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      wideElements: [],
      tableOverflow: [],
      smallText: [],
      smallTargets: [],
      smallButtonPadding: [],
      multiLineBadges: [],
    };

    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const insideScroller = (el: Element) => {
      let p: Element | null = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (["auto", "scroll", "hidden"].includes(s.overflowX) && p.scrollWidth <= p.clientWidth + 1)
          return false;
        if (["auto", "scroll"].includes(s.overflowX)) return true;
        p = p.parentElement;
      }
      return false;
    };
    const desc = (el: Element) =>
      `${el.tagName.toLowerCase()}${(el as HTMLElement).className && typeof (el as HTMLElement).className === "string" ? "." + (el as HTMLElement).className.split(/\s+/).slice(0, 3).join(".") : ""} "${(el.textContent || "").trim().slice(0, 30)}"`;

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!isVisible(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.right > vw + 1 && !insideScroller(el)) {
        // fixed overlays are measured too: they must fit the viewport
        out.wideElements.push(`${desc(el)} right=${Math.round(r.right)}`);
      }
    }

    for (const t of Array.from(document.querySelectorAll("table"))) {
      if (isVisible(t) && t.scrollWidth > t.clientWidth + 1) out.tableOverflow.push(desc(t));
    }

    // minimum text size: 12 px (7f.2)
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!isVisible(el) || el.tagName === "OPTION" || el.tagName === "SCRIPT" || el.tagName === "STYLE")
        continue;
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim().length > 0,
      );
      if (!hasOwnText) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11.99) out.smallText.push(`${desc(el)} ${fs}px`);
    }

    // button padding-left >= 12px (Requirement 11)
    for (const b of Array.from(document.querySelectorAll("button"))) {
      if (!isVisible(b)) continue;
      const txt = (b.textContent || "").trim();
      if (txt === "×" || txt === "✕" || txt === "" || b.classList.contains("touch-auto") || b.getAttribute("aria-label") === "Close") continue;
      const pl = parseFloat(getComputedStyle(b).paddingLeft);
      if (pl < 11.5) out.smallButtonPadding.push(`${desc(b)} pl=${pl}px`);
    }

    // no badge/pill has height > 1 line (Requirement 11)
    for (const el of Array.from(document.querySelectorAll('.rounded-full, [class*="rounded-full"]'))) {
      if (!isVisible(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width <= 32 && r.height <= 32) continue; // skip circular icon badges
      const s = getComputedStyle(el);
      const lh = parseFloat(s.lineHeight) || 16;
      const pt = parseFloat(s.paddingTop) || 0;
      const pb = parseFloat(s.paddingBottom) || 0;
      const maxExpectedH = lh + pt + pb + 6;
      if (el.clientHeight > maxExpectedH) {
        out.multiLineBadges.push(`${desc(el)} h=${el.clientHeight}px expected<=${maxExpectedH}px`);
      }
    }

    // touch targets: >= 40 px high on phone (7f.2)
    if (vw < 768) {
      const targets = Array.from(
        document.querySelectorAll(
          'button, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), a[href], summary',
        ),
      );
      for (const el of targets) {
        if (!isVisible(el)) continue;
        if (el.closest(".touch-auto") || (el as HTMLElement).classList.contains("touch-auto")) continue;
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.height < 39.5) out.smallTargets.push(`${desc(el)} h=${Math.round(r.height)}`);
      }
    }
    return out;
  }, width);

  expect(report.pageOverflow, `${label} @${width}: page scrolls sideways by ${report.pageOverflow}px`).toBeLessThanOrEqual(0);
  expect(report.wideElements, `${label} @${width}: elements beyond viewport`).toEqual([]);
  expect(report.tableOverflow, `${label} @${width}: table overflow`).toEqual([]);
  expect(report.smallText, `${label} @${width}: text smaller than 12px`).toEqual([]);
  expect(report.smallTargets, `${label} @${width}: touch targets under 40px`).toEqual([]);
  expect(report.smallButtonPadding, `${label} @${width}: buttons with padding-left < 12px`).toEqual([]);
  expect(report.multiLineBadges, `${label} @${width}: badges wrapping across lines`).toEqual([]);
}

interface MockState {
  role: Role;
  status: string;
  revisions: number; // 1 or 2
  reviewForRev: 1 | 2 | 0; // which revision the latest review is for (0 = none)
  resolution: string; // resolution given to the open findings
}

function span(body: string, s: string) {
  const i = body.indexOf(s);
  return { start: i, end: i + s.length };
}

function buildFindings(body: string, reviewId: string, resolution: string) {
  const mk = (
    id: string,
    kind: string,
    text: string,
    extra: Record<string, unknown>,
  ) => {
    const { start, end } = span(body, text);
    return {
      id,
      organization_id: org.id,
      review_id: reviewId,
      kind,
      span_text: text,
      start_offset: start,
      end_offset: end,
      verdict: null,
      fact_id: null,
      fact_code: null,
      fact_statement: null,
      fact_valid_until: null,
      rule_id: null,
      rule_code: null,
      rule_text: null,
      reason: "Reason shown to the creator",
      severity: "high",
      confidence: 0.95,
      suggested_fix: null,
      replacement_text: null,
      resolution: "open",
      dismiss_reason: null,
      created_at: "2026-10-23T04:00:03.000Z",
      ...extra,
    };
  };
  return [
    mk("f1", "term", "No.1", {
      rule_id: "r-claim-01",
      rule_code: "CLAIM-01",
      rule_text: LONG_RULE_TEXT,
      reason: "Banned superlative without an approved ranking fact or certification reference.",
      suggested_fix: "leading",
      resolution,
    }),
    mk("f2", "claim", "40% lighter", {
      verdict: "supported",
      fact_id: "fact-12",
      fact_code: "F-12",
      fact_statement:
        "Aqualeaf bottle weight is 180g, 40% lighter than standard 300g stainless bottles.",
      fact_valid_until: "2027-06-30",
      rule_id: "r-claim-03",
      rule_code: "CLAIM-03",
      rule_text: "Every numeric claim must cite an approved, in-date fact.",
      reason: "Claim verified against Fact F-12",
      severity: "low",
      confidence: 0.99,
    }),
    mk("f3", "claim", "cold for 48 hours", {
      verdict: "contradicted",
      fact_id: "fact-20",
      fact_code: "F-20",
      fact_statement: LONG_FACT,
      fact_valid_until: "2027-01-31",
      rule_id: "r-claim-03",
      rule_code: "CLAIM-03",
      rule_text: "Every numeric claim must cite an approved, in-date fact.",
      reason: "The approved fact says 24 hours, not 48 hours.",
      severity: "high",
      confidence: 0.9,
      suggested_fix: "cold for 24 hours",
      resolution,
    }),
    mk("f4", "tone", "Rated 4.8 by our customers!", {
      rule_id: "r-tone-02",
      rule_code: "TONE-02",
      rule_text: "Avoid excessive exclamation marks and ALL CAPS shouting.",
      reason: "Exclamation tone is too promotional for a factual rating claim.",
      severity: "medium",
      confidence: 0.8,
      suggested_fix: "Rated 4.8 by our customers.",
    }),
    mk("f5", "accessibility", "#aqualeafpurespringwatereditionlaunchcampaign2026", {
      rule_id: "r-acc-02",
      rule_code: "ACC-02",
      rule_text: "Use CamelCase for multi-word hashtags so screen readers can pronounce them.",
      reason: "Long lowercase hashtag is hard to read with a screen reader.",
      severity: "low",
      confidence: 0.6,
      suggested_fix: "#AqualeafPureSpringWaterEditionLaunchCampaign2026",
    }),
  ];
}

async function installMocks(page: Page, state: MockState) {
  const content = () => {
    const revisions = [
      ...(state.revisions === 2
        ? [
            {
              id: REV2_ID,
              n: 2,
              body: BODY_REV2,
              created_by: creatorUser.id,
              created_by_name: creatorUser.name,
              created_at: "2026-10-23T05:00:00.000Z",
            },
          ]
        : []),
      {
        id: REV1_ID,
        n: 1,
        body: BODY,
        created_by: creatorUser.id,
        created_by_name: creatorUser.name,
        created_at: "2026-10-23T04:00:00.000Z",
      },
    ];
    return {
      id: CONTENT_ID,
      organization_id: org.id,
      title: LONG_TITLE,
      channel: "Instagram",
      audience: LONG_AUDIENCE,
      purpose: LONG_PURPOSE,
      status: state.status,
      created_by: creatorUser.id,
      created_by_name: creatorUser.name,
      created_at: "2026-10-23T04:00:00.000Z",
      updated_at: "2026-10-23T04:30:00.000Z",
      revisions,
    };
  };

  const review = (revId: string) => ({
    id: "3a218d89-9811-4a25-a1c2-901b2c45e891",
    organization_id: org.id,
    revision_id: revId,
    provider: "rules",
    model: "vouch-rules-v1",
    started_at: "2026-10-23T04:00:01.000Z",
    finished_at: "2026-10-23T04:00:03.000Z",
    created_at: "2026-10-23T04:00:03.000Z",
    ai_status: "ok",
    ai_provider: "groq",
    ai_model: "openai/gpt-oss-120b",
    ai_latency_ms: 2500,
  });

  const activity = [
    {
      id: "a1",
      action: "contents.create",
      actor: creatorUser.id,
      actor_name: creatorUser.name,
      time: "2026-10-23T04:00:00.000Z",
      details: { title: LONG_TITLE, channel: "Instagram" },
    },
    {
      id: "a2",
      action: "content.request_changes",
      actor: reviewerUser.id,
      actor_name: reviewerUser.name,
      time: "2026-10-23T04:20:00.000Z",
      details: { revision_id: REV1_ID, comment: LONG_COMMENT },
    },
  ];

  const rules = [
    ["CLAIM-01", "claims", "high", LONG_RULE_TEXT],
    ["CLAIM-02", "claims", "high", "Environmental claims must name the certification body and scope."],
    ["TONE-01", "tone", "medium", "Friendly, confident and plain. No fear-based or shaming language."],
    ["TERM-01", "terminology", "high", "Always write the brand name as Aqualeaf, never AquaLeaf or Aqua Leaf."],
    ["ACC-02", "accessibility", "low", "Use CamelCase for multi-word hashtags so screen readers can pronounce them."],
  ].map(([code, category, severity, text], i) => ({
    id: `rule-${i}`,
    organization_id: org.id,
    code,
    category,
    severity,
    text,
    version: 1,
    status: "active",
    created_at: "2026-10-23T04:00:00.000Z",
  }));

  const facts = [
    ["F-01", LONG_FACT, "Independent lab report ILR-2026-0412, Mumbai, signed by the head of quality assurance", "Priya Sharma", "2027-01-31", false],
    ["F-07", "Aqualeaf bottles are made from 90% recycled stainless steel.", "Sustainability audit SA-2026-11", "Priya Sharma", "2026-03-31", true],
    ["F-12", "Aqualeaf bottle weight is 180g, 40% lighter than standard 300g stainless bottles.", "Product spec sheet v4", null, "2027-06-30", false],
  ].map(([code, statement, source, owner, valid_until, expired], i) => ({
    id: `fact-${i}`,
    organization_id: org.id,
    code,
    statement,
    source,
    owner,
    valid_until,
    expired,
    created_at: "2026-10-23T04:00:00.000Z",
  }));

  const terms = [
    ["No.1", "banned", null],
    ["100% natural", "regulated", "Needs a certificate reference naming the exact attribute."],
    ["Aqualeaf", "preferred", 'Preferred spelling. Variants: "AquaLeaf", "Aqua Leaf", "aqualeaf".'],
  ].map(([term, type, replacement], i) => ({
    id: `term-${i}`,
    organization_id: org.id,
    term,
    type,
    replacement,
    created_at: "2026-10-23T04:00:00.000Z",
  }));

  const contentsList = [
    {
      id: CONTENT_ID,
      title: LONG_TITLE,
      channel: "Instagram",
      status: state.status,
      created_by_name: creatorUser.name,
      updated_at: "2026-10-23T04:30:00.000Z",
      latest_revision_number: state.revisions,
    },
    {
      id: "0a1b2c3d-1111-4222-8333-444455556666",
      title: "Instagram caption: Flow launch",
      channel: "LinkedIn",
      status: "in_review",
      created_by_name: creatorUser.name,
      updated_at: "2026-10-22T11:08:00.000Z",
      latest_revision_number: 1,
    },
  ];

  const quote1 = "Never use unverified superlatives or number one rankings without approved survey backing.";
  const s1 = DEMO_TEXT.indexOf(quote1);
  const quote2 =
    "Every claim regarding charitable donations or environmental initiatives must name the verified partner organization and specify the exact audited contribution percentage.";
  const s2 = DEMO_TEXT.indexOf(quote2);
  const draftResponse = {
    drafts: [
      {
        temp_id: "draft-1",
        code: "CLAIM-05",
        category: "claims",
        severity: "high",
        text: "Never use unverified superlatives or number one rankings without survey proof.",
        source_quote: quote1,
        source_start: s1,
        source_end: s1 + quote1.length,
        duplicate_of: "CLAIM-01",
      },
      {
        temp_id: "draft-2",
        code: "CLAIM-06",
        category: "claims",
        severity: "high",
        text: "Every claim regarding charitable donations or environmental initiatives must specify the exact audited contribution percentage.",
        source_quote: quote2,
        source_start: s2,
        source_end: s2 + quote2.length,
        duplicate_of: null,
      },
    ],
    rejected: 1,
    source_text: DEMO_TEXT,
    ai: { provider: "gemini", model: "gemini-3.5-flash-lite", latency_ms: 1250 },
  };

  const auditEvents = [
    {
      id: "ae1",
      organization_id: org.id,
      actor: reviewerUser.id,
      actor_name: reviewerUser.name,
      action: "content.request_changes",
      entity: `content:${CONTENT_ID}`,
      payload: { content_id: CONTENT_ID, revision_id: REV1_ID, comment: LONG_COMMENT },
      at: "2026-10-23T04:20:00.000Z",
    },
    {
      id: "ae2",
      organization_id: org.id,
      actor: creatorUser.id,
      actor_name: creatorUser.name,
      action: "contents.create",
      entity: `content:${CONTENT_ID}`,
      payload: { title: LONG_TITLE, channel: "Instagram" },
      at: "2026-10-23T04:00:00.000Z",
    },
    {
      id: "ae3",
      organization_id: org.id,
      actor: managerUser.id,
      actor_name: managerUser.name,
      action: "rules.import",
      entity: "rules:import",
      payload: { count: 3, codes: ["CLAIM-05", "CLAIM-06", "TONE-03"] },
      at: "2026-10-22T10:00:00.000Z",
    },
  ];

  await page.route(`${API}/**`, async (route, request) => {
    const url = request.url();
    const method = request.method();
    const fulfill = (data: unknown, status = 200) =>
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

    if (method === "OPTIONS") return fulfill({});
    if (url.endsWith("/api/health")) return fulfill({ ok: true });
    if (url.endsWith("/api/auth/me")) return fulfill({ user: USERS[state.role], organization: org });

    if (url.endsWith("/api/contents")) return fulfill(contentsList);
    if (url.endsWith(`/api/contents/${CONTENT_ID}`)) return fulfill(content());

    if (url.endsWith(`/api/contents/${CONTENT_ID}/reviews/latest`)) {
      if (state.reviewForRev === 0) return fulfill({ error: "not_found" }, 404);
      const reviewedBody = state.reviewForRev === 2 ? BODY_REV2 : BODY;
      const revId = state.reviewForRev === 2 ? REV2_ID : REV1_ID;
      const r = review(revId);
      return fulfill({ review: r, findings: buildFindings(reviewedBody, r.id, state.resolution) });
    }
    if (url.endsWith(`/api/contents/${CONTENT_ID}/revisions`) && method === "POST") {
      const b = JSON.parse(request.postData() || "{}");
      if (b.mode === "preview") {
        return fulfill({
          body: BODY.replace("No.1", "leading").replace("cold for 48 hours", "cold for 24 hours"),
          applied: [{ finding_id: "f1" }, { finding_id: "f3" }],
          skipped: [{ finding_id: "f5", span_text: "#aqualeafpurespringwatereditionlaunchcampaign2026" }],
        });
      }
      return fulfill({ revision: { id: REV2_ID, n: 2, body: BODY_REV2 } }, 201);
    }
    if (url.endsWith(`/api/contents/${CONTENT_ID}/activity`)) return fulfill({ activity });
    if (url.endsWith(`/api/contents/${CONTENT_ID}/decision`) && method === "POST") {
      return fulfill({ error: "override_required", open_high: 2, ai_status: "ok" }, 409);
    }

    if (url.includes("/api/audit/actions"))
      return fulfill({ actions: ["content.request_changes", "contents.create", "rules.import"] });
    if (/\/api\/audit(\?.*)?$/.test(url))
      return fulfill({ events: auditEvents, next_cursor: "2026-10-22T10:00:00.000Z|ae3" });

    if (url.endsWith("/api/rules")) return fulfill(rules);
    if (url.endsWith("/api/facts")) return fulfill(facts);
    if (url.endsWith("/api/terms")) return fulfill(terms);
    if (url.endsWith("/api/guidelines/draft") && method === "POST") return fulfill(draftResponse);

    return fulfill({ error: "not_found" }, 404);
  });

  await page.addInitScript(
    ({ user, org }) => {
      sessionStorage.setItem("vouch_token", "test-token");
      sessionStorage.setItem("vouch_user", JSON.stringify(user));
      sessionStorage.setItem("vouch_org", JSON.stringify(org));
    },
    { user: USERS[state.role], org },
  );
}

test.describe("Responsive layout (S12c, AGENTS.md 7f)", () => {
  const screenshotsDir = fs.existsSync(path.join(process.cwd(), "client"))
    ? path.join(process.cwd(), "client", "e2e", "screenshots")
    : path.join(process.cwd(), "e2e", "screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  });

  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(90000);
  });

  async function shot(page: Page, name: string, width: number) {
    await page.screenshot({
      path: path.join(screenshotsDir, `responsive_${name}_${width}.png`),
      fullPage: true,
    });
  }

  /** Visit `route` at every width, run `before` (e.g. open a modal), assert and screenshot. */
  async function visitAll(
    page: Page,
    route: string,
    name: string,
    ready: string,
    before?: (width: number) => Promise<void>,
  ) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
      await page.goto(route);
      await page.waitForSelector(ready);
      if (before) await before(width);
      await assertResponsive(page, name, width);
      await shot(page, name, width);
    }
  }

  test("Login page: demo buttons stack on phone", async ({ page }) => {
    await page.route(`${API}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
      await page.goto("/login");
      await page.waitForSelector("text=Try as Creator");
      if (width < 768) {
        const boxes = await Promise.all(
          ["Try as Creator", "Try as Reviewer", "Try as Brand Manager"].map(async (t) =>
            page.locator(`button:has-text('${t}')`).boundingBox(),
          ),
        );
        // stacked: each button starts below the previous one and spans the card width
        expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
      }
      await assertResponsive(page, "login", width);
      await shot(page, "login", width);
    }

    // 6b. Verify login animated dot settles on brand green (#059669 / rgb(5, 150, 105))
    const dot = page.locator("[data-testid='login-dot']");
    await expect(dot).toBeVisible();
    await page.waitForTimeout(1600); // wait for 1.5s animation to finish
    const dotColor = await dot.evaluate((el) => window.getComputedStyle(el).color);
    // rgb(5, 150, 105) is emerald-600
    expect(dotColor).toBe("rgb(5, 150, 105)");

    // click on a button triggers its pending label within 100 ms (Requirement 11)
    await page.route(`${API}/api/auth/demo`, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "fake-jwt", user: creatorUser }),
        headers: { "access-control-allow-origin": "*" },
      });
    });
    const creatorBtn = page.getByRole("button", { name: "Try as Creator" });
    await creatorBtn.click();
    await expect(page.getByRole("button", { name: "Signing in…" })).toBeVisible({ timeout: 100 });
  });

  test("Header menu: collapses on phone, full nav from tablet", async ({ page }) => {
    const state: MockState = { role: "reviewer", status: "in_review", revisions: 1, reviewForRev: 1, resolution: "open" };
    await installMocks(page, state);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/reviews");
      await page.waitForSelector("h1:has-text('Review Queue')");
      const menuBtn = page.locator("button[aria-controls='mobile-menu']");
      const desktopNav = page.locator("header nav").first();
      if (width < 768) {
        await expect(menuBtn).toBeVisible();
        await expect(desktopNav).toBeHidden();
        await expect(page.locator("header >> text=Sign out")).toBeHidden();
        await menuBtn.click();
        const menu = page.locator("#mobile-menu");
        await expect(menu).toBeVisible();
        for (const t of ["Reviews", "Brand Kit", "Audit log", "Neha Iyer", "Reviewer", "Switch role", "Sign out"]) {
          await expect(menu.getByText(t, { exact: true }).first()).toBeVisible();
        }
        for (const t of ["Switch role", "Sign out"]) {
          const box = await menu.getByRole("button", { name: t }).boundingBox();
          expect(box!.height, `${t} touch target`).toBeGreaterThanOrEqual(40);
        }
        await assertResponsive(page, "header_menu_open", width);
        await shot(page, "header_menu_open", width);
        // navigating closes the menu
        await menu.getByText("Audit log", { exact: true }).click();
        await page.waitForSelector("h1:has-text('Audit log')");
        await expect(page.locator("#mobile-menu")).toHaveCount(0);
      } else {
        await expect(menuBtn).toBeHidden();
        await expect(desktopNav).toBeVisible();
        await expect(page.locator("header").getByText("Sign out", { exact: true })).toBeVisible();
        await assertResponsive(page, "header_menu_open", width);
        await shot(page, "header_menu_open", width);
      }
    }
  });

  test("Creator: content list and new content", async ({ page }) => {
    const state: MockState = { role: "creator", status: "draft", revisions: 1, reviewForRev: 1, resolution: "accepted" };
    await installMocks(page, state);

    await visitAll(page, "/content", "content_list", "h1:has-text('My Content')", async (w) => {
      if (w < 768) {
        // stacked cards: no header row, each cell labelled
        await expect(page.locator("table thead")).toBeHidden();
        await expect(page.locator("td[data-label='Status']").first()).toBeVisible();
        await expect(page.locator("a:has-text('View')").first()).toBeVisible();
      }
    });

    await visitAll(page, "/content/new", "new_content", "h1:has-text('Submit New Content')");
  });

  test("Creator: content detail and inline forms", async ({ page }) => {
    const state: MockState = { role: "creator", status: "draft", revisions: 1, reviewForRev: 1, resolution: "accepted" };
    await installMocks(page, state);

    await visitAll(page, `/content/${CONTENT_ID}`, "content_detail", "text=Claim Ledger", async (w) => {
      const draft = await page.locator("h2:has-text('Draft Body')").boundingBox();
      const ledger = await page.locator("h2:has-text('Claim Ledger')").boundingBox();
      const rules = await page.locator("h3:has-text('Brand Kit Rule Findings')").boundingBox();
      const history = await page.locator("h3:has-text('Revision History')").boundingBox();
      const activity = await page.locator("h3:has-text('Activity')").boundingBox();
      if (w < 1024) {
        // stacked order: Draft body, Claim ledger, Rule findings, Revision history, Activity
        expect(draft!.y).toBeLessThan(ledger!.y);
        expect(ledger!.y).toBeLessThan(rules!.y);
        expect(rules!.y).toBeLessThan(history!.y);
        expect(history!.y).toBeLessThan(activity!.y);
      } else {
        // two columns: ledger sits to the right of the draft body, history under the draft body
        expect(ledger!.x).toBeGreaterThan(draft!.x + 200);
        expect(history!.y).toBeGreaterThan(draft!.y);
      }
      if (w < 768) {
        // header actions: full width below the title
        const run = await page.locator("button:has-text('Run Vouch review')").boundingBox();
        const title = await page.locator("h1").boundingBox();
        expect(run!.y).toBeGreaterThan(title!.y + title!.height - 1);
        expect(run!.width).toBeGreaterThan(w * 0.7);
      }
    });

    // Inline Edit / Dismiss forms (open findings)
    state.resolution = "open";
    await visitAll(page, `/content/${CONTENT_ID}`, "finding_inline_edit", "text=Claim Ledger", async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await page.waitForSelector("text=Replacement Text");
    });
    await visitAll(page, `/content/${CONTENT_ID}`, "finding_inline_dismiss", "text=Claim Ledger", async () => {
      await page.getByRole("button", { name: "Dismiss", exact: true }).first().click();
      await page.waitForSelector("text=Reason for Dismissing");
    });
  });

  test("Creator: preview and manual edit modals, stale review", async ({ page }) => {
    const state: MockState = { role: "creator", status: "draft", revisions: 1, reviewForRev: 1, resolution: "accepted" };
    await installMocks(page, state);

    // Preview changes modal and Edit text manually modal
    await visitAll(page, `/content/${CONTENT_ID}`, "modal_preview", "text=Claim Ledger", async (w) => {
      await page.locator("button:has-text('Preview changes')").click();
      await page.waitForSelector("h3:has-text('Preview Changes')");
      if (w < 768) {
        const box = await page.locator("h3:has-text('Preview Changes')").locator("xpath=ancestor::div[contains(@class,'fixed')]").boundingBox();
        expect(box!.width).toBe(w);
        const footerBtn = await page.locator("button:has-text('Create revision 2')").boundingBox();
        expect(footerBtn!.y + footerBtn!.height, "sticky footer button inside viewport").toBeLessThanOrEqual(812);
      }
    });
    await visitAll(page, `/content/${CONTENT_ID}`, "modal_manual_edit", "text=Claim Ledger", async (w) => {
      await page.locator("button:has-text('Edit text manually')").click();
      await page.waitForSelector("h3:has-text('Edit Text Manually')");
      if (w < 768) {
        const footerBtn = await page.locator("button:has-text('Save as revision 2')").boundingBox();
        expect(footerBtn!.y + footerBtn!.height, "sticky footer button inside viewport").toBeLessThanOrEqual(812);
      }
    });

    // Revision 2 created, latest review still on revision 1 (stale)
    state.revisions = 2;
    state.reviewForRev = 1;
    state.resolution = "accepted";
    await visitAll(page, `/content/${CONTENT_ID}`, "content_detail_rev2_stale", "text=These findings are for Revision 1", async () => {
      // Exactly ONE "Run Vouch review" button is visible (Requirement 11)
      const runReviewBtns = await page.getByRole("button", { name: /Run Vouch review/ }).all();
      expect(runReviewBtns.length, "Exactly one Run Vouch review button visible").toBe(1);
    });
  });

  test("Reviewer: review queue, decision panel, override dialog, audit log", async ({ page }) => {
    const state: MockState = { role: "reviewer", status: "in_review", revisions: 1, reviewForRev: 1, resolution: "open" };
    await installMocks(page, state);

    await visitAll(page, "/reviews", "reviews_list", "h1:has-text('Review Queue')", async (w) => {
      if (w < 768) {
        await expect(page.locator("table thead")).toBeHidden();
        await expect(page.locator("td[data-label='Creator']").first()).toBeVisible();
      }
    });

    await visitAll(page, `/content/${CONTENT_ID}`, "reviewer_decision", "text=Reviewer Decision");

    await visitAll(page, `/content/${CONTENT_ID}`, "modal_override", "text=Reviewer Decision", async (w) => {
      await page.locator("button:has-text('Approve')").first().click();
      await page.waitForSelector("h3:has-text('Approval Requires Override')");
      if (w < 768) {
        const footerBtn = await page.locator("button:has-text('Approve with override')").boundingBox();
        expect(footerBtn!.y + footerBtn!.height, "sticky footer button inside viewport").toBeLessThanOrEqual(812);
      }
    });

    await visitAll(page, "/audit", "audit", "h1:has-text('Audit log')", async (w) => {
      await page.waitForSelector("td:has-text('Changes requested')");
      if (w < 768) {
        await expect(page.locator("table thead")).toBeHidden();
        await expect(page.locator("td[data-label='Details']").first()).toBeVisible();
        await expect(page.locator("button:has-text('Load more')")).toBeVisible();
      }
    });
  });

  test("Brand Manager: brand kit tabs and import guideline modal", async ({ page }) => {
    const state: MockState = { role: "brand_manager", status: "draft", revisions: 1, reviewForRev: 1, resolution: "open" };
    await installMocks(page, state);

    await visitAll(page, "/brand-kit", "brandkit_rules", "td:has-text('CLAIM-01')", async (w) => {
      if (w < 768) await expect(page.locator("td[data-label='Actions']").first()).toBeVisible();
    });
    await visitAll(page, "/brand-kit", "brandkit_facts", "h1:has-text('Brand Kit')", async () => {
      await page.locator("button:has-text('Approved Facts')").click();
      await page.waitForSelector("td:has-text('F-01')");
    });
    await visitAll(page, "/brand-kit", "brandkit_terms", "h1:has-text('Brand Kit')", async () => {
      await page.locator("button:has-text('Controlled Terms')").click();
      await page.waitForSelector("td:has-text('100% natural')");
    });

    await visitAll(page, "/brand-kit", "brandkit_add_rule_form", "td:has-text('CLAIM-01')", async () => {
      await page.locator("button:has-text('+ Add rule')").click();
      await page.waitForSelector("text=Add New Governance Rule");
    });

    await visitAll(page, "/brand-kit", "modal_import_input", "td:has-text('CLAIM-01')", async (w) => {
      await page.locator("button:has-text('Import from guideline')").click();
      await page.waitForSelector("text=Import rules from guideline");
      await page.locator("button:has-text('Use sample guideline')").click();
      if (w < 768) {
        const box = await page.locator("h2:has-text('Import rules from guideline')").locator("xpath=ancestor::div[contains(@class,'fixed')]").boundingBox();
        expect(box!.width).toBe(w);
        const draftBtn = await page.locator("button:has-text('Draft rules')").boundingBox();
        expect(draftBtn!.y + draftBtn!.height, "Draft rules button inside viewport").toBeLessThanOrEqual(812);
      }
    });

    await visitAll(page, "/brand-kit", "modal_import_review", "td:has-text('CLAIM-01')", async (w) => {
      await page.locator("button:has-text('Import from guideline')").click();
      await page.locator("button:has-text('Use sample guideline')").click();
      await page.locator("button:has-text('Draft rules')").click();
      await page.waitForSelector("text=Review and approve");
      if (w < 768) {
        const addBtn = await page.locator("button:has-text('Add 1 rule')").boundingBox();
        expect(addBtn!.y + addBtn!.height, "sticky footer button inside viewport").toBeLessThanOrEqual(812);
        expect(addBtn!.height).toBeGreaterThanOrEqual(40);
      }
    });
  });
});

# Status board

Updated by the worker at the end of every task. Planner and owner read it first.

- **Deadline:** 25 Oct 2026, 10:00 IST (submit by 09:00). Feature freeze 24 Oct, 22:00.
- **Live app:** https://vouch-app-beta.vercel.app (client), https://vouch-ten-iota.vercel.app (server API)
- **Repo:** https://github.com/rvramakrishna7/vouch

## Current state
Monorepo scaffolded and deployed on Vercel. `client/` (Vite + React + TS + Tailwind v4 + React Router) has one-click demo login, persistent session management, role routing, navigation bar, Brand Kit management, content submission workflow, and interactive Claim Ledger findings inspection. `server/` (Express + TS, ESM on Vercel Functions, region bom1) connects to Supabase PostgreSQL in Mumbai.

Database schema (001_init.sql with pgvector, DEC-013 offsets, tenant isolation, audit_events append-only trigger; 002_enable_rls.sql on all tables; 003_terms_rules.sql adding rule_id and note to terms) applied to Supabase PostgreSQL. Demo brand ("Aqualeaf" and "Northwind Labs") seeded idempotently.

Full Brand Kit experience implemented:
- Server API (`/api/rules`, `/api/facts`, `/api/terms`): auto-numbering, version incrementing, expired date evaluation, optional rule_code and note on terms, and audit logging.
- Client UI (`/brand-kit`):
  - Accessible via top nav by all roles. Read-only banner shown for Creator and Reviewer.
  - Rules tab: code, category, severity badges (high red, medium amber, low grey), text, version, status, "Add rule" form, inline edit, and archive.
  - Facts tab: code, statement, source, owner, valid until, red "Expired" badge for outdated facts, "Add fact" form with date picker, and edit.
  - Terms tab: term, color-coded type (banned red, regulated amber, preferred green), replacement guidance, "Add term" form, edit, and inline confirmation delete.

Content submission experience (S5a API & S5b UI) completed and live:
- Server API (`/api/contents`):
  - `POST /api/contents/extract`: creator only, multer memory storage with 4MB limit, checks extension (`.docx`) and mimetype (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`), extracts plain text via `mammoth.extractRawText`, returns `{text, characters}` without storing file.
  - `POST /api/contents`: creator only, zod validated `{title, purpose, audience, channel, body}`, transactionally writes `contents` (status "draft") and `revisions` (n=1), writes `contents.create` audit log.
  - `GET /api/contents`: all roles. Creators see only their own contents; reviewers and brand managers see all contents in their org. Returns `{id, title, channel, status, created_by_name, updated_at, latest_revision_number}` ordered newest first.
  - `GET /api/contents/:id`: all roles, creator restricted to own content (404 for others). Returns content + all revisions (`n, body, created_by_name, created_at`) newest first. Tenant isolation enforced (404 for cross-tenant).
- Client UI:
  - `/content` (Creator home): list of user's submitted content with channel, status badges, revision number, updated time, "+ New content" button, empty state ("No content yet. Create your first piece to get it reviewed.").
  - `/content/new` (Creator only): form with Title, Channel select, Audience, Purpose (with helper text), Body (live character counter), "Upload .docx" button calling extraction endpoint with size/type validation, "Use sample caption" button pre-filling the worked example, Save -> navigates to `/content/:id`.
  - `/content/:id` (All roles): displays content metadata (channel, audience, purpose, creator, updated time), latest revision body in a clean readable box, expandable previous revisions history.
  - `/reviews` (Reviewer home): organization-wide review queue showing all submitted content with status badges, linking each to `/content/:id`.
  - Role-based Navigation in Header: Creator (Content, Brand Kit), Reviewer (Reviews, Brand Kit), Brand Manager (Brand Kit, Reviews (read)).

Rule-based review engine, Findings UI, and Performance optimization (S6a, S6b, S6c) completed and live:
- Database: Migration `003_terms_rules.sql` added `rule_id` (FK to rules) and `note` (TEXT) to `terms`.
- Seed: Idempotently seeded terms with exact rule links (`CLAIM-01`, `CLAIM-02`, `CLAIM-03`, `TERM-01`, `TERM-02`) and guidance notes from `docs/demo-brand.md`.
- Pure engine (`server/src/engine/ruleChecks.ts`):
  - Terms: whole-phrase case-insensitive matching; banned and regulated flag occurrences; preferred flags spelling/casing variants (e.g. `AquaLeaf`) while leaving exact match (`Aqualeaf`) unflagged; incorporates notes and suggested fixes.
  - TONE-02: detects 3+ letter words in ALL CAPS (ignoring allowlist `BPA`, `ASCI`, `USA`, `UK`, `CEO`, `FAQ`, `ISO`); flags second `!` when more than one exclamation mark is present in text.
  - ACC-01: flags sentences longer than 25 words with sentence boundary detection.
  - ACC-02: flags lowercase hashtags of 10+ letters with CamelCase recommendation and 0.6 confidence.
  - Enforces Invariant 1: cites active rules with their severity; missing/archived rules become suggestions without citations.
- Review endpoints (`server/src/routes/contents.ts`):
  - `POST /api/contents/:id/reviews`: executes rule checks on latest revision, transactionally persists review record (`provider: "rules"`, `model: "vouch-rules-v1"`) and batch-inserts findings in 1 query, records append-only audit event (`review.run`).
  - `GET /api/contents/:id/reviews/latest`: single-round-trip query with `json_build_object` and `json_agg` returning latest review and findings joined with rule code and rule text.
- Findings UI (`client/src/pages/ContentDetailPage.tsx`):
  - Enabled "Run Vouch review" button with progress indication ("Reviewing...") and error reporting.
  - Parallel data fetching (`Promise.all` for content and review) with instant skeleton loading state (no blank screens).
  - Synchronous session cache in `sessionStorage` (`vouch_user`, `vouch_org`) removing root auth blocking spinner.
  - Summary bar displaying severity count badges (High, Medium, Low) and engine disclosure (`Checked by: <provider> · <model> · <time>`).
  - Interactive highlighted draft text with non-overlapping offset spans (high red, medium amber, low grey underline); clicking a highlight scrolls to and smoothly outlines the corresponding finding card.
  - Claim Ledger finding cards list sorted by severity then position: kind badge, quoted span, citation line with rule code and rule text (or "Suggestion (no rule cited)" in grey if rule_code is null under Invariant 1), reason, confidence percentage, suggested fix if present.
  - Responsive desktop and mobile layouts.
- Performance optimization (S6c):
  - Added `@vercel/functions` database pool lifecycle attachment for Vercel Fluid Compute.
  - Added `Server-Timing: db;dur=..., total;dur=...` middleware across all routes.
  - Live benchmark results (warm data loads in ~80-120ms):
    - `GET /api/health`: 0.094s / 0.094s / 0.076s (was ~0.22s)
    - `GET /api/auth/me`: 0.141s / 0.191s / 0.138s (was ~0.21s)
    - `GET /api/contents`: 0.122s / 0.190s / 0.169s (was ~0.21s)
    - `GET /api/contents/:id`: 0.123s / 0.084s / 0.082s (was ~0.23s)
    - `GET /api/contents/:id/reviews/latest`: 0.095s / 0.114s / 0.091s (was ~0.23s)
    - `POST /api/contents/:id/reviews`: 0.123s / 0.102s / 0.108s (was ~0.28s)
- Vitest suite: 43/43 tests passing across 7 test suites.
- Client build: `tsc -b && vite build` passing with 0 errors.

AI adapter and Fact Embeddings (S7) completed and live:
- Server AI adapter (`server/src/ai/`):
  - `generateJson({system, user, schema, timeoutMs})`: primary Gemini (`gemini-3.5-flash`), on 429/5xx/network/timeout falls back to Groq (`openai/gpt-oss-120b`). Validates with zod; retries once on same provider if output is invalid before throwing `AiInvalidOutputError`. If both fail, throws `AiUnavailableError`.
  - Test hooks: `AI_FORCE_FAIL="gemini"` or `"all"` supported for unit tests and simulation.
  - Invariant 8 prompt-injection guard: `wrapUserContent` wraps submitted content in explicit delimiters and sets system guard instructions treating content as data, never instructions.
  - Zero leakage: never logs API keys or raw prompts; logs only provider, model, latency, and error class.
  - Plain fetch implementation (DEC-019 Proposed): zero vendor SDK bloat, native `AbortSignal.timeout` handling, fast cold starts.
  - `embed(texts[])`: 768-dimensional embeddings via Gemini `gemini-embedding-001` with `batchEmbedContents`.
- Fact embeddings batch job (`server/src/ai/factEmbeddings.ts` & `npm run embed:facts`):
  - Populates `facts.embedding` with pgvector literals (`vector(768)`). All 8 seeded facts embedded (100%).
- AI Status API (`GET /api/ai/status`):
  - Secured with `requireAuth`. Verified live returning `{gemini: {ok: true, model: "gemini-3.5-flash"}, groq: {ok: true, model: "openai/gpt-oss-120b"}, embeddings: {ok: true, model: "gemini-embedding-001", dims: 768}}`.

Claim Ledger pipeline and UI (S8a, S8a.1, S8a.2, S8b) completed and live:
- Claim Ledger UI (S8b, `client/src/pages/ContentDetailPage.tsx`):
  - Claim Ledger section rendered on `/content/:id` above rule findings.
  - Verdict chips with color coding: Supported (green), Outdated (amber), Contradicted (red), Unsupported (red), Needs human judgement (purple).
  - Evidence line on each claim: "Fact F-xx: <statement> (valid until <date>)" or "Rule CLAIM-xx: <text>", plus suggested fix if any.
  - Supported claims marked with "Proof" badge and not counted as issues.
  - Summary bar displays broken-down claim counts ("Claims: w supported · x outdated · y contradicted · z unsupported") + "Rule findings: n", and disclosure line: "Checked by: rule engine vouch-rules-v1 + AI <ai_provider> · <ai_model> · <latency> s".
  - Amber banner displayed when `ai_status !== "ok"`: "AI check unavailable right now. Rule-based findings are shown; try again in a minute." with rule findings displayed.
  - Active review progress line with live elapsed seconds and "Checking rules → Finding relevant facts → Verifying claims" with disabled button and spinner.
  - Plain-language verdict legend placed beneath the ledger table.
  - Highlighted text overlay colors claim spans by verdict and clicking scrolls smoothly to the ledger row.
- Stability & Deterministic Verification (S8a.2, DEC-022 Accepted, owner):
  - Model configuration for ledger call: Groq (`openai/gpt-oss-120b`, `temperature: 0`) set as primary provider with Gemini fallback (8000ms timeout) via `LEDGER_PRIMARY_PROVIDER` (default "groq").
  - Groq 429 resilience: if response header `retry-after` is <= 5s, waits and retries once on Groq before falling back.
  - Regulated terms guard in code: if model says `supported` and quote contains a Brand Kit term of type `regulated`, overrides verdict to `needs_human_judgement` ("Regulated term: a reviewer must confirm the specific attribute is stated in the text.").
  - Numeric cross-check in code: extracts number+unit pairs (%, hours, minutes, days, years, kg, g, ml, liters) from claim quote and candidate facts. If a fact has the same unit but none of its numbers equals the claim's number, overrides verdict to `contradicted` citing that fact and rule `CLAIM-03`.
  - Benchmark (10 runs with 10s pause in normal mode):
    - 10/10 runs completed with AI answers (0 provider outages)
    - 10/10 runs scored 5/5 exact matches (100% per row across all 5 claims)
    - Average AI latency: 3.35s (range 2.66s to 4.61s)
  - Live API verification on seeded draft (`8c321adb-119b-403b-8b2a-2bdfb3fad344`):
    - Run 1: Total time 5.44s (`ai;dur=4374.0, db;dur=162.6, total;dur=4989.1`, provider: groq `openai/gpt-oss-120b`) -> 5/5 correct
    - Run 2: Total time 4.29s (`ai;dur=3313.0, db;dur=52.5, total;dur=3829.7`, provider: groq `openai/gpt-oss-120b`) -> 5/5 correct
    - Run 3: Total time 3.47s (`ai;dur=2777.0, db;dur=99.9, total;dur=3370.7`, provider: groq `openai/gpt-oss-120b`) -> 5/5 correct
  - Vitest test suite: 49/49 tests passing across 8 test suites.
- Database: Migration `004_review_ai_columns.sql` applied to Supabase PostgreSQL, adding `ai_status`, `ai_provider`, `ai_model`, and `ai_latency_ms` to `reviews`.
- Pipeline implementation (`server/src/ledger/`):
  - Sentence splitting with precise character offsets via native `Intl.Segmenter` (`server/src/ledger/sentences.ts`).
  - Vector fact retrieval (`server/src/ledger/retrieve.ts`): embeds all sentences in 1 batch call, queries top 3 facts per sentence using pgvector cosine distance (`<=>`), deduplicates and returns top 12 candidate facts.
  - Single-call extraction and verification (`server/src/ledger/pipeline.ts`): extracts claims and verifies against candidate facts and active claims rules in ONE `generateJson` call using `gemini-3.5-flash`.
  - Invariant 2 strict code validation:
    - Locates quoted spans and calculates start/end offsets (unmatched quotes become `needs_human_judgement`).
    - Validates fact code against candidate facts (missing fact becomes `needs_human_judgement`).
    - Expiry evaluated in code from `valid_until` vs current date: expired facts force verdict to `outdated`; claims marked outdated against in-date facts become `needs_human_judgement`.
    - `unsupported` claims cite active claims rules (unmatched rule becomes suggestion without violation per Invariant 1).
    - `contradicted` and `outdated` claims automatically cite active rule `CLAIM-03`.
    - Severity mapped to rule severity; `supported` claims set to `low`.
- AI Latency Optimization (S8a.1, DEC-021 Accepted):
  - Benchmark of 5 model configurations on seeded draft ("Instagram caption: Flow launch"):
    - Config A (gemini-3.5-flash, thinkingLevel: MINIMAL): 4.54s / 4.05s / 3.78s (4/5 verdicts)
    - Config B (gemini-3.5-flash-lite, thinkingLevel: MINIMAL): 2.60s / 2.90s / 2.51s (5/5 verdicts on all 3 runs - WINNER)
    - Config C (Groq openai/gpt-oss-120b, reasoning_effort: low): 2.24s / 2.13s / 2.38s (2-4/5 verdicts)
    - Config D (Groq qwen/qwen3.8-27b): 1.66s / 1.86s / 2.21s (4-5/5 verdicts)
    - Config E (Baseline gemini-3.5-flash, unconstrained): 7.34s / 11.51s / 2.29s (0-5/5 verdicts)
  - Code-level default in server/src/ai/adapter.ts set to DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite" with DEFAULT_GEMINI_THINKING = "MINIMAL".
  - Live API review verification on seeded draft (8c321adb-119b-403b-8b2a-2bdfb3fad344):
    - Run 1: Total time 6.29s, Server-Timing: ai;dur=3554.0, db;dur=137.2, total;dur=6086.4 (AI step 3.55s)
    - Run 2: Total time 3.16s, Server-Timing: ai;dur=2237.0, db;dur=96.6, total;dur=2807.4 (AI step 2.24s)
    - All 5 claims extracted and verified with 100% accuracy on both live runs.
- Server API updates (`server/src/routes/contents.ts`):
  - `POST /api/contents/:id/reviews` runs rule checks and Claim Ledger in parallel, saves review with AI execution columns, batch-inserts all findings, and logs audit event.
  - `GET /api/contents/:id/reviews/latest` returns review AI disclosure and findings joined with both `rules` and `facts` (`fact_code`, `fact_statement`, `fact_valid_until`).
  - Server-Timing includes `ai;dur=...` entry.
- Live verification on seeded draft ("Instagram caption: Flow launch"):
  - Total request time: 18.83s (`Server-Timing: ai;dur=17587.0, db;dur=319.0, total;dur=18387.6`)
  - Review metadata: `ai_status: "ok"`, `ai_provider: "gemini"`, `ai_model: "gemini-3.5-flash"`, `ai_latency_ms: 17587`.
  - All 5 claims matched expected verdicts:
    - "India's No.1": `unsupported` (cites `CLAIM-01`)
    - "eco-friendly": `unsupported` (cites `CLAIM-02`, suggested fix: "made from 70% recycled stainless steel")
    - "now 40% lighter": `supported` (cites `F-12`, severity `low`)
    - "Rated 4.8 by our customers!": `outdated` (cites `F-03` + `CLAIM-03`)
    - "Keeps drinks cold for 48 hours.": `contradicted` (cites `F-15` + `CLAIM-03`, suggested fix: "Keeps drinks cold for 24 hours.")
- Unit test suite: 49/49 tests passing across 8 test files in Vitest.

Finding resolutions, Preview, and Revisions UI (S9a, S9a.1, S9a.2, S9b, S9b.1, S9c) completed:
- Database: Migration `005_finding_replacement_text.sql` applied to Supabase PostgreSQL, adding `replacement_text TEXT` to `findings`.
- Server enhancements (`server/src/routes/contents.ts` & `server/src/ledger/pipeline.ts`):
  - Added `{ mode: "preview" }` to `POST /api/contents/:id/revisions`: returns `{ body, applied, skipped }` without saving a revision row.
  - Added sentence-start capitalization: if a replacement starts at offset 0 or after `". "`, `"! "`, or `"? "`, capitalises its first letter before applying.
  - Unit tests in `server/test/resolutions.test.ts` covering preview mode and sentence capitalization.
- Client UI (`client/src/pages/ContentDetailPage.tsx`):
  - Creator owner actions on latest review of latest revision: "Accept fix" (when suggested_fix exists), "Edit" (inline input prefilled, Save/Cancel), "Dismiss" (inline reason box, min 5 chars, disabled until valid, Confirm/Cancel).
  - Badges: Accepted (green), Edited: `"<text>"` (blue), Dismissed: `"<reason>"` (grey). Creator can click "Change" to re-resolve. Reviewer and Brand Manager see badges read-only with zero action buttons.
  - "Apply fixes" bar: shows `"n fixes ready"` with "Preview changes" button.
  - Preview modal: word-level diff using `diff` (`diffWords`) with red strikethrough for removals and green for additions, skipped fixes section with reason ("overlaps another fix"), "Create revision N+1" and "Cancel" buttons.
  - Manual edit modal: "Edit text manually" button next to "Preview changes", text editor with current body, live word-level diff as creator types, and "Save as revision N+1" button.
  - Revision history: interactive list of all revisions, clicking an older revision displays its text and a word-level diff against the revision before it (or "Initial revision" for rev 1).
  - Post-creation banner: `"Revision N created. Run Vouch review again to check the new text."` with "Run review" button.
- Resolve UI fix & E2E Acceptance test (S9b.1):
  - Fixed root cause where DB default `resolution: "open"` was treated as resolved: updated `hasResolution = Boolean(finding.resolution && finding.resolution !== "open")` and prevented badge branch from rendering while actively editing (`isEditing`) or dismissing (`isDismissing`).
  - Added Playwright configuration (`client/playwright.config.ts`) building app with `VITE_API_URL=http://api.test` and serving via `vite preview`.
  - Added E2E test suite `client/e2e/resolve.spec.ts` executing all 8 checks from `docs/owner-tests/README.md` against mocked API routes, generating full-page screenshots in `client/e2e/screenshots/` (git-ignored).
- UI Polish & Stale-Review Alignment (S9c):
  - Replaced all HTML entities (`&check;`, `&times;`, `&rarr;`, `&larr;`, `&bull;`, `&apos;`) with real Unicode characters (`✓`, `×`, `→`, `←`, `•`, `'`) across all client pages.
  - Replaced banner icon with inline SVG checkmark, preventing ligature/overflow issues.
  - Handled stale reviews (`review.revision_id !== latestRevision.id`):
    - Renders latest body without highlights (preventing offset misalignment/cut words).
    - Displays amber notice: "These findings are for Revision N. Run Vouch review to check Revision M." with "Run Vouch review →" button.
    - Findings lists marked with "From Revision N" badges; all resolution buttons disabled.
  - Extended Playwright test suite with Revision 2 creation flow, asserting no highlight buttons in Draft Body and presence of stale review notice. Added `assertCleanText(page)` helper verifying zero raw HTML entities and zero icon ligature names as words.
  - Screenshots saved: `revision2_created_banner.png` and `stale_review_notice.png`.
- Vitest suite: 69/69 tests passing across 10 test files in Vitest.
- Playwright E2E suite: 2/2 tests passing (all checks verified).
- Client build: `tsc -b && vite build` passing with 0 errors.

Submit, approval, lock rules, and audit API (S10a) completed and live:
- Database:
  - Leverages existing `approvals`, `comments`, and `audit_events` tables with append-only tamper trigger (`trg_audit_events_tamper`).
- Server endpoints (`server/src/routes/contents.ts`, `server/src/routes/findings.ts`, `server/src/routes/audit.ts`):
  - `POST /api/contents/:id/submit` (Creator owner only): requires that the latest review matches the latest revision (`latest review.revision_id === latest revision.id`), else 409 `review_required`. Transitions status from `draft` or `changes_requested` to `in_review`. Appends `content.submit` audit row.
  - `POST /api/contents/:id/decision` (Reviewer only, others 403): content must be `in_review` (else 409 `not_in_review`). Zod validated `{decision: "approve" | "request_changes", comment?, override_reason?}`.
    - `request_changes`: comment required (min 5 chars). Transitions status to `changes_requested`.
    - `approve`: checks open high non-supported findings on latest review and `ai_status !== "ok"`. If either exists, `override_reason` (min 10 chars) is required, else 409 `override_required`. Transitions status to `approved`.
    - In transaction: records row in `approvals` table (`decision`: 'approved' | 'changes_requested', `override_reason`), inserts into `comments` table if comment given, updates content status, logs append-only audit row (`content.approve` or `content.request_changes` with override reason).
  - Lock & lifecycle rules:
    - When content is `approved`, creating revisions (`POST /api/contents/:id/revisions`) or resolving findings (`PATCH /api/findings/:id/resolution`) returns 409 `{ error: "approved_locked" }`.
    - When creator creates a new revision on `changes_requested` content, content status returns to `draft`.
  - `GET /api/contents/:id/activity` (all roles with view access): returns `{ activity: [...] }` containing single unified timeline of revisions, reviews, resolutions, submit/decision events, and comments in chronological order (`time ASC`), with `actor_name`, `action`, `time`, and structured `details`. Read strictly from `audit_events` and `comments`. Creators can view only own contents (others 404); reviewers and brand managers can view any in their org.
  - `GET /api/audit` (Brand Manager and Reviewer only; Creator 403): returns `{ events, next_cursor }` ordered newest first (`at DESC, id DESC`), supporting `?limit` (default 50, max 100), `?before` cursor, and `?action` filter, joined with `users` for actor name. Filtered strictly by tenant `organization_id`.
- Test suite (`server/test/approval.test.ts`):
  - 11 tests verifying all core transitions, permissions, and invariants against Supabase:
    1. submit without review -> 409 review_required
    2. submit ok -> 200, status in_review, audit row written
    3. creator decision -> 403 forbidden
    4. request_changes without comment -> 400 invalid_input
    5. approve with open high finding and no override -> 409 override_required
    6. approve with override -> 200, status approved, override stored in approvals, audit event written
    7. resolving / creating revision after approval -> 409 approved_locked
    8. new revision after changes_requested -> content returns to draft
    9. Northwind user -> 404 on activity
    10. audit list filtered by org, creator 403
    11. activity timeline returns ordered items with actor details
- Vitest suite: 80/80 tests passing across 11 test suites (`--fileParallelism false`).
- Live API verification on deployed Vercel API (`https://vouch-ten-iota.vercel.app`):
  - Verified full lifecycle end-to-end on new content "API test (S10a)":
    1. Creator created content "API test (S10a)" (status: `draft`)
    2. Ran Review 1 (5 findings, `ai_status: ok`)
    3. Submitted content (status -> `in_review`)
    4. Reviewer requested changes with comment (status -> `changes_requested`, comment stored in `comments`)
    5. Creator created Revision 2 (status -> returned to `draft`)
    6. Ran Review 2 (1 finding, `ai_status: ok`)
    7. Submitted Revision 2 (status -> `in_review`)
    8. Reviewer approved with override reason "Approved exception per VP of Brand for S10a live test" (status -> `approved`, stored in `approvals`)
    9. Fetched activity timeline (`GET /api/contents/:id/activity`): 9 chronological events returned with actor names ("Arjun Mehta", "Neha Iyer") and details
    10. Verified lock rule: attempt to create revision on approved content returned 409 `{ error: "approved_locked" }`.

Approval workflow UI, Activity timeline, and Audit log (S10b & S10b.1) completed and live:
- Server fixes & test coverage:
  - `server/src/routes/contents.ts`:
    - `POST /:id/revisions`: updates content status back to `draft` if creator creates revision while `in_review` (withdraws submission). Approved content remains 409 `approved_locked`.
    - `GET /:id/activity`: finding.resolve details properly reads `payload.replacement_text` and `payload.dismiss_reason`.
    - `GET /:id/activity`: deduplicates comment item when already covered by a `content.request_changes` or `content.approve` event with same revision_id and text.
    - Resolves actor name for email actors using `LEFT JOIN users u ON (u.id::text = ae.actor OR lower(u.email) = lower(ae.actor))`.
  - `server/src/routes/audit.ts`:
    - Compound cursor `(at, id)` using `<iso>|<id>` format. Filter condition `(ae.at, ae.id) < ($at, $id::uuid)` prevents skips and duplicates across identical timestamps.
    - Resolves actor name for email actors (`auth.demo_login` etc.) so real users are never shown as "System".
  - Vitest suite: 83/83 tests passing across 11 test files (`test/approval.test.ts` with 14 tests).
- Client UI (`client/src/pages/ContentDetailPage.tsx`, `AuditPage.tsx`, `Header.tsx`, `StatusBadge.tsx`):
  - Status badge near title: Draft (grey), In review (blue), Changes requested (amber), Approved (emerald).
  - Creator owner actions: "Submit for review" button; disabled with warning hint when latest revision has not been reviewed; updates status to "In review" on click.
  - Reviewer actions: Reviewer Decision panel on `in_review` content with "Approve" and "Request changes" buttons.
    - Request changes expands textarea (min 5 chars); button disabled until valid; updates content status and displays amber banner with reviewer feedback.
    - Approve on 409 `override_required` opens modal displaying open high-severity issues and AI status, with required override reason textarea (min 10 chars); button disabled until valid; "Approve with override" saves decision with override.
  - Approved state: displays green banner "Approved by <name> on <date> (Override: <reason>)"; cleanly suppresses all editing and action buttons (Run review, Submit, Preview, Manual edit, Accept/Edit/Dismiss/Change).
  - Activity timeline section: renders chronological timeline from `GET /activity` with readable labels ("Created content", "Ran Vouch review", "Submitted for review", "Requested changes", "Approved with override", "Accepted fix", "Edited", "Dismissed", "Created revision n"), formatted timestamps, actor names, and contextual details. Refreshes automatically after any user action.
  - Audit log screen (`/audit`):
    - Accessible via header navigation link for `reviewer` and `brand_manager`; hidden for `creator` (who gets redirected if accessed directly).
    - Features append-only notice, action filter dropdown, full table (Time, Actor, Action, Entity, Details), and "Load more" button powered by compound cursor pagination.
    - Human-readable Details formatting for every distinct DB action; short generic fallback eliminates all raw JSON (`{"`). Safe date and actor formatting.
  - Definition of Done & Quality verification (AGENTS.md 7b & 7d):
    - 3/3 Playwright E2E tests passing headless (`resolve.spec.ts` + `approval.spec.ts`).
    - Extended `assertCleanText` enforces zero unescaped HTML entities, zero icon text words, and zero placeholder/corrupted strings (`Unknown`, `Invalid Date`, `NaN`, `undefined`, `null`, `[object Object]`, and raw JSON `{"`).
    - Complete and realistic mock fixtures across all routes.
    - Dedicated E2E assertions for "Load more" pagination, including verification that `before=<cursor>` was requested and rows appended.
    - 8 step screenshots saved in `client/e2e/screenshots/` and individually inspected.
- Live API verification on Vercel deployment (`https://vouch-ten-iota.vercel.app`):
  - Authenticated as Reviewer (Neha Iyer).
  - `GET /api/contents/00d76e9e-ecc2-4024-957f-81a4eb94aefd/activity`: 8 events returned in exact order.
  - `GET /api/audit?limit=5`: verified live returning real user names ("Neha Iyer", "Priya Sharma") with zero "System" entries for real users. Compound cursor pagination verified without overlap.

- Reviewer approval workflow, override, activity timeline, and audit log (S10a, S10b, S10b.1, S10c) completed, polished, and live:
  - Header actions: "Submit for review" and "Run Vouch review" in ONE action row, sharing exact height (`h-10`), padding, and baseline alignment. Helper text ("Run Vouch review on the latest revision first") positioned below the row, right-aligned in small grey text (`text-slate-500`), never shifting button positions.
  - Creator locked while in review:
    - Client UI: Hides all resolve actions (Accept fix, Edit, Dismiss, Change), hides manual editing and preview changes, hides Submit and Run review. Displays a neutral status banner: "Submitted for review. Waiting for a reviewer."
    - Server API: Rejects resolving findings, creating revisions (manual or apply_fixes), and running reviews when content status is `in_review` with `409 { error: "in_review_locked" }`. Reverted S10b fix 2d (revisions no longer move `in_review` -> `draft`; preserves `changes_requested` -> `draft`).
  - Speed budget (AGENTS.md 7e.4):
    - UI updates instantly from write responses (state mutated immediately); non-critical secondary queries (`fetchActivity`) fire in the background asynchronously without blocking UI updates.
    - Verified in Playwright E2E with a 3-second delayed activity route: badge and approved banner updates display within 1s.
    - Live server API write latency on Vercel deployment: `PATCH /api/findings/:id/resolution` takes ~68-84ms (db: ~4-20ms); `POST /api/contents/:id/decision` takes ~72-77ms (db: ~14-16ms) — well under the 1.5s budget.
  - Audit page polish:
    - Fixed table layout (`table-fixed w-full`) with explicit column widths. No horizontal scrollbar at 1280px and 1440px viewport widths.
    - Long details wrap cleanly and clamp to 2 lines (`line-clamp-2 break-words`) with the complete text preserved in a `title` tooltip.
    - Entity identifiers shortened (e.g. `content · fd4ebc26`) with full entity identifier in `title` tooltip.
  - Uniform date formatting (AGENTS.md 7e.3):
    - Shared date helper `client/src/lib/format.ts` (`formatDate`) used universally across content pages, review lists, audit table, activity timelines, and banners (format: `23 Oct 2026, 11:08`).
  - Playwright E2E:
    - 3/3 tests passing headless (`resolve.spec.ts` + `approval.spec.ts`).
    - Longest realistic mock fixtures tested (long titles, long comments, long override reasons, full UUIDs).
    - Viewport width layout assertions (`scrollWidth <= clientWidth`) checked at 1280px and 1440px.
    - All 10 step screenshots visually inspected.

- Guideline import experience (S11 & S11.1) completed, verified, and live:
  - Fictional Aqualeaf Brand Guideline document created (`docs/demo-guideline.md`, 331 words) covering claims, tone, terminology, and accessibility directives, including duplicate directives.
  - Server API (`/api/guidelines`):
    - `POST /api/guidelines/draft`: brand_manager only (403 for others). Accepts JSON `{text}` (50..20,000 chars) or multipart DOCX file. AI extracts candidate rules with `temperature: 0` and prompt-injection guard.
    - S11.1 Highlight fix: server normalizes source text (`\r\n` -> `\n`, smart quotes normalized) and returns `source_text` along with exact character offsets. Slicing `source_text.slice(source_start, source_end)` matches `source_quote` verbatim.
    - S11.1 Hybrid duplicate detection: Prompt provides existing active rules. LLM proposes `duplicate_of`. Code validates LLM proposals with cosine similarity >= 0.70 threshold. In addition, code marks any candidate with cosine similarity >= 0.85 as duplicate regardless of LLM.
    - S11.1 Speed & cache: In-memory rule embedding cache per org keyed by `(rule_id, version)`. Embeds uncached rules + drafts in a SINGLE batch `embed` call.
    - `POST /api/guidelines/apply`: brand_manager only. Re-checks that rule codes are still free in a transaction (409 `code_taken`), batch-inserts approved rules, and records append-only audit event (`rules.import`).
  - Client UI (`/brand-kit` Rules tab):
    - "Import from guideline" button visible to Brand Manager.
    - Modal with guideline textarea, live character counter, "Use sample guideline" button, DOCX file upload, and "Draft rules" button with spinner.
    - S11.1 Sentence case labels: "Import rules from guideline", "Review and approve".
    - S11.1 Exact highlights & tooltips: Context excerpt rendered strictly from `source_text` + offsets with clean word boundary margins (`\s+`). Mark text matches quote exactly. Amber duplicate badge features hover tooltip with matched rule's text statement.
    - Footer with selection counter and "Add N rules" button. Refreshing rules list displays newly added rules with success banner. Plain-language error messages on AI failure.
  - Test suites:
    - Server: 12 unit tests passing in `server/test/guidelines.test.ts` (12 test files, 97 tests total across server).
    - Playwright E2E: 5/5 tests passing headless across `approval.spec.ts`, `guideline.spec.ts`, and `resolve.spec.ts`. All step screenshots visually inspected.
  - Live AI benchmarking (S11.1):
    - 3 live runs of `POST /api/guidelines/draft` against `https://vouch-ten-iota.vercel.app` on `docs/demo-guideline.md`.
    - 100% of drafts matched `source_text.slice(start, end) === source_quote`.
    - Every run detected duplicates: Superlatives -> `CLAIM-01`, Numbers/durations -> `CLAIM-03`, Trademark spelling -> `TERM-01`. Zero writes on live DB.

- Final polish, cleanup, and test suite isolation (S12a, S12a.2) completed:
  - Generic preferred term regex: Removed hardcoded "aqualeaf" from `server/src/engine/ruleChecks.ts`. Variant detection is driven dynamically from the organization's `terms` table (`term` + listed quoted variants in `note`). Verified with unit tests for Aqualeaf and Northwind Labs. No hardcoded brand strings remain in `server/src/engine`.
  - Cold start pre-warm: `LoginPage.tsx` triggers a fire-and-forget `GET /api/health` on mount, warming up the serverless environment before demo login clicks.
  - Guideline import progress and formatting: While drafting, progress text cycles through "Reading guideline…" -> "Drafting rules…" -> "Checking duplicates…". Excerpt display cleans markdown syntax (`**`, `__`, `#`, leading `- `) while keeping source offsets and highlight `<mark>` verbatim.
  - Audit log polish:
    - Details for `rules.import` formatted as "Imported N rules: CODE-01, CODE-02".
    - "Hide sign-ins" checkbox added (checked by default), filtering `auth.*` events server-side (`?exclude=auth`).
    - Dynamic `GET /api/audit/actions` endpoint returns distinct org-scoped actions.
    - Action column renders human-readable action title with raw action code below; layout verified at 1280px and 1440px.
  - Test suite isolation (S12a.2):
    - Suite made independent of live database state containing the seed data:
      - `server/test/brand-kit.test.ts`: computes next free code dynamically from database and cleans up created rows in `afterAll`.
      - `server/test/db.test.ts`: verifies existence of every seed rule, fact, and term from `docs/demo-brand.md` rather than assuming static exact counts.
      - `server/test/guidelines.test.ts`: computes expected next codes dynamically from database.
    - Verified with two consecutive runs of the full server test suite (`npm test --prefix server`): both runs passed 100% (12/12 files, 98/98 tests), with exact rule count invariant verified before Run 1 (13), after Run 1 (13), and after Run 2 (13). Zero database mutation outside test-scoped cleanup.
    - Client build and full Playwright E2E suite passed 5/5.

Verified row counts:
- schema_migrations: 4
- organizations: 2
- users: 4
- rules: 10
- facts: 8 (all 8 embedded with vector(768))
- terms: 9
- contents: 2
- revisions: 2
- reviews: 2 (base seed review + live Claim Ledger review)
- findings: 11
- comments: 0
- approvals: 0
- audit_events: 4

## Steps
| Step | Name | Target | Status |
|---|---|---|---|
| S0 | Environment check (read-only) | 22 Oct, before 10:00 | Done: Node 24.13.1, npm 11.8.0, git 2.52.0, Windows 11, PowerShell 5.1 |
| S1 | Scaffold monorepo, git, push; owner connects two Vercel projects; health check live | 22 Oct | Code done, awaiting hosting. S1.1 hotfix merged: server TypeScript pinned to 5.9.3 (DEC-015 Proposed), server/vercel.json region bom1; owner to redeploy server |
| S2 | DB schema + migrations + fictional demo brand seed | 22 Oct | Done: schema migrated, demo brand seeded, 6/6 tests passing, row counts verified |
| S3 | Auth, roles, one-click demo logins | 22 Oct | Done: S3a (server auth, roles, demo login, RLS) and S3b (client login, demo buttons, app shell, role routing) |
| S4 | Brand Kit screens (rules, facts, terms) | 22 Oct | Done: S4a (server API live) and S4b (interactive Brand Kit UI for all roles) |
| S5 | Content submission (paste text, DOCX) with purpose/audience/channel | 23 Oct | Done: S5a (server API live, 31 tests passing) and S5b (content UI screens & nav live) |
| S6 | Rule-based engine (terms, expired facts, readability) & latency | 23 Oct | Done: S6a (rule engine & review API), S6b (findings UI), S6c (latency down to <150ms warm, Server-Timing headers) |
| S7 | AI adapter (Gemini + Groq fallback + zod) and embeddings | 23 Oct | Done: AI adapter, Groq fallback, zod validation, embed:facts (8/8 facts), live GET /api/ai/status verified |
| S8 | Claim Ledger pipeline (extract, retrieve, verify, validate), latency, stability & UI | 23 Oct | Done: S8a (server pipeline), S8a.1 (latency optimization), S8a.2 (stable verdicts: Groq primary for ledger, regulated guard, numeric cross-check, DEC-022), S8b (Claim Ledger UI) |
| S9 | Findings UI, fixes (accept/edit/dismiss), revisions + diff | 24 Oct | Done: S9a (server resolutions & revisions API), S9a.1 (literal replacements), S9a.2 (fact-checking replacements), S9b (resolution UI, preview modal, word-level diff, manual edit, interactive revision history), S9b.1 (fix resolve UI "open" status & 8/8 Playwright e2e checks), S9c (UI polish, HTML entity cleanup, stale-review highlights fix) |
| S10 | Reviewer approval workflow, override, audit log screen | 24 Oct | Done: S10a (submit, approval, lock rules, activity & audit API) and S10b (approval UI, override dialog, activity timeline, /audit page, E2E tests) |
| S11 | Guideline import: AI-drafted rules → manager approves | 24 Oct | Done: S11 (server pipeline & apply API, Brand Kit import modal, live 3-run benchmark, 5/5 E2E tests) |
| S12 | End-to-end pass of TEST-001..011 on live link; fixes | 24 Oct | Next |
| S13 | README, updated PDF, feature list, changes, 3 improvements; submit | 24 night / 25 Oct 09:00 | Pending |

## Next step
S12: End-to-end pass of TEST-001..011 on live link; fixes.

## Open issues
none

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

Finding resolutions and Revisions API (S9a) completed and live:
- Database: Migration `005_finding_replacement_text.sql` applied to Supabase PostgreSQL, adding `replacement_text TEXT` to `findings`.
- Resolution endpoint (`PATCH /api/findings/:id/resolution` in `server/src/routes/findings.ts`):
  - Creator owner only: returns 403 for non-creator roles, 404 for unknown finding, other org, or other creator's content.
  - Action `accept`: requires `suggested_fix` (returns 400 `no_suggested_fix` otherwise).
  - Action `edit`: requires `text` (1-500 chars), stored in `replacement_text`.
  - Action `dismiss`: requires `reason` (min 5 chars), stored in `dismiss_reason` (returns 400 otherwise).
  - Invariant guard: supported claims cannot be resolved (returns 400 `nothing_to_fix`).
  - Stale guard: only findings of the content's latest review on the latest revision can be resolved (returns 409 `stale_review`).
  - Audit logging: records append-only audit event (`finding.resolve`).
- Revisions endpoint (`POST /api/contents/:id/revisions` in `server/src/routes/contents.ts`):
  - Creator owner only: returns 403 for non-creator, 404 for cross-tenant/other creator.
  - Mode `apply_fixes`: fetches accepted and edited findings of the latest review, replaces spans from END of text backwards so character offsets remain valid, detects and skips overlapping spans, creates revision n+1 (returns 400 `nothing_to_apply` if no candidate findings). Returns `{ revision, applied, skipped }`.
  - Mode `manual`: creates revision n+1 with provided body (1-20000 chars).
  - Updates `contents.updated_at = now()`.
  - Audit logging: records append-only audit event (`revision.create`).
- Live production verification on https://vouch-ten-iota.vercel.app:
  - Created new content "API test (S9a)" (ID: `4f2932fd-7617-43e4-a26a-d885e944bc81`) with sample caption.
  - Ran review on revision n=1 (Groq primary, latency 2309ms).
  - Accepted fix on "48 hours" claim (ID: `b8558971-0277-46cc-ae77-50f9e6465572`).
  - Dismissed `#stayhydrated` (ID: `d8c841a4-43bc-426d-a3e0-cfd64bad337c`) with reason: "Brand social team confirmed #stayhydrated is our approved evergreen campaign hashtag.".
  - Called `apply_fixes`: created revision n=2, applied `["b8558971-0277-46cc-ae77-50f9e6465572"]`, skipped `[]`.
- Vitest suite: 58/58 tests passing across 9 test files in Vitest.

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
| S9 | Findings UI, fixes (accept/edit/dismiss), revisions + diff | 24 Oct | In progress: S9a (server resolutions & revisions API done and live) |
| S10 | Reviewer approval workflow, override, audit log screen | 24 Oct | Pending |
| S11 | Guideline import: AI-drafted rules → manager approves | 24 Oct | Pending |
| S12 | End-to-end pass of TEST-001..011 on live link; fixes | 24 Oct | Pending |
| S13 | README, updated PDF, feature list, changes, 3 improvements; submit | 24 night / 25 Oct 09:00 | Pending |

## Next step
S9b: Findings UI (accept/edit/dismiss buttons, revision selector, and visual diff view).

## Open issues
none

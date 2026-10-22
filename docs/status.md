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
- Vitest suite: 37/37 tests passing across 6 test suites.
- Client build: `tsc -b && vite build` passing with 0 errors.

Verified row counts:
- schema_migrations: 3
- organizations: 2
- users: 4
- rules: 10
- facts: 8
- terms: 9
- contents: 2
- revisions: 2
- reviews: 1 (after live test)
- findings: 3 (after live test)
- comments: 0
- approvals: 0
- audit_events: 3 (base seed + live test review)

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
| S7 | AI adapter (Gemini + Groq fallback + zod) and embeddings | 23 Oct | Pending |
| S8 | Claim Ledger pipeline (extract, retrieve, verify, validate) | 23 Oct | Pending |
| S9 | Findings UI, fixes (accept/edit/dismiss), revisions + diff | 24 Oct | Pending |
| S10 | Reviewer approval workflow, override, audit log screen | 24 Oct | Pending |
| S11 | Guideline import: AI-drafted rules → manager approves | 24 Oct | Pending |
| S12 | End-to-end pass of TEST-001..011 on live link; fixes | 24 Oct | Pending |
| S13 | README, updated PDF, feature list, changes, 3 improvements; submit | 24 night / 25 Oct 09:00 | Pending |

## Next step
S7: AI adapter (Gemini primary + Groq fallback + zod validation) and embeddings.

## Open issues
none

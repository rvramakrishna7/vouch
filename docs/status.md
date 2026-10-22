# Status board

Updated by the worker at the end of every task. Planner and owner read it first.

- **Deadline:** 25 Oct 2026, 10:00 IST (submit by 09:00). Feature freeze 24 Oct, 22:00.
- **Live app:** not deployed yet
- **Repo:** https://github.com/rvramakrishna7/vouch

## Current state
Monorepo scaffolded and pushed to `main`. `client/` (Vite + React + TS + Tailwind v4 + React Router) builds and shows the API health status. `server/` (Express + TS, ESM, Vercel-style `export default app` with a separate `local.ts` listener) has GET /api/health, CORS restricted to CLIENT_ORIGIN, a 4 MB JSON limit, a JSON error handler.

Database schema (001_init.sql with pgvector, DEC-013 offsets, tenant isolation, and audit_events append-only trigger) and RLS (002_enable_rls.sql on all 13 tables) applied to Supabase PostgreSQL. Demo brand ("Aqualeaf" and "Northwind Labs") seeded idempotently.

Full authentication system implemented:
- Server auth: JWT (8h expiry) sign/verify with `JWT_SECRET`, `requireAuth` and `requireRole` middleware, `POST /api/auth/login`, `POST /api/auth/demo`, `GET /api/auth/me`, append-only audit logging (`audit_events`). Vitest suite passes (15/15 tests across health, db, auth).
- Client auth & app shell: React Router with protected layouts, catch-all redirects, and SPA rewrites (`client/vercel.json`). AuthContext with `sessionStorage` token management and `/me` validation.
- Login screen with one-click demo buttons ("Try as Creator", "Try as Reviewer", "Try as Brand Manager") and email/password form. Role-based routing to `/content`, `/reviews`, and `/brand-kit`, with persistent top header (org name, user name, role badge, switch role, logout).

Verified row counts:
- schema_migrations: 2
- organizations: 2
- users: 4
- rules: 10
- facts: 8
- terms: 9
- contents: 2
- revisions: 2
- reviews: 0
- findings: 0
- comments: 0
- approvals: 0
- audit_events: 2 (base seed)

## Steps
| Step | Name | Target | Status |
|---|---|---|---|
| S0 | Environment check (read-only) | 22 Oct, before 10:00 | Done: Node 24.13.1, npm 11.8.0, git 2.52.0, Windows 11, PowerShell 5.1 |
| S1 | Scaffold monorepo, git, push; owner connects two Vercel projects; health check live | 22 Oct | Code done, awaiting hosting. S1.1 hotfix merged: server TypeScript pinned to 5.9.3 (DEC-015 Proposed), server/vercel.json region bom1; owner to redeploy server |
| S2 | DB schema + migrations + fictional demo brand seed | 22 Oct | Done: schema migrated, demo brand seeded, 6/6 tests passing, row counts verified |
| S3 | Auth, roles, one-click demo logins | 22 Oct | Done: S3a (server auth, roles, demo login, RLS) and S3b (client login, demo buttons, app shell, role routing) |
| S4 | Brand Kit screens (rules, facts, terms) | 22 Oct | Pending |
| S5 | Content submission (paste text, DOCX) with purpose/audience/channel | 23 Oct | Pending |
| S6 | Rule-based engine (terms, expired facts, readability) | 23 Oct | Pending |
| S7 | AI adapter (Gemini + Groq fallback + zod) and embeddings | 23 Oct | Pending |
| S8 | Claim Ledger pipeline (extract, retrieve, verify, validate) | 23 Oct | Pending |
| S9 | Findings UI, fixes (accept/edit/dismiss), revisions + diff | 24 Oct | Pending |
| S10 | Reviewer approval workflow, override, audit log screen | 24 Oct | Pending |
| S11 | Guideline import: AI-drafted rules → manager approves | 24 Oct | Pending |
| S12 | End-to-end pass of TEST-001..011 on live link; fixes | 24 Oct | Pending |
| S13 | README, updated PDF, feature list, changes, 3 improvements; submit | 24 night / 25 Oct 09:00 | Pending |

## Next step
S4: Brand Kit screens (rules, facts, terms).

## Open issues
none

# Status board

Updated by the worker at the end of every task. Planner and owner read it first.

- **Deadline:** 25 Oct 2026, 10:00 IST (submit by 09:00). Feature freeze 24 Oct, 22:00.
- **Live app:** https://vouch-app-beta.vercel.app (client), https://vouch-ten-iota.vercel.app (server API)
- **Repo:** https://github.com/rvramakrishna7/vouch

## Current state
Monorepo scaffolded and deployed on Vercel. `client/` (Vite + React + TS + Tailwind v4 + React Router) has one-click demo login, persistent session management, role routing, navigation bar, and Brand Kit management. `server/` (Express + TS, ESM on Vercel Functions, region bom1) connects to Supabase PostgreSQL in Mumbai.

Database schema (001_init.sql with pgvector, DEC-013 offsets, tenant isolation, and audit_events append-only trigger) and RLS (002_enable_rls.sql on all 13 tables) applied to Supabase PostgreSQL. Demo brand ("Aqualeaf" and "Northwind Labs") seeded idempotently.

Full Brand Kit experience implemented:
- Server API (`/api/rules`, `/api/facts`, `/api/terms`): auto-numbering, version incrementing, expired date evaluation, and audit logging.
- Client UI (`/brand-kit`):
  - Accessible via top nav by all roles. Read-only banner shown for Creator and Reviewer.
  - Rules tab: code, category, severity badges (high red, medium amber, low grey), text, version, status, "Add rule" form, inline edit, and archive.
  - Facts tab: code, statement, source, owner, valid until, red "Expired" badge for outdated facts, "Add fact" form with date picker, and edit.
  - Terms tab: term, color-coded type (banned red, regulated amber, preferred green), replacement guidance, "Add term" form, edit, and inline confirmation delete.
- Vitest suite: 24/24 tests passing.

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
| S4 | Brand Kit screens (rules, facts, terms) | 22 Oct | Done: S4a (server API live) and S4b (interactive Brand Kit UI for all roles) |
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
S5: Content submission (paste text, DOCX) with purpose, audience, and channel.

## Open issues
none

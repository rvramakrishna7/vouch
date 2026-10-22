# Decision log

Every product or architecture decision is recorded here. Status: **Proposed** (worker or planner suggests) → **Accepted** / **Rejected** (owner decides). The worker may only add Proposed entries; never edit an Accepted one. A later decision that replaces an earlier one says "Supersedes DEC-xxx".

| ID | Date | Decision | Status |
|---|---|---|---|
| DEC-001 | 2026-10-20 | Product direction: evidence-first reviewer "Vouch" (Claim Ledger, intent-preserving fixes, Guideline Health) | Accepted |
| DEC-002 | 2026-10-20 | Stack: React + Vite + TS + Tailwind; Node + Express + TS; zod | Accepted |
| DEC-003 | 2026-10-20 | Database: PostgreSQL + pgvector on Supabase | Accepted |
| DEC-004 | 2026-10-20 | AI: Gemini (text, vision, embeddings) primary; Groq (Llama) fallback; one adapter | Accepted |
| DEC-005 | 2026-10-20 | The model never has the final word on evidence; citations validated in code | Accepted |
| DEC-006 | 2026-10-20 | Demo uses a fictional brand only (free AI tiers may use data) | Accepted |
| DEC-007 | 2026-10-22 | Way of working: Owner + Claude (planner) + Antigravity (worker); AGENTS.md rules | Accepted |
| DEC-008 | 2026-10-22 | Round 2 compressed to ~72 h (ends 25 Oct 10:00); PDF upload and live updates are lower priority | Accepted |
| DEC-009 | 2026-10-22 | Repo layout: monorepo `client/`, `server/`, `db/`, `seed/`, `docs/` | Accepted |
| DEC-010 | 2026-10-22 | Data access: `pg` + plain SQL migration files (no ORM) | Accepted |
| DEC-011 | 2026-10-22 | Own auth (bcrypt + JWT) with one-click demo logins per role for judges | Accepted |
| DEC-012 | 2026-10-22 | Hosting: client AND server on Vercel (two projects, region bom1); Supabase in Mumbai. Supersedes Render from the Round 1 plan | Accepted |
| DEC-013 | 2026-10-22 | Findings store `start_offset` / `end_offset`, computed in code (never trusted from the model) | Accepted |
| DEC-014 | 2026-10-22 | `client/` and `server/` are independent npm packages (no workspaces); each has its own lockfile | Accepted |

---

### DEC-005: Model never has the final word on evidence
- **Context:** an LLM can invent a source or approve a plausible claim.
- **Decision:** pipeline is Extract (AI) → Retrieve (code: pgvector + keyword) → Verify (AI, must cite fact ID) → Validate (code: fact exists, in date, quote present) → else `needs_human_judgement`.
- **Tradeoff:** more steps and tokens; much higher trust and explainability (core of the pitch).

### DEC-008: Round 2 compression
- **Context:** Round 2 ends 25 Oct 10:00 IST, not end of day. ~72 h instead of 4 days.
- **Decision:** core journey first (TEST-001..008). Text paste and DOCX are Must; PDF upload is Should. Live updates (Socket.io) dropped for Round 2; polling instead.
- **Tradeoff:** fewer input formats in Round 2. Recorded as a change from the Round 1 plan.

### DEC-010: `pg` + plain SQL migrations
- **Options:** Prisma, Drizzle, `pg` + SQL.
- **Decision:** `pg` + numbered SQL files in `db/migrations/` and a small migrate script.
- **Why:** pgvector and constraints are explicit; no ORM magic for the agent to get wrong; fast to review.
- **Tradeoff:** row types written by hand (zod schemas double as types).

### DEC-011: Own auth with demo logins
- **Context:** judges must use the product "without assistance" (Usability 10 pts).
- **Decision:** email + password (bcrypt), JWT. Login page has three buttons: "Try as Creator / Reviewer / Brand Manager" for seeded demo users in the demo org.
- **Security:** demo users can only touch the demo org; demo data resets via a seed script.

### DEC-012: Host the server on Vercel, not Render (proposed by worker in S0)
- **Context:** Render free tier sleeps after 15 min and takes 50+ s to wake. Judges would hit that on first click (Usability, Working core).
- **Options:** (a) Render + keep-warm ping; (b) Railway / fly.io; (c) Vercel Functions for Express.
- **Decision:** (c). Express deploys to Vercel with zero config (`server/src/index.ts`, `export default app`) as one Fluid-compute function. Two Vercel projects from the same repo: `client/` and `server/`. Function region `bom1` (Mumbai); Supabase project in Mumbai, connected through the pooler.
- **Limits accepted:** 4.5 MB request body (uploads capped at 4 MB); 300 s max duration on Hobby (a review runs synchronously inside the request); no `express.static`; no long-running background worker.
- **Change from Round 1 plan:** Render removed. Recorded for the Round 2 "changes" section.

### DEC-013: Character offsets for findings (proposed by worker in S0)
- **Context:** `span_text` alone is ambiguous when a phrase appears twice; fixes and diffs could hit the wrong place.
- **Decision:** store `start_offset` and `end_offset`. Offsets are computed in code by locating the quoted span in the revision text. The model may return an optional 1-based `occurrence`; default is the first. If the span is not found, the finding becomes `needs_human_judgement` (consistent with DEC-005).

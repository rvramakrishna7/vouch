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
| DEC-015 | 2026-10-22 | Server pinned to TypeScript 5.9 because Vercel's builder fails with TS 7.0.2 (TS2688 for 'node'); revisit after Round 3 | Accepted |
| DEC-016 | 2026-10-22 | Supabase pooler TLS: rejectUnauthorized:false with warning unless SUPABASE_CA_CERT is provided | Accepted |
| DEC-017 | 2026-10-22 | JWT (8h expiry) sent as Authorization: Bearer; client stores it in sessionStorage (client and server are different vercel.app sites, so cookies are unreliable) | Accepted |
| DEC-018 | 2026-10-22 | RLS enabled on every table in schema public with no policies, so Supabase's public Data API cannot read data. The server's postgres role bypasses RLS | Accepted |
| DEC-019 | 2026-10-22 | Plain fetch for AI adapter (Gemini and Groq) instead of vendor SDKs to minimize function cold starts and simplify timeout handling | Proposed |

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

### DEC-015: Pin server TypeScript to 5.9 (proposed by worker in S1.1)
- **Context:** on Vercel, `npm run build` (`tsc --noEmit`) passed, then Vercel's own transpile step ("Using the TypeScript 7.0.2 compiler executable") failed with TS2688 "Cannot find type definition file for 'node'". Locally everything passed.
- **Decision:** `server/` devDependency `typescript` pinned to `~5.9` (5.9.3). `tsconfig.json` keeps `"types": ["node"]`. `@types/node` 26.6.5 declares support for TS >= 5.6, so no type package was downgraded.
- **Tradeoff:** we stay on the older compiler and miss TS 7 speed. Revisit after Round 3.

### DEC-016: Supabase pooler TLS configuration
- **Context:** Supabase Transaction pooler uses a certificate chain that causes `SELF_SIGNED_CERT_IN_CHAIN` on Node clients without custom CA certs bundled.
- **Decision:** Accepted with condition: if env `SUPABASE_CA_CERT` is set, use it as `ssl.ca` with verification on (`rejectUnauthorized: true`); otherwise `rejectUnauthorized: false` and log one warning at startup.
- **Tradeoff:** Enables immediate connectivity across dev/serverless environments without manual cert installation, while allowing hardened verification via env var.

### DEC-017: JWT authentication via Authorization Bearer header
- **Context:** Client and server deploy to different vercel.app domains, making cross-site cookies unreliable across browsers.
- **Decision:** JWT (8h expiry) sent as `Authorization: Bearer <token>`; client stores it in `sessionStorage`.
- **Tradeoff:** Tokens are kept per-session in the browser tab and must be attached to fetch requests explicitly.

### DEC-018: Row Level Security on public tables without policies
- **Context:** Supabase exposes PostgREST public Data API by default on schema `public`.
- **Decision:** Enable RLS (`ALTER TABLE <t> ENABLE ROW LEVEL SECURITY`) on all tables with no policies. Supabase's anonymous/authenticated REST APIs cannot read or write data. The backend connects using the `postgres` superuser/bypass-rls role through Express.
- **Tradeoff:** Direct Supabase client access is disabled; all data access routes through Express with tenant isolation.


### DEC-019: Plain fetch for AI adapter (proposed by worker in S7)
- **Context:** Gemini and Groq APIs are called from server/src/ai/. Using vendor SDKs adds large transitive dependencies and potential version conflicts on Vercel Functions.
- **Decision (Proposed):** Call REST endpoints directly using standard globalThis.fetch with AbortSignal.timeout(timeoutMs).
- **Why:** Keeps Vercel deployment minimal, guarantees clean cold starts, supports exact request-body inspection, and enables zero-dependency mocking in Vitest.
- **Tradeoff:** Request and response envelopes are written manually with zod validation rather than through SDK types.
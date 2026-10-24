# Vouch: every claim, backed by proof

**Vouch is an evidence-first brand-governance reviewer.** Before marketing content goes out, Vouch checks every claim in it against the brand's own approved facts and numbered rules, shows the proof (or the lack of it) next to each sentence, suggests a fix that keeps the writer's intent, and records who approved what and why.

Built by team **RESTART CODE** (R V Ramakrishna) for the TechCircuit hackathon, problem statement by Inkloom AI (brand-governance content review).

| | |
|---|---|
| **Live app** | https://vouch-app-beta.vercel.app |
| **API** | https://vouch-ten-iota.vercel.app (health: `/api/health`) |
| **Repository** | https://github.com/rvramakrishna7/vouch |

No sign-up needed: the login page has one-click demo buttons for each role (fictional demo brand "Aqualeaf").

| Button | Demo user | Role |
|---|---|---|
| Try as Brand Manager | Priya Sharma | Owns the Brand Kit (rules, facts, terms), imports guidelines |
| Try as Creator | Arjun Mehta | Writes content, runs reviews, applies fixes, submits |
| Try as Reviewer | Neha Iyer | Approves or requests changes, reads the audit log |

---

## The problem

Brand teams publish claims ("India's No.1", "eco-friendly", "keeps drinks cold for 48 hours") that are often unproven, out of date, or contradict the company's own test data. Generic AI writing checkers rewrite tone but cannot say **which approved fact proves a claim** or **which rule it breaks**, and they happily invent citations. Reviewers end up re-checking everything by hand, and nobody can show later why a piece was approved.

## What Vouch does

1. **Brand Kit as the single source of truth.** Numbered rules (`CLAIM-01`, `TONE-02`, ...), approved facts with source and expiry date (`F-12`, valid until ...), and controlled terms (banned, preferred, regulated, with replacements).
2. **Claim Ledger.** Every factual claim in a draft is extracted and given a verdict, each with a citation:
   - **Supported**: backed by an in-date approved fact (e.g. "40% lighter" → `F-12`)
   - **Outdated**: the matching fact has expired (e.g. "Rated 4.8" → `F-03`, expired)
   - **Contradicted**: an approved fact says something different (e.g. "48 hours" vs `F-15` "24 hours", rule `CLAIM-03`)
   - **Unsupported**: no fact backs it (e.g. "India's No.1" → rule `CLAIM-01`)
   - **Needs human judgement**: regulated wording or any case where the evidence check fails
3. **Rule checks** for terminology, tone and accessibility (e.g. banned terms, brand spelling, CamelCase hashtags for screen readers), each citing its rule.
4. **Intent-preserving fixes.** Creators accept, edit or dismiss each finding (dismiss needs a reason). Fixes are themselves fact-checked: a suggested replacement may not reuse an expired fact or introduce a number that no fact supports. Accepted fixes produce a new revision with a word-level diff.
5. **Approval workflow.** Creator submits → Reviewer approves or requests changes. Approving while a high-severity issue is open, or when the AI check was unavailable, requires a written **override reason**. Approved content is locked.
6. **Append-only audit log and activity timeline.** Every action (review, fix, revision, submit, decision, rule change) is recorded with actor and details; the database rejects updates and deletes on the audit table.
7. **Guideline import.** A Brand Manager pastes (or uploads as DOCX) a written brand guideline; AI drafts numbered rules, each with the exact source sentence highlighted, and flags rules that duplicate existing ones. Nothing is saved until the manager approves.
8. **AI disclosure on every review**: which rule engine, AI provider and model produced the findings, and how long it took.
9. **Works everywhere**: responsive from phone (375 px) to desktop, with light and dark themes (follows the system setting, toggle in the header) checked for WCAG AA contrast.

## Why the AI can be trusted here: the model never has the final word

The language model proposes; code decides. After the single AI call, the server validates every verdict (see `docs/claim-ledger-spec.md`):

- The quoted claim must exist in the text; character offsets are computed by code, not by the model.
- A cited fact must be one of the facts retrieved for that sentence; expiry is decided by code from `valid_until`.
- Regulated terms can never be marked "Supported" by the model alone (→ needs human judgement).
- Numeric cross-check: same unit, different number than the approved fact → Contradicted, citing the fact.
- A finding without a valid rule or fact citation is shown only as a suggestion, never as a violation.
- AI output is validated with zod; invalid output is retried once, then marked needs human judgement.
- If every AI provider is down, rule-based findings are still returned and the UI says "AI unavailable".
- Submitted content is treated as data, never as instructions (prompt-injection guard).

Guideline import follows the same principle: every drafted rule must quote the guideline verbatim (checked by code), rule codes are assigned by code, and duplicates are confirmed by embedding similarity.

## Architecture

```
client/  React 19 + Vite + TypeScript + Tailwind v4 (SPA)
   │  REST (JWT bearer)
   ▼
server/  Express 5 + TypeScript (one Vercel Function, region bom1 / Mumbai)
   ├─ routes/      zod-validated API (auth, rules, facts, terms, contents, findings, guidelines, audit)
   ├─ engine/      deterministic rule checks (no AI)
   ├─ ledger/      claim pipeline: sentences → embeddings → top-3 facts per sentence (pgvector) → ONE LLM call → code validation
   ├─ guidelines/  guideline → drafted rules with verified quotes and duplicate check
   ├─ ai/          the ONLY place that calls AI providers (fallback, retries, timeouts, test hooks)
   └─ db/          pg pool, plain SQL
db/migrations/*.sql → Supabase Postgres + pgvector (Mumbai)
```

**AI providers (free tiers):** Groq `openai/gpt-oss-120b` (primary for the Claim Ledger, temperature 0), Google Gemini `gemini-3.5-flash-lite` (fallback with timeout; primary for guideline drafting), Gemini `gemini-embedding-001` (768-dim embeddings). Provider failures (429/5xx/timeouts) fall back automatically.

**Performance (measured on the live deployment):** one-click login to the content list in under 1 s, a full review in about 1.5-4 s, guideline drafting in about 5 s. `Server-Timing` headers break every request down into auth / db / ai / embed; a scheduled ping keeps the serverless function warm.

**Security and data:** bcrypt passwords, JWT (8 h) in sessionStorage, role checks on every route, `organization_id` filter on every query (other organisations' ids return 404), Row Level Security enabled on all tables, append-only audit trigger, CORS limited to the client origin, secrets only in environment variables, uploads limited to 4 MB.

## Tests

- **Server:** Vitest + Supertest, 100 tests across 12 files, including citation validation with mocked AI output, AI fallback and outage behaviour, tenant isolation, approval and lock rules, guideline import, and audit immutability.
- **Client (mocked API):** Playwright end-to-end tests for the resolve, approval and guideline-import flows; a responsive suite that checks every page at 375, 768, 1024, 1280 and 1440 px for overflow, touch-target size and clean text; and a theme suite that runs axe-core WCAG AA contrast checks on every page and modal in light and dark mode.
- **Live acceptance:** a Playwright run against the deployed app with the real AI that walks TEST-001..011 from `docs/plan.md` end to end (Brand Kit edits, DOCX upload, review verdicts, fixes, revisions, approval with override, audit log, cross-tenant 404), at 1280 px light and 375 px dark.

```bash
npm test --prefix server        # needs DATABASE_URL in server/.env
npm run test:e2e --prefix client   # mocked API
npm run test:live --prefix client  # against the deployed app (creates demo data)
```

## Run locally

Requirements: Node.js 22+, a PostgreSQL database with the `vector` extension (e.g. a free Supabase project), a Gemini API key and a Groq API key.

```bash
git clone https://github.com/rvramakrishna7/vouch.git
cd vouch

# server
cd server
npm install
cp .env.example .env            # then fill in the values below
npm run db:migrate
npm run db:seed                 # fictional demo brand "Aqualeaf" + demo users
npm run embed:facts             # embeddings for the approved facts
npm run dev                     # http://localhost:3001

# client (new terminal)
cd client
npm install
echo "VITE_API_URL=http://localhost:3001" > .env
npm run dev                     # http://localhost:5173
```

Server environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (URL-encode special characters in the password) |
| `JWT_SECRET` | Secret for signing login tokens |
| `CLIENT_ORIGIN` | Allowed CORS origin, e.g. `http://localhost:5173` |
| `GEMINI_API_KEY` | Google AI Studio key |
| `GROQ_API_KEY` | Groq key |
| `DEMO_LOGIN_ENABLED` | `true` to show the one-click demo logins |
| `LEDGER_PRIMARY_PROVIDER` | Optional, `groq` (default) or `gemini` |
| `AI_FORCE_FAIL` | Test hook only: `gemini` or `all` simulates provider outages |

## Project documents

- `docs/plan.md`: Round 2 scope and acceptance tests
- `docs/claim-ledger-spec.md`: verification pipeline and validation rules
- `docs/decision-log.md`: every product and architecture decision (DEC-001 ...)
- `docs/demo-brand.md`: the fictional demo brand, its rules, facts and expected verdicts
- `docs/status.md`: build log
- `AGENTS.md`: the rules the coding agent had to follow

## How this was built (AI tools disclosure)

All code was written during the Round 2 window (from 22 Oct 2026, 10:00 IST); no code was reused from other projects. Development used AI tools: **Google Antigravity** (Gemini models) as the coding agent, and **Claude** (Anthropic) for planning, task specifications, code review and verification. The owner directed the work and tested every feature on the live app. Libraries are listed in `client/package.json` and `server/package.json`. All demo data is fictional.

## License

See `LICENSE`.

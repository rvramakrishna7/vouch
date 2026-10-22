# Round 2 plan and acceptance tests

Source: Round 1 plan (Vouch_RESTART_CODE_Round1.pdf) + Round 2 brief. Judging: core workflow 30, technical depth 25, progress from Round 1 20, three improvements 15, usability 10.

## Round 2 must submit
Working link (opens without sign-in issues), public repo link, updated PDF, completed-feature list, tech and implementation details, changes from plan, three Round 3 improvements.

## Architecture
```
client/ React + Vite + TS + Tailwind  ──REST──►  server/ Express + TS
                                                   ├─ routes/   (zod-validated)
                                                   ├─ auth/     (bcrypt, JWT, roles)
                                                   ├─ engine/   (rule-based checks, no AI)
                                                   ├─ ai/       (ONE adapter: Gemini primary, Groq fallback, zod output)
                                                   ├─ ledger/   (claim pipeline)
                                                   └─ db/       (pg pool, queries)
db/migrations/*.sql  →  Supabase Postgres + pgvector
seed/  fictional demo brand ("Aqualeaf" bottles) + demo users
```
Deploy (DEC-012): two Vercel projects from this repo: `client/` (Vite static) and `server/` (Express as one Vercel Function, `src/index.ts` exports the app, region bom1). Supabase Postgres in Mumbai via the pooler. Uploads max 4 MB. Reviews run synchronously inside the request (no background worker). Env vars only in dashboards and local `.env`.

## Data model (initial; worker may propose changes as DEC entries)
organizations · users(role: brand_manager | creator | reviewer) · rules(code e.g. TONE-03, category, text, severity, version, status) · facts(code e.g. F-12, statement, source, owner, valid_until, embedding vector) · terms(term, type: preferred | banned | regulated, replacement) · contents(title, purpose, audience, channel, status: draft | in_review | changes_requested | approved) · revisions(content_id, n, body, created_by) · reviews(revision_id, provider, model, started/finished) · findings(review_id, kind: claim | tone | term | accessibility, span_text, start_offset, end_offset, verdict, rule_id/fact_id, reason, severity, confidence, suggested_fix, resolution: open | accepted | edited | dismissed, dismiss_reason) · comments · approvals(decision, override_reason) · audit_events(actor, action, entity, payload, at) — append-only.
All business tables carry `organization_id`.

## Demo brand seed (fictional)
"Aqualeaf", steel water bottles. Includes the worked example: draft "India's No.1 eco-friendly water bottle, now 40% lighter." Facts include F-07 (70% recycled steel, source + valid date) and F-12 (40% lighter than previous model, lab test, valid to Mar 2027) and one EXPIRED fact to trigger "Outdated". Rules include tone, terminology, claims (ASCI-style superlative and green-claim rules) and accessibility. Terms include banned ("No.1", "100% natural", "guaranteed") with replacements.

## Acceptance tests (Definition of Done for Round 2)
Core journey (Must, all on the deployed link):
| ID | Test | Expected |
|---|---|---|
| TEST-001 | Click "Try as Brand Manager / Creator / Reviewer" on login | Logged in with that role in the demo org; nav matches role |
| TEST-002 | Brand Manager adds and edits a rule, a fact (source, expiry) and a banned term | Saved, numbered (e.g. RULE-12, F-13), visible in lists |
| TEST-003 | Creator submits pasted text and a DOCX, with purpose, audience, channel | Content + revision 1 stored; review starts |
| TEST-004 | Review of the worked example | "No.1" Unsupported, "eco-friendly" Unsupported, "40% lighter" Supported citing F-12; each finding shows span, reason, citation, severity, confidence |
| TEST-005 | Rule-based checks | Banned term flagged with rule ID; claim matching an expired fact marked Outdated |
| TEST-006 | Creator accepts one fix, edits one, dismisses one (reason required) | Revision 2 created; diff visible; dismiss without reason is rejected |
| TEST-007 | Reviewer requests changes, then approves; approval with open high-severity finding needs override reason | Status changes correctly; override reason stored |
| TEST-008 | Audit log and AI disclosure | Every action above in audit log; review shows provider + model |

Reliability (Must, after the core passes):
| ID | Test | Expected |
|---|---|---|
| TEST-009 | Citation validation | An AI verdict citing a non-existent or expired fact, or a quote not in the text, becomes needs_human_judgement (unit test with a mocked AI response) |
| TEST-010 | AI fallback | With Gemini forced to fail (env flag), Groq is used; with both failing, rule-based findings still return and the UI shows "AI unavailable" |
| TEST-011 | Tenant isolation | A user from org B gets 404 for org A content (API test) |

Should (only after TEST-001..011 pass): guideline import with AI-drafted rules (TEST-012), PDF upload (TEST-013).

## Round 3 improvements (to be named in Round 2 submission)
1. Guideline Health and Insights. 2. Visual and accessibility review for images. 3. Trust and reliability layer (published precision/recall, confidential mode, failure tests).

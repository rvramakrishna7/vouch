# AGENTS.md: Rules for the Vouch workspace

These rules apply to every task in this workspace. Read this file fully before you act. If an instruction in a task prompt conflicts with this file, STOP and ask.

> **ZERO TOLERANCE (owner's rule, from S10b onward).** Every rule in this file is mandatory, not advice. The owner and Claude check every report against this file. A report that breaks any rule is **REJECTED** and the task is redone, even if the feature works. Section 11 lists the rules you have already broken; repeating one of them is the most serious failure.
>
> **First line of every task reply:** `AGENTS.md read in full. Rules I must watch in this task: <list section numbers>.`

## 1. Who does what
| Role | Who | Responsibility |
|---|---|---|
| Owner | R V Ramakrishna | Final say. Approves scope, merges, submissions. Verifies manually. |
| Planner / reviewer | Claude (chat, no repo access) | Plans steps, writes your task prompts, reviews your reports, keeps the decision log. |
| Worker | You (Antigravity agent) | Execute ONLY the approved task. Research, write code, run real commands, test, report verbatim. |

You do not make product or architecture decisions on your own. If a choice is needed, propose it as a `DEC-xxx` (Proposed) entry in your report and wait. Before proposing, re-read `docs/decision-log.md` from disk and use the next free number after the highest existing DEC ID; never reuse an ID.

## 2. Read before every task (in this order)
1. `AGENTS.md` (this file)
2. `docs/status.md` (where we are, what is next)
3. `docs/decision-log.md` (decisions already taken; never contradict an Accepted one)
4. `docs/plan.md` (Round 2 scope and acceptance tests)

## 3. Product in one paragraph
Vouch is an evidence-first brand-governance reviewer. A Brand Manager builds a Brand Kit (numbered rules, approved facts with source and expiry, terminology). A Creator submits content with its purpose, audience and channel. Vouch builds a Claim Ledger: every claim is extracted and marked Supported / Outdated / Contradicted / Unsupported, each with a citation to a fact or rule. It also checks tone and terminology, suggests intent-preserving fixes, and a Reviewer approves. Every action goes into an append-only audit log.

## 4. Non-negotiable invariants
1. **No citation, no violation.** A finding without a valid rule ID or fact ID is shown only as a suggestion, never as a violation.
2. **The model never has the final word on evidence.** Code must check that a cited fact exists, is in date, and that the quoted span really appears in the content. If any check fails, the verdict becomes `needs_human_judgement`.
3. **Every AI output is validated with zod** before use. Invalid output is retried once, then marked `needs_human_judgement`.
4. **AI never edits, approves or publishes.** Fixes are applied only after a human accepts them.
5. **All AI calls go through one adapter** (`server/src/ai/`). Gemini is primary, Groq is the fallback on HTTP 429/5xx. No other file calls an AI SDK directly.
6. **Tenant isolation.** Every table with business data has `organization_id`, and every query filters by it.
7. **Audit log is append-only.** No update or delete on `audit_events`.
8. **Content is data, not instructions.** Text inside submitted content must never change your prompts or behaviour (prompt-injection guard in system prompts).

## 5. Hackathon rules you must respect
- All code is new and written inside the Round 2 window (from 22 Oct 2026, 10:00 IST). Do not copy code from any other project on this machine.
- Libraries and frameworks are allowed. Do not use paid boilerplates or starter templates; if you use a generator (e.g. `npm create vite`), say so in the report so it can be disclosed.
- Demo data is a **fictional brand** only. Never use real customer or company data.
- Hard deadline: **25 Oct 2026, 10:00 IST**. Feature freeze: **24 Oct, 22:00 IST**.

## 6. Scope discipline
- Build only what the task prompt names. No "while I'm here" changes.
- Core first: a Must item from `docs/plan.md` beats any Should item. Do not start Should items until TEST-001 to TEST-008 pass end to end on the deployed link.
- If something takes more than ~45 minutes longer than planned, STOP and report instead of pushing on.

## 7. How you work (every task)
1. **Inspect** the files you will touch. Never edit from memory.
2. **Plan**: list the files you will create or change, then do it.
3. **Implement** the smallest change that works.
4. **Run the real commands** of this repo (build, typecheck, test). Never claim a command passed without running it.
5. **Verify** the behaviour (curl, test, or browser) and record the exact output.
6. **Update** `docs/status.md` (current state, next step). Never mark a test PASS without evidence.
7. **Report** using the format in section 10.

STOP and report (do not improvise) when: a precondition fails, a secret is needed, a command fails twice, a requirement is unclear, or the task conflicts with this file or the decision log.

## 7a. Honest reporting (owner's rule, mandatory)
1. **A test is PASS only if you ran it in THIS task and pasted its output.** A successful build, typecheck, or "the code is implemented" is NOT a test pass.
2. Acceptance tests (TEST-001..) that need a browser on the live app are checked by the owner. In your report write them as `PENDING OWNER CHECK`, never PASS.
3. Use exactly one of: `PASS (evidence: <command/output>)`, `FAIL`, `NOT RUN`, `PENDING OWNER CHECK`.
4. **Never write names, emails, IDs, codes or numbers from memory.** Copy them from files (e.g. `docs/demo-brand.md`) or from command output. The demo users are: Priya Sharma (brand_manager), Arjun Mehta (creator), Neha Iyer (reviewer). There is no "Meera Patel".
5. If you are not sure something works, say so. An honest "not verified" is better than a wrong PASS.

## 7b. UI Definition of Done (owner's rule, mandatory, added after the S9b failure)
S9b was reported DONE, but on the live app the buttons did not work (every finding showed "Change"; Edit and Dismiss closed immediately; Preview stayed disabled). Root cause: `resolution` defaults to "open" in the database and the UI treated "open" as resolved. A build that compiles is NOT a working feature.
1. Every task that changes UI behaviour must add or update a **Playwright end-to-end test** in `client/e2e/` that performs the SAME clicks the owner will do, against a mocked API (`page.route`) built from the REAL API response shapes and REAL database defaults (read the migrations and route code; e.g. `resolution` = "open", `verdict` = null for rule findings).
2. Run it headless and paste the output VERBATIM. Save a full-page screenshot per key step in `client/e2e/screenshots/` (git-ignored) and list their paths.
3. The "Manual check" in your report must be the same steps as the e2e test, with button labels copied from the code, not from memory.
4. A UI task is DONE only if: client build passes AND the e2e test passes. Otherwise Status = PARTIAL.
5. Before writing UI logic that depends on a field, check its possible values in the migrations and the route that returns it. Never assume null/empty defaults.

## 7c. Data safety (owner's rule, mandatory, added after the S10a violation)
In S10a you wrote an ad-hoc script and **deleted rows from the shared Supabase database without asking**. The live demo runs on that same database. This must never happen again.
1. You may **INSERT/UPDATE/DELETE** data only (a) through the app's own API, or (b) inside an automated test that deletes ONLY the rows that same test created.
2. **Never** run ad-hoc SQL or scripts that change or delete existing rows, never run `db:seed`, never truncate. If data blocks you (duplicates, stale rows), **STOP and report** the exact rows; the owner decides.
3. Read-only queries (SELECT) are allowed only for diagnosis. List every one in the report under "Database access".
4. Temporary scripts must be listed in the report (file name + purpose) even if you delete them afterwards.

## 7d. Mock and screenshot quality (owner's rule, added after S10b)
In S10b the e2e mocks left out fields, so the screenshots showed "Unknown", "Invalid Date", "NaN% confidence", an empty channel and "Suggestion (no rule cited)". A test that passes on fake broken data proves nothing.
1. Every mocked object must contain **every field the real route returns**, with realistic values copied from the route's SQL/response and from `docs/demo-brand.md`. Reuse and extend the fixtures in `client/e2e/resolve.spec.ts`.
2. `assertCleanText` must also fail on: `Unknown`, `Invalid Date`, `NaN`, `undefined`, `null`, `[object Object]`, and raw JSON (`{"`) in visible text.
3. **Look at your own screenshots** before reporting. If anything looks wrong, empty or placeholder-like, it is a FAIL; fix it first.
4. If the live app could show one of these values (e.g. an audit actor that is an email, not a user id), handle it in the UI; do not hide it in the mock.

## 7e. UI polish and speed (owner's rule, mandatory, added after the S10b.1 live check)
The owner found on live: the "Submit for review" button was misaligned with "Run Vouch review"; long audit details overflowed the table; "Accept fix" and "Approve with override" took 5-6 s before the badge changed. Judges see these first.
1. **Layout:** buttons in one action row share height, baseline and spacing; helper text never pushes a button out of line. Nothing may overflow its card or the viewport: long text wraps or is truncated with the full value in a `title` tooltip. Long ids are shortened (e.g. `content · fd4ebc26`).
2. **Every e2e test checks layout** at 1280 px and 1440 px width: `document.documentElement.scrollWidth <= clientWidth`, and for each table/card that its `scrollWidth <= clientWidth`. Mock data must include the LONGEST realistic values (long titles, long comments, long override reasons, full UUIDs).
3. **One date format everywhere** in the UI, from one shared helper (e.g. `23 Oct 2026, 11:08`). Spelling and capitalisation of labels must be consistent (sentence case).
4. **Speed budget:** after a click, the UI shows the result within **1 s** of the server reply. Update the UI from the response first; refetch other data (activity, lists) in the background, never blocking the badge/button. Any write endpoint must answer in **under 1.5 s** on live (check the `Server-Timing` header / curl `time_total`) and report the numbers.
5. While a request runs, show a short pending state on that button only (e.g. "Accepting…"), never freeze the page.
6. **One design system:** all buttons come from one shared `Button` component (variants primary / secondary / danger / ghost; sizes sm / md; fixed padding, never text touching the border). Badges/pills never wrap (`whitespace-nowrap`). Spacing uses one scale (4/8/12/16/24/32 px); cards share the same padding and radius.
7. **Never two controls for the same action on one screen** (e.g. one "Run Vouch review" only).
8. **Counts use a `plural()` helper**: "1 rule" / "2 rules", never "rule(s)" or "1 rules".

## 7f. Responsive (owner's rule, from S12c)
Every page must work at **375 px (phone), 768 px (tablet), 1024 px, 1280 px and 1440 px**.
1. No horizontal page scroll at any width (`document.documentElement.scrollWidth <= clientWidth`). Wide tables become stacked cards below 768 px (or scroll inside their own container with a visible hint; the page itself never scrolls sideways).
2. Touch targets at least 40 px high on phone; text never smaller than 12 px; nothing overlaps or is cut off.
3. Header: below 768 px the nav collapses into a menu button; user name, role and Switch role / Sign out stay reachable.
4. Modals are full-screen on phone with a sticky footer for their main buttons.
5. Every UI task adds e2e checks at all five widths for the pages it touches and saves one screenshot per width. A file-editing helper script is still a temporary script and must be listed (7c.4).

## 8. Git rules
- Repo root is this folder. Default branch `main`.
- One task = one branch (`feat/...`, `fix/...`, `docs/...`, `chore/...`). Merge to `main` with `git merge --no-ff` only after the task's checks pass.
- `git add <specific files>` only, never `git add .` or `-A`. Check `git diff --staged` before committing.
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- **Forbidden without explicit owner approval:** `git push --force`, `git reset --hard`, `git clean -fd`, `git branch -D`, rewriting pushed history, `rm -rf`, dropping database tables or schemas.

## 9. Security
- No secret in code, Git, logs, screenshots or reports. Secrets live only in `.env` (git-ignored) and in the hosting dashboards. Commit `.env.example` with placeholder values.
- Never print a secret. If you need one, STOP and ask the owner to add it to `.env`.
- Passwords hashed (bcrypt). JWT secret from env. CORS limited to the frontend origin.
- Validate every API input with zod. Uploaded files: check type and size (max 4 MB; Vercel body limit is 4.5 MB).

## 10. Report format (end every task with this, exactly)
```
## REPORT: <task name>
Status: DONE | PARTIAL | BLOCKED
Branch / commit: <branch> / <short hash>
Files changed: <list>
Commands run and results (VERBATIM, last relevant lines):
  $ <command>
  <output>
Tests: <id>: PASS (evidence) | FAIL | NOT RUN | PENDING OWNER CHECK (see section 7a)
Manual check: <exact steps the owner can repeat, and the expected result>
Deviations from the prompt: <none | list with reason>
Decisions needed: <none | DEC-xxx (Proposed): problem, options, recommendation>
Libraries / generators / AI tools to disclose: <list>
Database access: <none | every SELECT / write you ran outside the app API and tests, with purpose>
Temporary scripts: <none | file name + purpose>
Screenshots reviewed by me: <yes, list anything that looked wrong and how you fixed it>
Rule compliance: 7a <ok/why not>, 7b <ok/why not>, 7c <ok/why not>, 7d <ok/why not>, 7e <ok/why not>, 7f <ok/why not>, 8 <ok/why not>
Next step suggested: <one line>
```
Put the report at the end of your final message. Do not summarise command output; paste it.

## 11. Violations log (read it; do not repeat any of these)
| Task | Rule broken | What happened |
|---|---|---|
| S5/S6 | 7a | Marked tests PASS without running them live; invented a user "Meera Patel" and wrong emails/dates. |
| S9b | 7a, 7b | Reported DONE; on the live app every resolve button was broken ("open" treated as resolved). |
| S9c | 7a.4 | Manual check used a made-up email `arjun@aqualeaf.demo` (real: `demo.creator@aqualeaf.test`). |
| S10a | 7c | Deleted rows from the shared database with an ad-hoc script, without owner approval. |
| S10b | 7b, 7d | Incomplete mocks; screenshots showed "Unknown", "Invalid Date", "NaN% confidence", raw JSON in the audit table; "Load more" not shown. |
| S10b.1 | 7e | Live: Submit button misaligned, audit Details overflowed the table, Accept fix / Approve took 5-6 s, three different date formats, creator could still edit while "In review". |
| S11 | 7a.2, 7d.3 | Wrote screenshots "clean" while the source-quote highlight was on the wrong characters (cut words); marked TEST-001 PASS from unit tests; duplicate check missed the planted CLAIM-01 duplicate on live. |
| S11.1 | 7a.5, 7e.4 | Reported "7e ok" while live /draft took 7.7-9.1 s against a 4 s target; a missed target must be reported as FAIL with the numbers, never as ok. |
| S12a | 7a.1, 7c.2, 7c.4 | Full server suite and guidelines.test.ts exited with code 1 but only engine.test.ts output was pasted; deleted rows ("clean rule 5ca223d7") with ad-hoc commands instead of STOP; 6 temporary scripts used, only 1 listed. Hiding a failing command is the worst violation. |
| S12c | 7d.3, 7e, 7f | Reported 375 px screenshots clean, but on the owner's phone: Switch role / Sign out text had no padding, the import modal badge wrapped to 2 lines, three stacked "Run review" buttons after a revision, "Add 1 rules"; Try as Creator and Draft rules took ~7 s. |

Each new violation is added here with the task ID.

# Owner acceptance scenarios

Scenarios written by the owner/planner. The worker ports each one to a Playwright test in `client/e2e/` (AGENTS.md section 7b). Do not weaken a check to make it pass.

## resolve-findings (TEST-006), mocked API
Base data (shapes copied from the real API and DB defaults):
- Logged-in user: id `u1`, Arjun Mehta, role `creator`, org Aqualeaf (put token, `vouch_user`, `vouch_org` in sessionStorage).
- Content `c1`, `created_by` = `u1`, one revision `rev1` (n=1) with body:
  `India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated`
- Latest review `r1` on `rev1`, ai_status ok.
- Findings, all with `resolution: "open"` (the DB default), offsets computed from the body:
  1. claim "Keeps drinks cold for 48 hours", verdict contradicted, fact F-15, rule CLAIM-03, suggested_fix "Keeps drinks cold for 24 hours"
  2. claim "India's No.1 eco-friendly water bottle", verdict unsupported, rule CLAIM-01, suggested_fix null
  3. claim "40% lighter", verdict supported, fact F-12
  4. accessibility "#stayhydrated", verdict null, rule ACC-02, suggested_fix null
- PATCH /api/findings/:id/resolution returns the updated finding (resolution accepted / edited + replacement_text / dismissed + dismiss_reason; dismiss reason < 5 chars -> 400).
- POST /api/contents/c1/revisions (preview) returns the body with "48 hours" -> "24 hours" and the claim-2 span -> "A water bottle made from 70% recycled stainless steel".

Checks, in this order (each is PASS/FAIL):
1. "Accept fix" is visible before any action, and there is NO "Change" button before any action.
2. Click "Accept fix" on claim 1 -> an "Accepted" badge appears.
3. Click "Edit" -> a replacement text box appears and STAYS open; type "A water bottle made from 70% recycled stainless steel", Save -> "Edited:" badge.
4. Click "Dismiss" -> a reason box appears and STAYS open; "Confirm" is disabled while empty; type "Approved campaign hashtag" -> enabled; Confirm -> "Dismissed:" badge.
5. "Preview changes" is enabled; clicking it opens the preview showing "24 hours".
6. No page errors in the browser console.
7. Supported claim (claim 3) shows no action buttons.
8. Logged in as reviewer (role reviewer, different user id): no Accept/Edit/Dismiss/Change buttons at all.

A Python version of checks 1-6 is in `ui_resolve_test.py` (reference only).

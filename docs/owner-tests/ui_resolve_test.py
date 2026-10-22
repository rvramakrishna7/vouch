"""Owner UI test for TEST-006 flow with a mocked API (no network needed).
Usage: python3 ui_resolve_test.py http://localhost:4173
"""
import json, sys, re
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
API = "http://api.test"
BODY = "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated"

def span(s):
    i = BODY.index(s); return i, i + len(s)

def f(id, kind, text, verdict, fix, sev="high", rule=None, fact=None):
    a, b = span(text)
    return dict(id=id, organization_id="o1", review_id="r1", kind=kind, span_text=text,
                start_offset=a, end_offset=b, verdict=verdict, fact_code=fact,
                fact_statement="F" if fact else None, fact_valid_until="2027-01-31" if fact else None,
                rule_code=rule, rule_text="rule text" if rule else None, reason="reason",
                severity=sev, confidence=0.9, suggested_fix=fix, replacement_text=None,
                resolution="open", dismiss_reason=None, created_at="2026-10-22T10:00:00Z")

findings = [
    f("f48", "claim", "Keeps drinks cold for 48 hours", "contradicted", "Keeps drinks cold for 24 hours", rule="CLAIM-03", fact="F-15"),
    f("fno1", "claim", "India's No.1 eco-friendly water bottle", "unsupported", None, rule="CLAIM-01"),
    f("fsup", "claim", "40% lighter", "supported", None, sev="low", fact="F-12"),
    f("fhash", "accessibility", "#stayhydrated", None, None, sev="low", rule="ACC-02"),
]
state = {f["id"]: f for f in findings}

content = dict(id="c1", title="TEST-006", channel="Instagram", audience="a", purpose="p", status="draft",
               created_by="u1", created_by_name="Arjun Mehta", created_at="2026-10-22T10:00:00Z",
               updated_at="2026-10-22T10:00:00Z",
               revisions=[dict(id="rev1", n=1, body=BODY, created_by="u1", created_by_name="Arjun Mehta", created_at="2026-10-22T10:00:00Z")])
review = dict(id="r1", organization_id="o1", revision_id="rev1", provider="rules", model="vouch-rules-v1",
              started_at="2026-10-22T10:00:00Z", finished_at="2026-10-22T10:00:01Z", created_at="2026-10-22T10:00:00Z",
              ai_status="ok", ai_provider="groq", ai_model="openai/gpt-oss-120b", ai_latency_ms=3000)
me = dict(user=dict(id="u1", name="Arjun Mehta", email="demo.creator@aqualeaf.test", role="creator"),
          organization=dict(id="o1", name="Aqualeaf"))

def handle(route, request):
    url, m = request.url, request.method
    def ok(data, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(data),
                      headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*",
                               "access-control-allow-methods": "*"})
    if m == "OPTIONS": return ok({})
    if url.endswith("/api/auth/me"): return ok(me)
    if url.endswith("/api/contents/c1"): return ok(content)
    if url.endswith("/api/contents/c1/reviews/latest"): return ok(dict(review=review, findings=list(state.values())))
    mm = re.search(r"/api/findings/(\w+)/resolution", url)
    if mm and m == "PATCH":
        body = json.loads(request.post_data); fid = mm.group(1); fd = dict(state[fid])
        if body["action"] == "accept":
            if not fd["suggested_fix"]: return ok({"error": "no_suggested_fix"}, 400)
            fd.update(resolution="accepted")
        elif body["action"] == "edit": fd.update(resolution="edited", replacement_text=body["text"])
        else:
            if len((body.get("reason") or "").strip()) < 5: return ok({"error": "invalid_input"}, 400)
            fd.update(resolution="dismissed", dismiss_reason=body["reason"])
        state[fid] = fd; return ok(dict(finding=fd, **fd))
    if url.endswith("/api/contents/c1/revisions") and m == "POST":
        new = BODY.replace("Keeps drinks cold for 48 hours", "Keeps drinks cold for 24 hours").replace(
            "India's No.1 eco-friendly water bottle", "A water bottle made from 70% recycled stainless steel")
        return ok(dict(body=new, applied=["f48", "fno1"], skipped=[]))
    return ok({"error": "not_mocked", "url": url}, 404)

results = []
def check(name, cond):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(f"{API}/**", handle)
    pg.goto(BASE + "/login")
    pg.evaluate("""(me) => { sessionStorage.setItem('vouch_token','t'); sessionStorage.setItem('vouch_user', JSON.stringify(me.user)); sessionStorage.setItem('vouch_org', JSON.stringify(me.organization)); }""", me)
    pg.goto(BASE + "/content/c1"); pg.wait_for_timeout(1500)

    check("1. 'Accept fix' button visible on the 48 hours claim (no 'Change' before any action)",
          pg.get_by_role("button", name="Accept fix").count() >= 1)
    check("1b. No 'Change' button before any action", pg.get_by_role("button", name="Change").count() == 0)
    pg.screenshot(path="ui_step1.png", full_page=True)

    # Accept 48h
    if pg.get_by_role("button", name="Accept fix").count():
        pg.get_by_role("button", name="Accept fix").first.click(); pg.wait_for_timeout(500)
    check("2. After accept: 'Accepted' badge shown", pg.get_by_text("Accepted").count() >= 1)

    # Edit No.1 claim: find its card by text, click Edit
    edit_btns = pg.get_by_role("button", name="Edit", exact=True)
    check("3. 'Edit' buttons visible", edit_btns.count() >= 1)
    if edit_btns.count():
        edit_btns.first.click(); pg.wait_for_timeout(300)
        inp = pg.get_by_placeholder("Enter replacement text...")
        check("3b. Edit opens a text box", inp.count() == 1)
        if inp.count():
            inp.fill("A water bottle made from 70% recycled stainless steel")
            pg.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(500)
    check("3c. 'Edited' badge shown", pg.get_by_text("Edited:").count() >= 1)

    dis = pg.get_by_role("button", name="Dismiss", exact=True)
    check("4. 'Dismiss' button visible", dis.count() >= 1)
    if dis.count():
        dis.first.click(); pg.wait_for_timeout(300)
        reason = pg.get_by_placeholder("E.g. Approved brand exception...")
        check("4b. Dismiss opens a reason box", reason.count() == 1)
        if reason.count():
            confirm = pg.get_by_role("button", name="Confirm", exact=True)
            check("4c. Confirm disabled while reason empty", confirm.is_disabled())
            reason.fill("Approved campaign hashtag"); check("4d. Confirm enabled after reason", confirm.is_enabled())
            confirm.click(); pg.wait_for_timeout(500)
    check("4e. 'Dismissed' badge shown", pg.get_by_text("Dismissed:").count() >= 1)

    prev = pg.get_by_role("button", name=re.compile("Preview changes"))
    check("5. 'Preview changes' enabled", prev.count() >= 1 and prev.first.is_enabled())
    if prev.count() and prev.first.is_enabled():
        prev.first.click(); pg.wait_for_timeout(800)
        check("5b. Preview modal shows the new text", pg.get_by_text("24 hours").count() >= 1)
    pg.screenshot(path="ui_step_end.png", full_page=True)
    check("6. No page errors", not errors)
    if errors: print("PAGE ERRORS:", errors[:3])
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nRESULT: {len(results)-len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)

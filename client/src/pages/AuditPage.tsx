import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { apiFetch, ApiError } from "../lib/api.js";
import { formatDate, formatEntityShort, plural } from "../lib/format.js";
import { Button } from "../components/Button.js";

interface AuditEvent {
  id: string;
  organization_id: string;
  actor: string;
  actor_name: string;
  action: string;
  entity: string;
  payload: Record<string, any>;
  at: string;
}

const ACTION_LABELS: Record<string, string> = {
  "content.submit": "Content submitted",
  "content.approve": "Content approved",
  "content.request_changes": "Changes requested",
  "review.run": "Review executed",
  "finding.resolve": "Finding resolved",
  "contents.create": "Content created",
  "content.create": "Content created",
  "revision.create": "Revision created",
  "rules.create": "Rule created",
  "rules.update": "Rule updated",
  "rules.import": "Rules imported",
  "facts.create": "Fact created",
  "terms.create": "Term created",
  "terms.update": "Term updated",
  "terms.delete": "Term deleted",
  "auth.login": "Signed in",
  "auth.demo_login": "Signed in (demo)",
  "seed:init": "Demo brand seeded",
};

export function AuditPage() {
  const { user } = useAuth();

  // Creator cannot access -> redirect to /content
  if (user?.role === "creator") {
    return <Navigate to="/content" replace />;
  }

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [hideSignIns, setHideSignIns] = useState(true);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch distinct org-scoped actions on mount
  useEffect(() => {
    let mounted = true;
    apiFetch<{ actions: string[] }>("/api/audit/actions")
      .then((res) => {
        if (mounted && Array.isArray(res.actions)) {
          setAvailableActions(res.actions);
        }
      })
      .catch(() => {
        // Fallback default actions
        setAvailableActions([
          "content.submit",
          "content.approve",
          "content.request_changes",
          "review.run",
          "finding.resolve",
          "contents.create",
          "revision.create",
          "rules.import",
          "rules.create",
          "rules.update",
          "auth.demo_login",
        ]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const fetchEvents = async (filter: string, excludeAuth: boolean) => {
    setLoading(true);
    setError(null);
    try {
      let query = "/api/audit?limit=25";
      if (excludeAuth) {
        query += "&exclude=auth";
      }
      if (filter) {
        query += `&action=${encodeURIComponent(filter)}`;
      }
      const data = await apiFetch<{
        events: AuditEvent[];
        next_cursor: string | null;
      }>(query);

      setEvents(data.events || []);
      setNextCursor(data.next_cursor);
    } catch (err) {
      console.error("Failed to fetch audit events:", err);
      if (err instanceof ApiError) {
        setError(`Failed to load audit events (${err.message})`);
      } else {
        setError("Unable to connect to server.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents(actionFilter, hideSignIns);
  }, [actionFilter, hideSignIns]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      let query = `/api/audit?limit=25&before=${encodeURIComponent(nextCursor)}`;
      if (hideSignIns) {
        query += "&exclude=auth";
      }
      if (actionFilter) {
        query += `&action=${encodeURIComponent(actionFilter)}`;
      }
      const data = await apiFetch<{
        events: AuditEvent[];
        next_cursor: string | null;
      }>(query);

      setEvents((prev) => [...prev, ...(data.events || [])]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      console.error("Failed to load more audit events:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const formatPayload = (action: string, payload: Record<string, any>) => {
    if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) return "—";

    switch (action) {
      case "rules.import": {
        const count = payload.count ?? (Array.isArray(payload.codes) ? payload.codes.length : 0);
        const codesStr = Array.isArray(payload.codes) && payload.codes.length > 0
          ? `: ${payload.codes.join(", ")}`
          : "";
        return `Imported ${plural(count, "rule")}${codesStr}`;
      }
      case "auth.demo_login":
        return payload.role ? `Role: ${payload.role}` : "Demo login";
      case "contents.create":
      case "content.create": {
        const parts: string[] = [];
        if (payload.title) parts.push(`Title: "${payload.title}"`);
        if (payload.channel) parts.push(`Channel: ${payload.channel}`);
        return parts.length ? parts.join(" · ") : "Created content";
      }
      case "revision.create": {
        const n = payload.n !== undefined ? `#${payload.n}` : "";
        const mode = payload.mode ? ` (mode: ${payload.mode})` : "";
        return `Revision ${n}${mode}`.trim();
      }
      case "review.run": {
        const parts: string[] = [];
        if (payload.findings_count !== undefined) parts.push(plural(payload.findings_count, "finding"));
        if (payload.ai_status) parts.push(`AI: ${payload.ai_status}`);
        return parts.length ? parts.join(" · ") : "Ran review";
      }
      case "content.submit":
        return payload.revision_id ? "Submitted revision" : "Submitted for review";
      case "content.request_changes":
        return payload.comment ? `Comment: "${payload.comment}"` : "Requested changes";
      case "content.approve":
        return payload.override_reason ? `Override: "${payload.override_reason}"` : "Approved without override";
      case "finding.resolve": {
        const parts: string[] = [];
        if (payload.action) parts.push(`Action: ${payload.action}`);
        if (payload.replacement_text) parts.push(`Text: "${payload.replacement_text}"`);
        if (payload.dismiss_reason) parts.push(`Reason: "${payload.dismiss_reason}"`);
        return parts.length ? parts.join(" · ") : "Resolved finding";
      }
      case "rules.create": {
        const parts: string[] = [];
        if (payload.code) parts.push(`Rule: ${payload.code}`);
        if (payload.category) parts.push(`Category: ${payload.category}`);
        return parts.length ? parts.join(" · ") : "Created rule";
      }
      case "rules.update": {
        const parts: string[] = [];
        if (payload.version) parts.push(`v${payload.version}`);
        if (payload.changes && typeof payload.changes === "object") {
          const keys = Object.keys(payload.changes).join(", ");
          parts.push(`Changed: ${keys}`);
        }
        return parts.length ? parts.join(" · ") : "Updated rule";
      }
      case "facts.create":
        return payload.code ? `Fact: ${payload.code}` : "Created fact";
      case "terms.create": {
        const parts: string[] = [];
        if (payload.term) parts.push(`Term: "${payload.term}"`);
        if (payload.type) parts.push(`Type: ${payload.type}`);
        return parts.length ? parts.join(" · ") : "Created term";
      }
      case "terms.update": {
        if (payload.changes && typeof payload.changes === "object") {
          const changed = Object.entries(payload.changes)
            .map(([k, v]) => `${k}: "${v}"`)
            .join(", ");
          return `Updated: ${changed}`;
        }
        return "Updated term";
      }
      case "terms.delete":
        return payload.term ? `Deleted: "${payload.term}"` : "Deleted term";
      case "seed:init":
        return payload.brand ? `Seed: ${payload.brand}` : "System seed";
      default: {
        // Short generic fallback ("key: value, ...") - never raw JSON
        const entries = Object.entries(payload)
          .filter(([_, v]) => v !== undefined && v !== null && typeof v !== "object")
          .map(([k, v]) => `${k}: ${v}`);
        return entries.length ? entries.slice(0, 3).join(", ") : "—";
      }
    }
  };

  const getReadableAction = (action: string) => {
    return ACTION_LABELS[action] || action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Audit log
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Append-only system record of all governance events and decisions.
          </p>
        </div>

        {/* Action filter dropdown & Hide sign-ins checkbox */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <label className="flex items-center gap-2 min-h-11 md:min-h-0 cursor-pointer select-none text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={hideSignIns}
              onChange={(e) => setHideSignIns(e.target.checked)}
              className="w-5 h-5 md:w-4 md:h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
            />
            <span>Hide sign-ins</span>
          </label>

          <div className="flex items-center gap-2 max-w-full">
            <label htmlFor="action-filter" className="text-xs font-medium text-slate-600">
              Filter action:
            </label>
            <select
              id="action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="text-xs min-h-11 md:min-h-0 border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All actions</option>
              {availableActions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="stack-table md:table-fixed w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-xs">
              <tr>
                <th className="w-32 lg:w-40 px-4 py-3">Time</th>
                <th className="w-28 lg:w-36 px-4 py-3">Actor</th>
                <th className="w-36 lg:w-48 px-4 py-3">Action</th>
                <th className="w-28 lg:w-44 px-4 py-3">Entity</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800 font-normal">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                    Loading audit events…
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                events.map((ev) => {
                  const { short: entityShort, full: entityFull } = formatEntityShort(ev.entity);
                  const payloadText = formatPayload(ev.action, ev.payload);
                  const actorDisplay = ev.actor_name && ev.actor_name !== "Unknown" ? ev.actor_name : (ev.actor || "—");
                  const readableAction = getReadableAction(ev.action);

                  return (
                    <tr key={ev.id} className="hover:bg-slate-50/60 transition">
                      <td data-label="Time" className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs font-mono">
                        {formatDate(ev.at)}
                      </td>
                      <td data-label="Actor" className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap truncate" title={actorDisplay}>
                        {actorDisplay}
                      </td>
                      <td data-label="Action" className="px-4 py-3">
                        <div className="flex flex-col gap-0.5 max-w-[130px] lg:max-w-[180px]">
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate" title={readableAction}>
                            {readableAction}
                          </span>
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate" title={ev.action}>
                            {ev.action}
                          </span>
                        </div>
                      </td>
                      <td data-label="Entity" className="px-4 py-3 font-mono text-xs text-slate-600 truncate" title={entityFull}>
                        <span>{entityShort}</span>
                      </td>
                      <td data-label="Details" className="px-4 py-3 text-slate-600" title={payloadText}>
                        <div className="line-clamp-2 break-words leading-relaxed">
                          {payloadText}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={loadingMore}
              loading={loadingMore}
              loadingText="Loading more…"
              onClick={handleLoadMore}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuditPage;

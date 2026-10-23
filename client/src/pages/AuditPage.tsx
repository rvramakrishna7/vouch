import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { apiFetch, ApiError } from "../lib/api.js";

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

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "content.submit", label: "content.submit" },
  { value: "content.approve", label: "content.approve" },
  { value: "content.request_changes", label: "content.request_changes" },
  { value: "review.run", label: "review.run" },
  { value: "finding.resolve", label: "finding.resolve" },
  { value: "contents.create", label: "contents.create" },
  { value: "revision.create", label: "revision.create" },
  { value: "auth.demo_login", label: "auth.demo_login" },
];

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
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async (filter: string) => {
    setLoading(true);
    setError(null);
    try {
      let query = "/api/audit?limit=25";
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
    fetchEvents(actionFilter);
  }, [actionFilter]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      let query = `/api/audit?limit=25&before=${encodeURIComponent(nextCursor)}`;
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

  const formatPayload = (payload: Record<string, any>) => {
    if (!payload || Object.keys(payload).length === 0) return "—";
    const parts: string[] = [];
    if (payload.title) parts.push(`Title: "${payload.title}"`);
    if (payload.decision) parts.push(`Decision: ${payload.decision}`);
    if (payload.override_reason) parts.push(`Override: "${payload.override_reason}"`);
    if (payload.comment) parts.push(`Comment: "${payload.comment}"`);
    if (payload.action) parts.push(`Action: ${payload.action}`);
    if (payload.replacement_text) parts.push(`Text: "${payload.replacement_text}"`);
    if (payload.dismiss_reason) parts.push(`Reason: "${payload.dismiss_reason}"`);
    if (payload.n !== undefined) parts.push(`Rev: #${payload.n}`);
    if (payload.findings_count !== undefined) parts.push(`${payload.findings_count} findings`);
    if (payload.ai_status) parts.push(`AI: ${payload.ai_status}`);
    if (payload.role) parts.push(`Role: ${payload.role}`);

    if (parts.length > 0) return parts.join(" · ");
    return JSON.stringify(payload);
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

        {/* Action filter dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="action-filter" className="text-xs font-medium text-slate-600">
            Filter action:
          </label>
          <select
            id="action-filter"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800 font-normal">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    Loading audit events…
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50/60 transition">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs font-mono">
                      {new Date(ev.at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                      {ev.actor_name || ev.actor}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-800 border border-slate-200">
                        {ev.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {ev.entity}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-md truncate" title={formatPayload(ev.payload)}>
                      {formatPayload(ev.payload)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={handleLoadMore}
              className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? "Loading more…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuditPage;

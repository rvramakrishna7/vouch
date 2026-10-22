import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useAuth } from "../auth/AuthContext.js";

interface ContentItem {
  id: string;
  title: string;
  channel: string;
  status: string;
  created_by_name: string;
  updated_at: string;
  latest_revision_number: number;
}

export function ReviewsPage() {
  const { user } = useAuth();
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContents = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ContentItem[]>("/api/contents");
      setContents(data);
    } catch (err) {
      console.error("Failed to load review queue:", err);
      if (err instanceof ApiError) {
        setError(`Failed to load review queue (${err.message})`);
      } else {
        setError("Unable to connect to server");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContents();
  }, []);

  const isBrandManager = user?.role === "brand_manager";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Review Queue
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isBrandManager
              ? "Read-only view of marketing content submissions across your organization."
              : "Review submitted marketing copy, evaluate claims, and approve or request changes."}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchContents}
            type="button"
            className="underline font-medium hover:text-red-800 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
          <div className="inline-block animate-spin w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full mb-3" />
          <p className="text-sm font-medium text-slate-500">Loading review queue…</p>
        </div>
      ) : contents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-4">
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            No content submitted for review yet.
          </h2>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
            When creators submit marketing copy or upload docx files, they will appear here in the review queue.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-semibold text-slate-500">
              <tr>
                <th className="px-6 py-3.5">Title</th>
                <th className="px-6 py-3.5">Channel</th>
                <th className="px-6 py-3.5">Creator</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5">Revision</th>
                <th className="px-6 py-3.5">Updated</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {contents.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/75 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      to={`/content/${item.id}`}
                      className="font-medium text-slate-900 hover:text-blue-600 transition-colors"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                      {item.channel}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-medium text-slate-700">
                    {item.created_by_name || "Unknown"}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    Rev {item.latest_revision_number}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {new Date(item.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      to={`/content/${item.id}`}
                      className="text-xs font-semibold text-slate-900 hover:text-blue-600 transition-colors"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

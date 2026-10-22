import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useAuth } from "../auth/AuthContext.js";

interface Revision {
  id: string;
  n: number;
  body: string;
  created_by?: string;
  created_by_name: string;
  created_at: string;
}

interface ContentDetail {
  id: string;
  title: string;
  channel: string;
  audience: string;
  purpose: string;
  status: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  revisions: Revision[];
}

export function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ContentDetail>(`/api/contents/${id}`);
      setContent(data);
    } catch (err) {
      console.error("Failed to load content details:", err);
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError("Content not found or you do not have permission to view it.");
        } else {
          setError(`Failed to load content (${err.message})`);
        }
      } else {
        setError("Unable to connect to server.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const backLink = user?.role === "creator" ? "/content" : "/reviews";
  const backLabel = user?.role === "creator" ? "Content" : "Reviews";

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm max-w-4xl mx-auto">
        <div className="inline-block animate-spin w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-slate-500">Loading content details…</p>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Link
          to={backLink}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
        >
          &larr; Back to {backLabel}
        </Link>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <h2 className="text-base font-semibold">Error Loading Content</h2>
          <p className="mt-1 text-sm">{error ?? "Unable to find requested content."}</p>
          <div className="mt-4">
            <button
              onClick={fetchDetail}
              className="text-sm font-semibold underline hover:text-red-900 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const latestRevision = content.revisions?.[0];
  const olderRevisions = (content.revisions ?? []).slice(1);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back button & Action banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link
            to={backLink}
            className="text-xs font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mb-2"
          >
            &larr; Back to {backLabel}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {content.title}
            </h1>
            <StatusBadge status={content.status} />
          </div>
        </div>

        {/* Disabled Review Button */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <button
            type="button"
            disabled
            className="px-4 py-2 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg cursor-not-allowed font-medium text-sm inline-flex items-center gap-2"
          >
            <svg
              className="w-4 h-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Run Vouch review
          </button>
          <span className="text-xs text-slate-500 italic">Coming in the next step.</span>
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Channel
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
            {content.channel}
          </span>
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Created By
          </span>
          <span className="text-sm font-medium text-slate-800">
            {content.created_by_name || "Unknown"}
          </span>
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Audience
          </span>
          <span className="text-sm text-slate-700">{content.audience}</span>
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Last Updated
          </span>
          <span className="text-sm text-slate-700">
            {new Date(content.updated_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        <div className="sm:col-span-2 md:col-span-4 pt-3 border-t border-slate-100">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Campaign Purpose
          </span>
          <p className="text-sm text-slate-700 italic bg-slate-50 p-3 rounded-lg border border-slate-100">
            "{content.purpose}"
          </p>
        </div>
      </div>

      {/* Latest Revision Body */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              Latest Revision
            </h2>
            {latestRevision && (
              <span className="font-mono text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Revision {latestRevision.n}
              </span>
            )}
          </div>
          {latestRevision && (
            <span className="text-xs text-slate-400">
              {latestRevision.body.length.toLocaleString()} characters &bull;{" "}
              {latestRevision.body.trim().split(/\s+/).filter(Boolean).length} words
            </span>
          )}
        </div>

        {latestRevision ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
            <div className="prose prose-slate max-w-none text-slate-800 text-base leading-relaxed whitespace-pre-wrap font-sans">
              {latestRevision.body}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>Submitted by {latestRevision.created_by_name}</span>
              <span>
                {new Date(latestRevision.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
            No revisions found for this content.
          </div>
        )}
      </div>

      {/* Older Revisions (Collapsed) */}
      {olderRevisions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <details className="group">
            <summary className="cursor-pointer font-semibold text-sm text-slate-700 hover:text-slate-900 select-none flex items-center justify-between">
              <span>Previous Revisions ({olderRevisions.length})</span>
              <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">
                &#9660;
              </span>
            </summary>

            <div className="mt-4 space-y-4 divide-y divide-slate-100 pt-2">
              {olderRevisions.map((rev) => (
                <div key={rev.id || rev.n} className="pt-4 first:pt-0 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">
                      Revision {rev.n}
                    </span>
                    <span>
                      {new Date(rev.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-700 font-mono whitespace-pre-wrap border border-slate-200">
                    {rev.body}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

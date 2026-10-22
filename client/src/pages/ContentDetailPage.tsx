import { useEffect, useState, useRef } from "react";
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

interface Review {
  id: string;
  organization_id: string;
  revision_id: string;
  provider: string;
  model: string;
  started_at: string;
  finished_at?: string;
  created_at: string;
}

interface Finding {
  id: string;
  organization_id: string;
  review_id: string;
  kind: "claim" | "tone" | "term" | "accessibility";
  span_text: string;
  start_offset: number;
  end_offset: number;
  verdict?: string | null;
  rule_id?: string | null;
  rule_code?: string | null;
  rule_text?: string | null;
  reason: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  suggested_fix?: string | null;
  resolution?: string;
  dismiss_reason?: string | null;
  created_at: string;
}

const KIND_LABELS: Record<string, { label: string; className: string }> = {
  claim: {
    label: "Claim",
    className: "bg-purple-100 text-purple-800 border-purple-200",
  },
  term: {
    label: "Terminology",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  tone: {
    label: "Tone",
    className: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  accessibility: {
    label: "Accessibility",
    className: "bg-teal-100 text-teal-800 border-teal-200",
  },
};

const SEVERITY_BADGES: Record<string, { label: string; className: string }> = {
  high: {
    label: "High",
    className: "bg-red-100 text-red-800 border-red-200",
  },
  medium: {
    label: "Medium",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  low: {
    label: "Low",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
};

export function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review states
  const [review, setReview] = useState<Review | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewRunning, setReviewRunning] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [highlightedFindingId, setHighlightedFindingId] = useState<string | null>(null);

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    setReviewLoading(true);
    setError(null);
    setReviewError(null);

    // Parallel execution of independent endpoints (Requirement 4)
    const contentPromise = apiFetch<ContentDetail>(`/api/contents/${id}`);
    const reviewPromise = apiFetch<{ review: Review; findings: Finding[] }>(
      `/api/contents/${id}/reviews/latest`,
    ).catch((err) => {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    });

    try {
      const [contentData, reviewData] = await Promise.all([
        contentPromise,
        reviewPromise,
      ]);
      setContent(contentData);
      if (reviewData) {
        setReview(reviewData.review);
        setFindings(reviewData.findings || []);
      } else {
        setReview(null);
        setFindings([]);
      }
    } catch (err) {
      console.error("Failed to load content:", err);
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
      setReviewLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [id]);

  const handleRunReview = async () => {
    if (!id || reviewRunning) return;
    setReviewRunning(true);
    setReviewError(null);
    try {
      const res = await apiFetch<{ review: Review; findings: Finding[] }>(
        `/api/contents/${id}/reviews`,
        {
          method: "POST",
        },
      );
      setReview(res.review);
      setFindings(res.findings);
    } catch (err) {
      console.error("Run review failed:", err);
      if (err instanceof ApiError) {
        setReviewError(`Review failed: ${err.message}`);
      } else {
        setReviewError("Failed to run review. Please try again.");
      }
    } finally {
      setReviewRunning(false);
    }
  };

  const handleHighlightClick = (findingId: string) => {
    setHighlightedFindingId(findingId);
    const cardEl = document.getElementById(`finding-card-${findingId}`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedFindingId(null);
    }, 2500);
  };

  const backLink = user?.role === "creator" ? "/content" : "/reviews";
  const backLabel = user?.role === "creator" ? "Content" : "Reviews";

  // Error state
  if (error) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Link
          to={backLink}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
        >
          &larr; Back to {backLabel}
        </Link>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <h2 className="text-base font-semibold">Error Loading Content</h2>
          <p className="mt-1 text-sm">{error}</p>
          <div className="mt-4">
            <button
              onClick={fetchAll}
              className="text-sm font-semibold underline hover:text-red-900 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const latestRevision = content?.revisions?.[0];
  const olderRevisions = (content?.revisions ?? []).slice(1);

  // Severity counts
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;

  // Sort findings for cards: severity first (high, medium, low) then start position
  const severityRank: Record<string, number> = { high: 1, medium: 2, low: 3 };
  const sortedCards = [...findings].sort((a, b) => {
    const rankDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return a.start_offset - b.start_offset;
  });

  // Build highlighted text segments (handling overlaps by skipping overlapping highlight)
  const renderHighlightedBody = () => {
    if (!latestRevision) return null;
    const bodyText = latestRevision.body;

    if (findings.length === 0) {
      return (
        <div className="text-slate-800 text-base leading-relaxed whitespace-pre-wrap font-sans">
          {bodyText}
        </div>
      );
    }

    const validSpans = [...findings]
      .filter(
        (f) =>
          f.start_offset >= 0 &&
          f.end_offset <= bodyText.length &&
          f.start_offset < f.end_offset,
      )
      .sort((a, b) => a.start_offset - b.start_offset || a.end_offset - b.end_offset);

    const nonOverlapping: Array<{
      finding: Finding;
      start: number;
      end: number;
    }> = [];
    let lastEnd = -1;

    for (const f of validSpans) {
      if (f.start_offset >= lastEnd) {
        nonOverlapping.push({
          finding: f,
          start: f.start_offset,
          end: f.end_offset,
        });
        lastEnd = f.end_offset;
      }
    }

    const segments: Array<{ text: string; finding?: Finding }> = [];
    let cursor = 0;

    for (const span of nonOverlapping) {
      if (span.start > cursor) {
        segments.push({ text: bodyText.slice(cursor, span.start) });
      }
      segments.push({
        text: bodyText.slice(span.start, span.end),
        finding: span.finding,
      });
      cursor = span.end;
    }

    if (cursor < bodyText.length) {
      segments.push({ text: bodyText.slice(cursor) });
    }

    return (
      <div className="text-slate-800 text-base leading-relaxed whitespace-pre-wrap font-sans">
        {segments.map((seg, idx) => {
          if (!seg.finding) {
            return <span key={idx}>{seg.text}</span>;
          }

          const f = seg.finding;
          const isSelected = highlightedFindingId === f.id;

          let highlightStyle =
            "bg-slate-100 text-slate-900 underline decoration-slate-400 decoration-2 underline-offset-4";
          if (f.severity === "high") {
            highlightStyle =
              "bg-red-100 text-red-950 underline decoration-red-500 decoration-2 underline-offset-4";
          } else if (f.severity === "medium") {
            highlightStyle =
              "bg-amber-100 text-amber-950 underline decoration-amber-500 decoration-2 underline-offset-4";
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleHighlightClick(f.id)}
              title={`Click to view finding: ${f.reason}`}
              className={`inline font-sans cursor-pointer rounded px-0.5 transition-all text-left ${highlightStyle} ${
                isSelected ? "ring-2 ring-slate-900 ring-offset-1 font-semibold" : ""
              }`}
            >
              {seg.text}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Breadcrumb & Action banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link
            to={backLink}
            className="text-xs font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mb-2"
          >
            &larr; Back to {backLabel}
          </Link>
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="h-8 w-64 bg-slate-200 rounded-md animate-pulse" />
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  {content?.title}
                </h1>
                {content && <StatusBadge status={content.status} />}
              </>
            )}
          </div>
        </div>

        {/* Run Vouch review button */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <button
            type="button"
            disabled={loading || reviewRunning || !latestRevision}
            onClick={handleRunReview}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium text-sm inline-flex items-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reviewRunning ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Reviewing…</span>
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4 text-slate-300"
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
                <span>Run Vouch review</span>
              </>
            )}
          </button>
        </div>
      </div>

      {reviewError && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
          <span>{reviewError}</span>
          <button
            type="button"
            onClick={handleRunReview}
            className="underline font-semibold hover:text-red-900 cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {/* Metadata Grid (Render skeleton immediately while loading, Requirement 4) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 text-sm">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Channel
          </span>
          {loading ? (
            <div className="h-5 w-20 bg-slate-200 rounded animate-pulse" />
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
              {content?.channel}
            </span>
          )}
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Created By
          </span>
          {loading ? (
            <div className="h-5 w-28 bg-slate-200 rounded animate-pulse" />
          ) : (
            <span className="text-sm font-medium text-slate-800">
              {content?.created_by_name || "Unknown"}
            </span>
          )}
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Target Audience
          </span>
          {loading ? (
            <div className="h-5 w-36 bg-slate-200 rounded animate-pulse" />
          ) : (
            <span className="text-sm text-slate-700">{content?.audience}</span>
          )}
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Last Updated
          </span>
          {loading ? (
            <div className="h-5 w-24 bg-slate-200 rounded animate-pulse" />
          ) : (
            <span className="text-sm text-slate-700">
              {content &&
                new Date(content.updated_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
            </span>
          )}
        </div>

        <div className="sm:col-span-2 md:col-span-4 pt-3 border-t border-slate-100">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Campaign Purpose
          </span>
          {loading ? (
            <div className="h-10 w-full bg-slate-100 rounded-lg animate-pulse" />
          ) : (
            <p className="text-sm text-slate-700 italic bg-slate-50 p-3 rounded-lg border border-slate-100">
              "{content?.purpose}"
            </p>
          )}
        </div>
      </div>

      {/* Summary Bar above content and findings */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
        {loading || reviewLoading ? (
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
            <div className="h-5 w-36 bg-slate-100 rounded animate-pulse hidden sm:block" />
          </div>
        ) : review ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
            <div className="flex items-center flex-wrap gap-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mr-1">
                Findings:
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
                {highCount} High
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                {mediumCount} Medium
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                {lowCount} Low
              </span>
              <span className="text-xs text-slate-400">
                ({findings.length} total)
              </span>
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Checked by:{" "}
              <span className="text-slate-800 font-semibold">
                {review.provider}
              </span>{" "}
              &bull;{" "}
              <span className="text-slate-800 font-mono">
                {review.model}
              </span>{" "}
              &bull;{" "}
              <span>
                {new Date(review.finished_at || review.created_at).toLocaleTimeString(
                  undefined,
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  },
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span className="font-medium text-slate-700">Not reviewed yet.</span>
              <span className="text-xs text-slate-400 hidden sm:inline">
                Run review to inspect brand claims, terminology, and tone against your Brand Kit.
              </span>
            </div>
            <button
              type="button"
              onClick={handleRunReview}
              className="text-xs font-semibold text-slate-900 underline hover:text-blue-600 cursor-pointer"
            >
              Run review now &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Main Review Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (7 cols): Latest Revision Body */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Draft Body
              </h2>
              {latestRevision && (
                <span className="font-mono text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  Revision {latestRevision.n}
                </span>
              )}
            </div>

            {latestRevision && (
              <span className="text-xs text-slate-400">
                {latestRevision.body.length.toLocaleString()} characters
              </span>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
            {loading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-full" />
                <div className="h-4 bg-slate-200 rounded w-11/12" />
                <div className="h-4 bg-slate-200 rounded w-4/5" />
                <div className="h-4 bg-slate-200 rounded w-3/4" />
              </div>
            ) : (
              renderHighlightedBody()
            )}

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>
                Author: {latestRevision?.created_by_name || "Unknown"}
              </span>
              {findings.length > 0 && (
                <span className="italic text-slate-500">
                  Tip: Click any highlighted text to jump to its rule card.
                </span>
              )}
            </div>
          </div>

          {/* Older Revisions Section */}
          {olderRevisions.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
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

        {/* Right Column (5 cols): Finding Cards List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Claim Ledger & Findings
            </h2>
            <span className="text-xs text-slate-400">
              {findings.length} {findings.length === 1 ? "finding" : "findings"}
            </span>
          </div>

          {loading || reviewLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 animate-pulse"
                >
                  <div className="flex justify-between items-center">
                    <div className="h-5 w-20 bg-slate-200 rounded" />
                    <div className="h-4 w-16 bg-slate-100 rounded" />
                  </div>
                  <div className="h-7 w-3/4 bg-slate-100 rounded" />
                  <div className="h-4 w-full bg-slate-100 rounded" />
                </div>
              ))}
            </div>
          ) : findings.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
                <svg
                  className="w-5 h-5"
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
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                {review ? "No issues detected" : "No review findings yet"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {review
                  ? "All evaluated claims and brand guidelines passed inspection."
                  : "Click 'Run Vouch review' above to analyze this piece of content."}
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[85vh] overflow-y-auto pr-1">
              {sortedCards.map((finding) => {
                const kindMeta = KIND_LABELS[finding.kind] ?? {
                  label: finding.kind,
                  className: "bg-slate-100 text-slate-800 border-slate-200",
                };

                const sevMeta = SEVERITY_BADGES[finding.severity] ?? {
                  label: finding.severity,
                  className: "bg-slate-100 text-slate-700 border-slate-200",
                };

                const isHighlighted = highlightedFindingId === finding.id;

                return (
                  <div
                    key={finding.id}
                    id={`finding-card-${finding.id}`}
                    className={`bg-white border rounded-xl p-5 shadow-sm transition-all duration-300 space-y-3.5 ${
                      isHighlighted
                        ? "border-slate-900 ring-2 ring-slate-900 ring-offset-2"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* Card Top: Badges & Severity */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded border ${kindMeta.className}`}
                        >
                          {kindMeta.label}
                        </span>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded border ${sevMeta.className}`}
                        >
                          {sevMeta.label}
                        </span>
                      </div>

                      <span className="text-xs font-medium text-slate-400">
                        {Math.round(finding.confidence * 100)}% confidence
                      </span>
                    </div>

                    {/* Quoted span */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                      <span className="text-xs text-slate-400 block mb-1 uppercase font-semibold tracking-wider">
                        Flagged Text
                      </span>
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        "{finding.span_text}"
                      </span>
                    </div>

                    {/* Citation Line */}
                    <div>
                      {finding.rule_code ? (
                        <div className="text-xs text-slate-700 bg-slate-100/70 border border-slate-200 rounded-lg p-2.5 space-y-0.5">
                          <span className="font-bold text-slate-900 font-mono block">
                            Rule {finding.rule_code}:
                          </span>
                          <span className="text-slate-600 block leading-snug">
                            {finding.rule_text || "Brand guideline rule"}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs font-medium text-slate-500 italic bg-slate-50 border border-slate-200 rounded-lg p-2">
                          Suggestion (no rule cited)
                        </div>
                      )}
                    </div>

                    {/* Reason */}
                    <p className="text-sm text-slate-700 leading-snug">
                      {finding.reason}
                    </p>

                    {/* Suggested Fix */}
                    {finding.suggested_fix && (
                      <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-2.5 flex items-start gap-2">
                        <span className="font-semibold text-emerald-800 shrink-0">
                          Suggested fix:
                        </span>
                        <code className="bg-emerald-100 px-1.5 py-0.5 rounded font-mono text-emerald-950 font-bold break-all">
                          {finding.suggested_fix}
                        </code>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

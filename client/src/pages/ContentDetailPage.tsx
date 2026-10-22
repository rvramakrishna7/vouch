import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { diffWords } from "diff";
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
  ai_status?: "ok" | "unavailable" | "invalid_output" | "skipped" | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_latency_ms?: number | null;
}

interface Finding {
  id: string;
  organization_id: string;
  review_id: string;
  kind: "claim" | "tone" | "term" | "accessibility";
  span_text: string;
  start_offset: number;
  end_offset: number;
  verdict?: "supported" | "contradicted" | "unsupported" | "outdated" | "needs_human_judgement" | string | null;
  fact_id?: string | null;
  fact_code?: string | null;
  fact_statement?: string | null;
  fact_valid_until?: string | null;
  rule_id?: string | null;
  rule_code?: string | null;
  rule_text?: string | null;
  reason: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  suggested_fix?: string | null;
  replacement_text?: string | null;
  resolution?: string | null;
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

const VERDICT_META: Record<
  string,
  { label: string; chipClass: string; highlightClass: string }
> = {
  supported: {
    label: "Supported",
    chipClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
    highlightClass:
      "bg-emerald-100 text-emerald-950 underline decoration-emerald-500 decoration-2 underline-offset-4",
  },
  outdated: {
    label: "Outdated",
    chipClass: "bg-amber-100 text-amber-800 border-amber-300",
    highlightClass:
      "bg-amber-100 text-amber-950 underline decoration-amber-500 decoration-2 underline-offset-4",
  },
  contradicted: {
    label: "Contradicted",
    chipClass: "bg-rose-100 text-rose-800 border-rose-300",
    highlightClass:
      "bg-rose-100 text-rose-950 underline decoration-rose-600 decoration-2 underline-offset-4",
  },
  unsupported: {
    label: "Unsupported",
    chipClass: "bg-red-100 text-red-800 border-red-300",
    highlightClass:
      "bg-red-100 text-red-950 underline decoration-red-600 decoration-2 underline-offset-4",
  },
  needs_human_judgement: {
    label: "Needs human judgement",
    chipClass: "bg-purple-100 text-purple-800 border-purple-300",
    highlightClass:
      "bg-purple-100 text-purple-950 underline decoration-purple-500 decoration-2 underline-offset-4",
  },
};

/**
 * Word-level diff renderer using the diff package
 * Removed text: red strikethrough
 * Added text: green
 */
function WordDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = diffWords(oldText, newText);
  return (
    <div className="font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap bg-slate-50 p-3.5 rounded-lg border border-slate-200">
      {parts.map((part, index) => {
        if (part.added) {
          return (
            <ins
              key={index}
              className="bg-emerald-100 text-emerald-950 no-underline font-semibold px-0.5 rounded border border-emerald-300"
            >
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del
              key={index}
              className="bg-rose-100 text-rose-950 line-through px-0.5 rounded border border-rose-300"
            >
              {part.value}
            </del>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </div>
  );
}

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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [highlightedFindingId, setHighlightedFindingId] = useState<string | null>(null);

  // Resolution states
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [editInputText, setEditInputText] = useState("");
  const [activeDismissId, setActiveDismissId] = useState<string | null>(null);
  const [dismissInputReason, setDismissInputReason] = useState("");
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const [resolvingFindingId, setResolvingFindingId] = useState<string | null>(null);

  // Stale review alert (409)
  const [staleReviewAlert, setStaleReviewAlert] = useState(false);

  // Action error message
  const [actionError, setActionError] = useState<string | null>(null);

  // Preview modal states
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    body: string;
    applied: any[];
    skipped: any[];
  } | null>(null);
  const [applyingFixes, setApplyingFixes] = useState(false);

  // Manual edit modal states
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualBody, setManualBody] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // Banner after revision creation
  const [createdRevisionBanner, setCreatedRevisionBanner] = useState<{ n: number } | null>(null);

  // Interactive revision history selected revision
  const [selectedHistoryRevN, setSelectedHistoryRevN] = useState<number | null>(null);

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timer for review running progress
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (reviewRunning) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [reviewRunning]);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    setReviewLoading(true);
    setError(null);
    setReviewError(null);

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
    setStaleReviewAlert(false);
    setCreatedRevisionBanner(null);
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

  // Resolution Actions
  const handleResolve = async (
    findingId: string,
    action: "accept" | "edit" | "dismiss",
    text?: string,
    reason?: string,
  ) => {
    setResolvingFindingId(findingId);
    setActionError(null);
    try {
      const res = await apiFetch<{
        finding?: Finding;
        id?: string;
        resolution: string;
        replacement_text?: string | null;
        dismiss_reason?: string | null;
      }>(`/api/findings/${findingId}/resolution`, {
        method: "PATCH",
        body: JSON.stringify({ action, text, reason }),
      });

      const updatedResolution =
        res.resolution ||
        (action === "accept"
          ? "accepted"
          : action === "edit"
          ? "edited"
          : "dismissed");
      const updatedReplacement =
        res.replacement_text ?? (action === "edit" ? text : null);
      const updatedDismiss =
        res.dismiss_reason ?? (action === "dismiss" ? reason : null);

      setFindings((prev) =>
        prev.map((f) =>
          f.id === findingId
            ? {
                ...f,
                resolution: updatedResolution,
                replacement_text: updatedReplacement,
                dismiss_reason: updatedDismiss,
              }
            : f,
        ),
      );

      setActiveEditId(null);
      setActiveDismissId(null);
      setActiveChangeId(null);
    } catch (err) {
      console.error("Resolution failed:", err);
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.message === "stale_review")
      ) {
        setStaleReviewAlert(true);
        setActionError("This review is for an older revision. Run a new review first.");
      } else if (err instanceof ApiError) {
        setActionError(`Failed to save resolution: ${err.message}`);
      } else {
        setActionError("Failed to update finding resolution.");
      }
    } finally {
      setResolvingFindingId(null);
    }
  };

  const startEdit = (finding: Finding) => {
    setActiveEditId(finding.id);
    setActiveDismissId(null);
    setActiveChangeId(null);
    setEditInputText(
      finding.replacement_text ||
        finding.suggested_fix ||
        finding.span_text ||
        "",
    );
  };

  const startDismiss = (finding: Finding) => {
    setActiveDismissId(finding.id);
    setActiveEditId(null);
    setActiveChangeId(null);
    setDismissInputReason(finding.dismiss_reason || "");
  };

  const startChange = (findingId: string) => {
    setActiveChangeId(findingId);
    setActiveEditId(null);
    setActiveDismissId(null);
  };

  // Preview fixes modal
  const handlePreviewChanges = async () => {
    if (!id || !latestRevision) return;
    setPreviewLoading(true);
    setActionError(null);
    try {
      const res = await apiFetch<{
        body: string;
        applied: any[];
        skipped: any[];
      }>(`/api/contents/${id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ mode: "preview" }),
      });
      setPreviewData(res);
      setPreviewModalOpen(true);
    } catch (err) {
      console.error("Preview failed:", err);
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.message === "stale_review")
      ) {
        setStaleReviewAlert(true);
        setActionError("This review is for an older revision. Run a new review first.");
      } else if (err instanceof ApiError) {
        setActionError(`Failed to preview changes: ${err.message}`);
      } else {
        setActionError("Failed to generate preview.");
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyFixes = async () => {
    if (!id) return;
    setApplyingFixes(true);
    setActionError(null);
    try {
      const res = await apiFetch<{
        revision: Revision;
        applied: any[];
        skipped: any[];
      }>(`/api/contents/${id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ mode: "apply_fixes" }),
      });
      setPreviewModalOpen(false);
      setPreviewData(null);
      setCreatedRevisionBanner({ n: res.revision.n });
      await fetchAll();
    } catch (err) {
      console.error("Apply fixes failed:", err);
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.message === "stale_review")
      ) {
        setStaleReviewAlert(true);
        setPreviewModalOpen(false);
        setActionError("This review is for an older revision. Run a new review first.");
      } else if (err instanceof ApiError) {
        setActionError(`Failed to apply fixes: ${err.message}`);
      } else {
        setActionError("Failed to create revision from fixes.");
      }
    } finally {
      setApplyingFixes(false);
    }
  };

  // Manual edit
  const handleOpenManualEdit = () => {
    if (!latestRevision) return;
    setManualBody(latestRevision.body);
    setManualModalOpen(true);
  };

  const handleSaveManual = async () => {
    if (!id || !manualBody.trim()) return;
    setSavingManual(true);
    setActionError(null);
    try {
      const res = await apiFetch<{
        revision: Revision;
      }>(`/api/contents/${id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ mode: "manual", body: manualBody }),
      });
      setManualModalOpen(false);
      setCreatedRevisionBanner({ n: res.revision.n });
      await fetchAll();
    } catch (err) {
      console.error("Manual revision save failed:", err);
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.message === "stale_review")
      ) {
        setStaleReviewAlert(true);
        setManualModalOpen(false);
        setActionError("This review is for an older revision. Run a new review first.");
      } else if (err instanceof ApiError) {
        setActionError(`Failed to save revision: ${err.message}`);
      } else {
        setActionError("Failed to create manual revision.");
      }
    } finally {
      setSavingManual(false);
    }
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
  const nextRevisionN = (latestRevision?.n ?? 0) + 1;

  // Group findings into claims vs rule-based findings
  const claimFindings = findings.filter((f) => f.kind === "claim");
  const ruleFindings = findings.filter((f) => f.kind !== "claim");

  // Claim verdict counts
  const supportedCount = claimFindings.filter((f) => f.verdict === "supported").length;
  const outdatedCount = claimFindings.filter((f) => f.verdict === "outdated").length;
  const contradictedCount = claimFindings.filter((f) => f.verdict === "contradicted").length;
  const unsupportedCount = claimFindings.filter((f) => f.verdict === "unsupported").length;
  const needsHumanCount = claimFindings.filter((f) => f.verdict === "needs_human_judgement").length;

  // Permissions check
  const isCreatorOwner = Boolean(
    user?.role === "creator" && content && user?.id === content.created_by,
  );
  const isLatestReview = Boolean(
    review && latestRevision && review.revision_id === latestRevision.id,
  );
  const canResolve = Boolean(isCreatorOwner && isLatestReview && !staleReviewAlert);

  // Ready fixes count (accepted + edited)
  const readyFindings = findings.filter(
    (f) =>
      f.resolution === "accepted" ||
      f.resolution === "accept" ||
      f.resolution === "edited" ||
      f.resolution === "edit",
  );
  const readyCount = readyFindings.length;

  // Build highlighted text segments
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

          if (f.kind === "claim") {
            const v = f.verdict || "unsupported";
            highlightStyle =
              VERDICT_META[v]?.highlightClass ||
              "bg-purple-100 text-purple-950 underline decoration-purple-500 decoration-2 underline-offset-4";
          } else {
            if (f.severity === "high") {
              highlightStyle =
                "bg-red-100 text-red-950 underline decoration-red-500 decoration-2 underline-offset-4";
            } else if (f.severity === "medium") {
              highlightStyle =
                "bg-amber-100 text-amber-950 underline decoration-amber-500 decoration-2 underline-offset-4";
            }
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

  /**
   * Render resolution controls and badges for findings
   * Supported claims cannot be resolved.
   * Creator owner sees action buttons; reviewers/brand managers see read-only badges.
   */
  const renderFindingResolution = (finding: Finding) => {
    // Supported claims cannot be resolved
    if (finding.verdict === "supported") {
      return null;
    }

    const hasResolution = Boolean(
      finding.resolution && finding.resolution !== "open",
    );
    const isEditing = activeEditId === finding.id;
    const isDismissing = activeDismissId === finding.id;
    const isChanging = activeChangeId === finding.id;
    const isResolving = resolvingFindingId === finding.id;

    // Show badge if resolved and not actively changing, editing, or dismissing
    if (hasResolution && !isChanging && !isEditing && !isDismissing) {
      let badge = null;
      if (finding.resolution === "accepted" || finding.resolution === "accept") {
        badge = (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            &check; Accepted
          </span>
        );
      } else if (finding.resolution === "edited" || finding.resolution === "edit") {
        badge = (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300 max-w-full truncate">
            &#9998; Edited: "{finding.replacement_text || finding.suggested_fix}"
          </span>
        );
      } else if (
        finding.resolution === "dismissed" ||
        finding.resolution === "dismiss"
      ) {
        badge = (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300 max-w-full truncate">
            &times; Dismissed: "{finding.dismiss_reason}"
          </span>
        );
      }

      return (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">{badge}</div>
          {canResolve && (
            <button
              type="button"
              onClick={() => startChange(finding.id)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-900 underline cursor-pointer shrink-0"
            >
              Change
            </button>
          )}
        </div>
      );
    }

    // If cannot resolve (other roles or stale review), do not show action buttons
    if (!canResolve) {
      return null;
    }

    // Inline edit mode
    if (activeEditId === finding.id) {
      return (
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Replacement Text
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editInputText}
              onChange={(e) => setEditInputText(e.target.value)}
              placeholder="Enter replacement text..."
              className="flex-1 text-xs font-mono px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              autoFocus
            />
            <button
              type="button"
              disabled={isResolving || !editInputText.trim()}
              onClick={() => handleResolve(finding.id, "edit", editInputText)}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isResolving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveEditId(null);
                if (isChanging) setActiveChangeId(null);
              }}
              className="px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer shrink-0"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // Inline dismiss mode
    if (activeDismissId === finding.id) {
      const isValid = dismissInputReason.trim().length >= 5;
      return (
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Reason for Dismissing (min 5 characters)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={dismissInputReason}
              onChange={(e) => setDismissInputReason(e.target.value)}
              placeholder="E.g. Approved brand exception..."
              className="flex-1 text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              autoFocus
            />
            <button
              type="button"
              disabled={isResolving || !isValid}
              onClick={() =>
                handleResolve(finding.id, "dismiss", undefined, dismissInputReason)
              }
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isResolving ? "Saving..." : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDismissId(null);
                if (isChanging) setActiveChangeId(null);
              }}
              className="px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer shrink-0"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // Action buttons row (Accept fix / Edit / Dismiss)
    return (
      <div className="pt-2 border-t border-slate-100 flex items-center flex-wrap gap-2">
        {finding.suggested_fix && (
          <button
            type="button"
            disabled={isResolving}
            onClick={() => handleResolve(finding.id, "accept")}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md shadow-sm transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
          >
            {isResolving ? "Accepting..." : "Accept fix"}
          </button>
        )}
        <button
          type="button"
          disabled={isResolving}
          onClick={() => startEdit(finding)}
          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-semibold rounded-md transition cursor-pointer disabled:opacity-50"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={isResolving}
          onClick={() => startDismiss(finding)}
          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-semibold rounded-md transition cursor-pointer disabled:opacity-50"
        >
          Dismiss
        </button>
        {isChanging && (
          <button
            type="button"
            onClick={() => setActiveChangeId(null)}
            className="text-xs text-slate-400 hover:text-slate-600 underline ml-auto cursor-pointer"
          >
            Keep current
          </button>
        )}
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

      {/* Progress Line while Review Runs */}
      {reviewRunning && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm text-sm text-blue-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="font-semibold">Review running ({elapsedSeconds}s):</span>
            <span className="text-xs text-blue-800 font-medium">
              Checking rules &rarr; Finding relevant facts &rarr; Verifying claims
            </span>
          </div>
          <span className="text-xs text-blue-600 font-mono">Keep page open</span>
        </div>
      )}

      {/* Revision Created Banner (Requirement 5) */}
      {createdRevisionBanner && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-sm text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
              &check;
            </span>
            <span className="font-semibold">
              Revision {createdRevisionBanner.n} created. Run Vouch review again to check the new text.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreatedRevisionBanner(null);
              handleRunReview();
            }}
            disabled={reviewRunning}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer shrink-0"
          >
            Run review &rarr;
          </button>
        </div>
      )}

      {/* Stale Review 409 Banner (Requirement 8) */}
      {staleReviewAlert && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-5 h-5 text-amber-600 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="font-semibold">
              This review is for an older revision. Run a new review first.
            </span>
          </div>
          <button
            type="button"
            onClick={handleRunReview}
            disabled={reviewRunning}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer shrink-0"
          >
            Run new review &rarr;
          </button>
        </div>
      )}

      {/* Action / Review Errors */}
      {actionError && !staleReviewAlert && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center justify-between shadow-sm">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {reviewError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
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

      {/* Amber Banner when AI check is unavailable */}
      {review && review.ai_status && review.ai_status !== "ok" && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <span className="font-semibold block">AI check unavailable right now</span>
            <span className="text-xs text-amber-800">
              Rule-based findings are shown below; try again in a minute for full claim verification.
            </span>
          </div>
        </div>
      )}

      {/* Metadata Grid */}
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
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm space-y-2">
        {loading || reviewLoading ? (
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 w-64 bg-slate-200 rounded animate-pulse" />
            <div className="h-5 w-48 bg-slate-100 rounded animate-pulse hidden sm:block" />
          </div>
        ) : review ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mr-1">
                Claims:
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {supportedCount} supported
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                {outdatedCount} outdated
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                {contradictedCount} contradicted
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
                {unsupportedCount} unsupported
              </span>
              {needsHumanCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                  {needsHumanCount} needs judgement
                </span>
              )}
              <span className="text-slate-300 mx-1">|</span>
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                Rule findings: {ruleFindings.length}
              </span>
            </div>

            {/* AI and Engine Disclosure Line */}
            <div className="text-xs text-slate-500 font-medium">
              Checked by:{" "}
              <span className="text-slate-800 font-semibold">
                rule engine vouch-rules-v1
              </span>
              {review.ai_provider && review.ai_model && (
                <>
                  {" "}+ AI{" "}
                  <span className="text-slate-800 font-semibold">
                    {review.ai_provider}
                  </span>{" "}
                  &bull;{" "}
                  <span className="text-slate-800 font-mono">
                    {review.ai_model}
                  </span>{" "}
                  &bull;{" "}
                  <span>
                    {(Number(review.ai_latency_ms || 0) / 1000).toFixed(1)} s
                  </span>
                </>
              )}
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
        {/* Left Column (6 cols): Latest Revision Body + Revision History */}
        <div className="lg:col-span-6 space-y-6">
          {/* Draft Body */}
          <div className="space-y-4">
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
                    Tip: Click highlighted text to inspect evidence.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Interactive Revision History (Requirement 7) */}
          {content && content.revisions && content.revisions.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Revision History</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {content.revisions.length}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click a revision to view its changes against the previous revision.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {content.revisions.map((rev) => {
                  const isExpanded = selectedHistoryRevN === rev.n;
                  const isLatest = latestRevision && rev.n === latestRevision.n;
                  const prevRev = content.revisions.find((r) => r.n === rev.n - 1);

                  return (
                    <div
                      key={rev.id || rev.n}
                      className={`border rounded-xl overflow-hidden transition-all ${
                        isExpanded
                          ? "border-slate-900 ring-1 ring-slate-900 bg-slate-50/50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedHistoryRevN((curr) =>
                            curr === rev.n ? null : rev.n,
                          )
                        }
                        className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50 transition cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-sm text-slate-900">
                            Revision {rev.n}
                          </span>
                          {isLatest && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white">
                              Latest
                            </span>
                          )}
                          {rev.n === 1 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Initial revision
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>{rev.created_by_name || "Unknown"}</span>
                          <span>&bull;</span>
                          <span>
                            {new Date(rev.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span
                            className={`transition-transform text-slate-400 font-bold ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          >
                            &#9660;
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 pt-0 border-t border-slate-100 space-y-3 mt-2">
                          {rev.n > 1 && prevRev ? (
                            <div className="space-y-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Changes from Revision {prevRev.n}
                              </span>
                              <WordDiff oldText={prevRev.body} newText={rev.body} />
                              <details className="text-xs text-slate-500">
                                <summary className="cursor-pointer hover:text-slate-800 font-semibold select-none">
                                  View full body of Revision {rev.n}
                                </summary>
                                <div className="mt-2 p-3 bg-white border border-slate-200 rounded-lg font-mono text-xs whitespace-pre-wrap text-slate-800">
                                  {rev.body}
                                </div>
                              </details>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Initial Revision Text
                              </span>
                              <div className="p-3 bg-white border border-slate-200 rounded-lg font-mono text-xs whitespace-pre-wrap text-slate-800">
                                {rev.body}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (6 cols): Apply Fixes Bar + Claim Ledger + Rule Findings */}
        <div className="lg:col-span-6 space-y-6">
          {/* Creator Apply Fixes Bar (Requirement 4 & 6) */}
          {isCreatorOwner && isLatestReview && (
            <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    readyCount > 0 ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                  }`}
                />
                <div>
                  <span className="font-semibold text-sm block">
                    {readyCount} {readyCount === 1 ? "fix" : "fixes"} ready
                  </span>
                  {readyCount > 0 ? (
                    <span className="text-xs text-slate-300">
                      {
                        readyFindings.filter(
                          (f) =>
                            f.resolution === "accepted" || f.resolution === "accept",
                        ).length
                      }{" "}
                      accepted,{" "}
                      {
                        readyFindings.filter(
                          (f) =>
                            f.resolution === "edited" || f.resolution === "edit",
                        ).length
                      }{" "}
                      edited
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">
                      Accept or edit fixes below to apply
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleOpenManualEdit}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                >
                  Edit text manually
                </button>
                <button
                  type="button"
                  disabled={readyCount === 0 || previewLoading}
                  onClick={handlePreviewChanges}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 shadow-sm"
                >
                  {previewLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      <span>Previewing...</span>
                    </>
                  ) : (
                    <span>Preview changes &rarr;</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* SECTION 1: Claim Ledger */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Claim Ledger</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-900 text-white">
                    {claimFindings.length}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verified claims with exact factual evidence and guidelines citations.
                </p>
              </div>

              {supportedCount > 0 && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                  &check; {supportedCount} supported as proof
                </span>
              )}
            </div>

            {loading || reviewLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2.5 animate-pulse"
                  >
                    <div className="h-5 w-24 bg-slate-200 rounded" />
                    <div className="h-4 w-3/4 bg-slate-100 rounded" />
                    <div className="h-4 w-1/2 bg-slate-100 rounded" />
                  </div>
                ))}
              </div>
            ) : claimFindings.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
                <span className="text-xs font-semibold text-slate-500 block">
                  {review ? "No claims identified in this revision." : "Review pending."}
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                {claimFindings.map((finding) => {
                  const v = finding.verdict || "unsupported";
                  const vMeta = VERDICT_META[v] ?? {
                    label: v,
                    chipClass: "bg-slate-100 text-slate-800 border-slate-300",
                    highlightClass: "",
                  };

                  const isHighlighted = highlightedFindingId === finding.id;
                  const isSupported = v === "supported";

                  return (
                    <div
                      key={finding.id}
                      id={`finding-card-${finding.id}`}
                      className={`bg-white border rounded-xl p-4 shadow-sm transition-all duration-300 space-y-2.5 ${
                        isHighlighted
                          ? "border-slate-900 ring-2 ring-slate-900 ring-offset-2"
                          : isSupported
                          ? "border-emerald-200 bg-emerald-50/20"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {/* Top: Quoted claim + Verdict chip */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                            Quoted Claim
                          </span>
                          <span className="font-mono text-sm font-bold text-slate-900">
                            "{finding.span_text}"
                          </span>
                        </div>

                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${vMeta.chipClass}`}
                        >
                          {vMeta.label}
                        </span>
                      </div>

                      {/* Evidence Line: Fact and/or Rule citation */}
                      <div className="space-y-1">
                        {finding.fact_code && (
                          <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900 font-mono">
                                Fact {finding.fact_code}:
                              </span>
                              {finding.fact_valid_until && (
                                <span className="text-[11px] font-medium text-slate-500">
                                  Valid until:{" "}
                                  {new Date(
                                    finding.fact_valid_until,
                                  ).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </span>
                              )}
                            </div>
                            <p className="text-slate-700 leading-snug">
                              {finding.fact_statement || "Approved brand fact"}
                            </p>
                          </div>
                        )}

                        {finding.rule_code && (
                          <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-0.5">
                            <span className="font-bold text-slate-900 font-mono block">
                              Rule {finding.rule_code}:
                            </span>
                            <p className="text-slate-700 leading-snug">
                              {finding.rule_text || "Brand guidelines rule"}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Reason */}
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {finding.reason}
                      </p>

                      {/* Suggested Fix */}
                      {finding.suggested_fix && (
                        <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-2.5 flex items-start gap-2">
                          <span className="font-semibold text-emerald-800 shrink-0">
                            Suggested fix:
                          </span>
                          <span className="font-mono text-emerald-950 font-bold break-words">
                            "{finding.suggested_fix}"
                          </span>
                        </div>
                      )}

                      {/* Resolution controls (Accept / Edit / Dismiss) or Badge */}
                      {renderFindingResolution(finding)}
                    </div>
                  );
                })}

                {/* Verdict Legend */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1.5 leading-relaxed">
                  <span className="font-bold text-slate-700">Verdicts:</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <strong>Supported:</strong> backed by in-date fact
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <strong>Outdated:</strong> fact expired
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <strong>Contradicted:</strong> conflicts with fact
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <strong>Unsupported:</strong> unbacked claim
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    <strong>Needs judgement:</strong> regulated term/check
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 2: Rule Guidelines & Other Findings */}
          <div className="space-y-3 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span>Brand Kit Rule Findings</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    {ruleFindings.length}
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Terminology, tone of voice, and accessibility checks.
                </p>
              </div>
            </div>

            {loading || reviewLoading ? (
              <div className="h-20 bg-slate-100 rounded-xl animate-pulse" />
            ) : ruleFindings.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                <span className="text-xs text-slate-500">
                  No terminology or guideline violations detected.
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                {ruleFindings.map((finding) => {
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
                      className={`bg-white border rounded-xl p-4 shadow-sm transition-all duration-300 space-y-2.5 ${
                        isHighlighted
                          ? "border-slate-900 ring-2 ring-slate-900 ring-offset-2"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
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
                        <span className="text-xs text-slate-400 font-medium">
                          {Math.round(finding.confidence * 100)}% confidence
                        </span>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                        <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">
                          Flagged Span
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-900">
                          "{finding.span_text}"
                        </span>
                      </div>

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

                      <p className="text-xs text-slate-600 leading-snug">
                        {finding.reason}
                      </p>

                      {finding.suggested_fix && (
                        <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-2 flex items-start gap-2">
                          <span className="font-semibold text-emerald-800 shrink-0">
                            Suggested fix:
                          </span>
                          <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono text-emerald-950 font-bold break-all">
                            {finding.suggested_fix}
                          </code>
                        </div>
                      )}

                      {/* Resolution controls (Accept / Edit / Dismiss) or Badge */}
                      {renderFindingResolution(finding)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Changes Modal (Requirement 4) */}
      {previewModalOpen && previewData && latestRevision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Preview Changes (Revision {nextRevisionN})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Word-level diff of proposed changes against Revision {latestRevision.n}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl font-bold p-1 cursor-pointer leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Diff Preview
                </span>
                <WordDiff
                  oldText={latestRevision.body}
                  newText={previewData.body}
                />
              </div>

              {/* Skipped fixes list */}
              {previewData.skipped && previewData.skipped.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
                  <span className="font-bold block">
                    Skipped fixes ({previewData.skipped.length}):
                  </span>
                  <ul className="list-disc pl-4 space-y-1">
                    {previewData.skipped.map((s: any, idx: number) => (
                      <li key={idx}>
                        <span className="font-mono font-semibold">
                          "{s.span_text}"
                        </span>
                        : overlaps another fix
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={applyingFixes}
                onClick={() => setPreviewModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={applyingFixes}
                onClick={handleApplyFixes}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold shadow-sm transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
              >
                {applyingFixes ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Creating revision...</span>
                  </>
                ) : (
                  <span>Create revision {nextRevisionN}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Edit Modal (Requirement 6) */}
      {manualModalOpen && latestRevision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Edit Text Manually
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Directly edit draft body to create Revision {nextRevisionN}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl font-bold p-1 cursor-pointer leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Draft Text
                </label>
                <textarea
                  value={manualBody}
                  onChange={(e) => setManualBody(e.target.value)}
                  rows={7}
                  className="w-full text-sm font-sans p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 leading-relaxed font-normal text-slate-800"
                  placeholder="Edit draft text..."
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Live Word-Level Diff
                </span>
                <WordDiff oldText={latestRevision.body} newText={manualBody} />
              </div>
            </div>

            <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={savingManual}
                onClick={() => setManualModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  savingManual ||
                  manualBody === latestRevision.body ||
                  !manualBody.trim()
                }
                onClick={handleSaveManual}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold shadow-sm transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
              >
                {savingManual ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving revision...</span>
                  </>
                ) : (
                  <span>Save as revision {nextRevisionN}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

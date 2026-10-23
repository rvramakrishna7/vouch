import { useState, useRef, type ChangeEvent } from "react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { DEMO_GUIDELINE_TEXT } from "../../data/demoGuideline.js";

export interface GuidelineDraft {
  temp_id: string;
  code: string;
  category: "claims" | "tone" | "terminology" | "accessibility";
  text: string;
  severity: "high" | "medium" | "low";
  source_quote: string;
  source_start: number;
  source_end: number;
  duplicate_of: string | null;
}

interface DraftResponse {
  drafts: GuidelineDraft[];
  rejected: number;
  ai: {
    provider: string;
    model: string;
    latency_ms: number;
  };
}

interface ImportGuidelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied: (count: number) => void;
}

export function ImportGuidelineModal({
  isOpen,
  onClose,
  onApplied,
}: ImportGuidelineModalProps) {
  const [step, setStep] = useState<"input" | "review">("input");
  const [guidelineText, setGuidelineText] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Review step state
  const [drafts, setDrafts] = useState<GuidelineDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectedCount, setRejectedCount] = useState(0);
  const [aiInfo, setAiInfo] = useState<{ provider: string; model: string; latency_ms: number } | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleUseSample = () => {
    setGuidelineText(DEMO_GUIDELINE_TEXT);
    setDraftError(null);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setDraftError("Please upload a .docx file.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setIsDrafting(true);
    setDraftError(null);

    try {
      const token = sessionStorage.getItem("vouch_token");
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiUrl}/api/guidelines/draft`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!res.ok) {
        if (res.status === 503) {
          throw new Error("ai_unavailable");
        }
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to process document");
      }

      const data: DraftResponse = await res.json();
      setupReviewState(data, "");
    } catch (err: any) {
      handleDraftError(err);
    } finally {
      setIsDrafting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDraftRules = async () => {
    if (guidelineText.trim().length < 50) {
      setDraftError("Please enter at least 50 characters of brand guideline text.");
      return;
    }

    setIsDrafting(true);
    setDraftError(null);

    try {
      const data = await apiFetch<DraftResponse>("/api/guidelines/draft", {
        method: "POST",
        body: JSON.stringify({ text: guidelineText }),
      });

      setupReviewState(data, guidelineText);
    } catch (err: any) {
      handleDraftError(err);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleDraftError = (err: any) => {
    console.error("Draft rules error:", err);
    if (
      err instanceof ApiError &&
      (err.status === 503 || (err.data as any)?.error === "ai_unavailable")
    ) {
      setDraftError("AI is unavailable right now. Try again in a minute.");
    } else if (err.message === "ai_unavailable") {
      setDraftError("AI is unavailable right now. Try again in a minute.");
    } else {
      setDraftError(err.message || "Failed to draft rules from guideline.");
    }
  };

  const setupReviewState = (data: DraftResponse, _textSource: string) => {
    setDrafts(data.drafts);
    setRejectedCount(data.rejected);
    setAiInfo(data.ai);

    // Checked by default, UNchecked if duplicate
    const initialSelected = new Set<string>();
    for (const d of data.drafts) {
      if (!d.duplicate_of) {
        initialSelected.add(d.temp_id);
      }
    }
    setSelectedIds(initialSelected);
    setStep("review");
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const updateDraft = (id: string, updates: Partial<GuidelineDraft>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.temp_id === id ? { ...d, ...updates } : d)),
    );
  };

  const handleApplyRules = async () => {
    const selectedDrafts = drafts.filter((d) => selectedIds.has(d.temp_id));
    if (selectedDrafts.length === 0) return;

    setIsApplying(true);
    setApplyError(null);

    try {
      const payload = {
        rules: selectedDrafts.map((d) => ({
          code: d.code,
          category: d.category,
          text: d.text.trim(),
          severity: d.severity,
          source_quote: d.source_quote,
        })),
      };

      await apiFetch<{ rules: any[] }>("/api/guidelines/apply", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      onApplied(selectedDrafts.length);
      onClose();
    } catch (err: any) {
      console.error("Apply rules error:", err);
      if (err instanceof ApiError && err.status === 409) {
        setApplyError("A rule with this code already exists. Please review codes and try again.");
      } else {
        setApplyError(err.message || "Failed to add rules to Brand Kit.");
      }
    } finally {
      setIsApplying(false);
    }
  };

  // Helper to extract context excerpt around a source quote
  const renderExcerpt = (sourceQuote: string, start?: number, end?: number) => {
    if (!guidelineText) {
      return (
        <p className="text-xs text-slate-600 italic">
          &ldquo;{sourceQuote}&rdquo;
        </p>
      );
    }

    const qStart = start !== undefined && start >= 0 ? start : guidelineText.indexOf(sourceQuote);
    if (qStart === -1) {
      return (
        <p className="text-xs text-slate-600 italic">
          &ldquo;{sourceQuote}&rdquo;
        </p>
      );
    }

    const qEnd = end !== undefined && end > qStart ? end : qStart + sourceQuote.length;
    const beforeIndex = Math.max(0, qStart - 60);
    const afterIndex = Math.min(guidelineText.length, qEnd + 60);

    const before = guidelineText.slice(beforeIndex, qStart);
    const highlighted = guidelineText.slice(qStart, qEnd);
    const after = guidelineText.slice(qEnd, afterIndex);

    return (
      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 leading-relaxed font-mono">
        <span className="text-slate-400 font-sans">{beforeIndex > 0 ? "…" : ""}</span>
        <span>{before}</span>
        <mark className="bg-amber-100 text-amber-900 font-semibold px-1 py-0.5 rounded border border-amber-300 mx-0.5">
          {highlighted || sourceQuote}
        </mark>
        <span>{after}</span>
        <span className="text-slate-400 font-sans">{afterIndex < guidelineText.length ? "…" : ""}</span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span>Import Rules from Guideline</span>
              {step === "review" && (
                <span className="text-xs font-semibold px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                  Review &amp; Approve
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === "input"
                ? "Paste your brand guideline or upload a DOCX document. AI will extract discrete governing rules."
                : "Review and edit AI-drafted rules. Deselect duplicates or rules you do not wish to adopt."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {step === "input" ? (
            <div className="space-y-4">
              {draftError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
                  {draftError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Guideline Document Text
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUseSample}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    Use sample guideline
                  </button>
                  <label className="text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition cursor-pointer border border-slate-300 inline-flex items-center gap-1.5">
                    <span>Upload DOCX</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isDrafting}
                    />
                  </label>
                </div>
              </div>

              <textarea
                rows={12}
                value={guidelineText}
                onChange={(e) => setGuidelineText(e.target.value)}
                placeholder="Paste guideline text here (at least 50 characters)..."
                disabled={isDrafting}
                className="w-full text-xs font-mono p-4 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50 leading-relaxed disabled:opacity-50"
              />

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{guidelineText.length} characters (min 50)</span>
                <button
                  type="button"
                  disabled={isDrafting || guidelineText.trim().length < 50}
                  onClick={handleDraftRules}
                  className="h-10 px-5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
                >
                  {isDrafting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Drafting rules…</span>
                    </>
                  ) : (
                    <span>Draft rules</span>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {applyError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
                  {applyError}
                </div>
              )}

              {/* Summary Stats */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">
                    {drafts.length} rules drafted
                  </span>
                  {rejectedCount > 0 && (
                    <span className="text-slate-500">
                      ({rejectedCount} dropped due to unverified quotes)
                    </span>
                  )}
                </div>
                {aiInfo && (
                  <span className="text-slate-500">
                    AI: {aiInfo.provider} ({aiInfo.model}) · {(aiInfo.latency_ms / 1000).toFixed(1)}s
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setStep("input")}
                  className="text-blue-600 hover:text-blue-800 font-semibold underline cursor-pointer ml-auto"
                >
                  Edit source text
                </button>
              </div>

              {/* Draft Cards List */}
              <div className="space-y-4">
                {drafts.map((draft) => {
                  const isChecked = selectedIds.has(draft.temp_id);
                  const isDup = Boolean(draft.duplicate_of);

                  return (
                    <div
                      key={draft.temp_id}
                      className={`p-4 rounded-xl border transition ${
                        isChecked
                          ? isDup
                            ? "bg-amber-50/30 border-amber-300 ring-1 ring-amber-300"
                            : "bg-white border-slate-300 shadow-sm"
                          : "bg-slate-50/70 border-slate-200 opacity-60"
                      }`}
                    >
                      {/* Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(draft.temp_id)}
                            className="w-4 h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
                          />
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            {draft.code}
                          </span>
                        </label>

                        <div className="flex items-center gap-2">
                          {isDup && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-md">
                              ⚠ Possible duplicate of {draft.duplicate_of}
                            </span>
                          )}

                          <select
                            value={draft.category}
                            onChange={(e) =>
                              updateDraft(draft.temp_id, {
                                category: e.target.value as GuidelineDraft["category"],
                              })
                            }
                            className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-slate-900"
                          >
                            <option value="claims">claims</option>
                            <option value="tone">tone</option>
                            <option value="terminology">terminology</option>
                            <option value="accessibility">accessibility</option>
                          </select>

                          <select
                            value={draft.severity}
                            onChange={(e) =>
                              updateDraft(draft.temp_id, {
                                severity: e.target.value as GuidelineDraft["severity"],
                              })
                            }
                            className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-slate-900"
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </div>
                      </div>

                      {/* Rule Text (Editable) */}
                      <div className="space-y-1.5 mb-3">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Rule Statement (Editable)
                        </label>
                        <textarea
                          rows={2}
                          value={draft.text}
                          onChange={(e) =>
                            updateDraft(draft.temp_id, { text: e.target.value })
                          }
                          className="w-full text-xs p-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 leading-normal"
                        />
                      </div>

                      {/* Source Quote with Context Excerpt */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <span>Evidence: Source Quote from Guideline</span>
                          <span className="text-emerald-700 font-semibold font-sans normal-case">
                            ✓ Quote verified in text
                          </span>
                        </div>
                        {renderExcerpt(draft.source_quote, draft.source_start, draft.source_end)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer (Step 2 Review only) */}
        {step === "review" && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between gap-4 shrink-0">
            <span className="text-sm font-semibold text-slate-700">
              {selectedIds.size} selected of {drafts.length} rules
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep("input")}
                disabled={isApplying}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isApplying || selectedIds.size === 0}
                onClick={handleApplyRules}
                className="h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
              >
                {isApplying ? "Adding rules…" : `Add ${selectedIds.size} rules`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

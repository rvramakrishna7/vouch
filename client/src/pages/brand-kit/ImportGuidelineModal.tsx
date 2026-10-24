import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { DEMO_GUIDELINE_TEXT } from "../../data/demoGuideline.js";
import { Button } from "../../components/Button.js";
import { plural } from "../../lib/format.js";

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
  source_text: string;
  ai: {
    provider: string;
    model: string;
    latency_ms: number;
  };
}

interface RuleSummary {
  code: string;
  text: string;
}

interface ImportGuidelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied: (count: number) => void;
}

function AutoGrowingTextarea({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.max(ref.current.scrollHeight, 64)}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange(e);
        if (ref.current) {
          ref.current.style.height = "auto";
          ref.current.style.height = `${Math.max(ref.current.scrollHeight, 64)}px`;
        }
      }}
      rows={2}
      className={className}
    />
  );
}

export function ImportGuidelineModal({
  isOpen,
  onClose,
  onApplied,
}: ImportGuidelineModalProps) {
  const [step, setStep] = useState<"input" | "review">("input");
  const [guidelineText, setGuidelineText] = useState("");
  const [serverSourceText, setServerSourceText] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftingStep, setDraftingStep] = useState<string>("Reading guideline…");
  const [draftError, setDraftError] = useState<string | null>(null);

  // Review step state
  const [drafts, setDrafts] = useState<GuidelineDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectedCount, setRejectedCount] = useState(0);
  const [aiInfo, setAiInfo] = useState<{ provider: string; model: string; latency_ms: number } | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [rulesMap, setRulesMap] = useState<Map<string, string>>(new Map());

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Timer for step text advancing: "Reading guideline…" -> "Drafting rules…" -> "Checking duplicates…"
  useEffect(() => {
    if (!isDrafting) {
      setDraftingStep("Reading guideline…");
      return;
    }

    setDraftingStep("Reading guideline…");
    const t1 = setTimeout(() => {
      setDraftingStep("Drafting rules…");
    }, 1200);

    const t2 = setTimeout(() => {
      setDraftingStep("Checking duplicates…");
    }, 2800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isDrafting]);

  // Load existing rules map on open so we can show rule text in the duplicate tooltip
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    apiFetch<RuleSummary[]>("/api/rules")
      .then((rules) => {
        if (!mounted || !Array.isArray(rules)) return;
        const map = new Map<string, string>();
        for (const r of rules) {
          map.set(r.code, r.text);
        }
        setRulesMap(map);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isOpen]);

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
      setupReviewState(data);
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

      setupReviewState(data);
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

  const setupReviewState = (data: DraftResponse) => {
    setDrafts(data.drafts);
    setRejectedCount(data.rejected);
    setAiInfo(data.ai);
    setServerSourceText(data.source_text || guidelineText);

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

  // Helper to clean markdown markers from before and after text while keeping mark text intact
  const cleanMarkdownForDisplay = (str: string): string => {
    return str
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .replace(/^#+\s+/gm, "")
      .replace(/^-\s+/gm, "")
      .replace(/^\s*-\s+/g, "");
  };

  // Helper to extract context excerpt around source quote rendered STRICTLY from source_text
  const renderExcerpt = (sourceQuote: string, start?: number, end?: number) => {
    const textToSearch = serverSourceText || guidelineText;

    if (!textToSearch) {
      return (
        <p className="text-xs text-slate-600 italic">
          &ldquo;{sourceQuote}&rdquo;
        </p>
      );
    }

    let qStart = start !== undefined && start >= 0 ? start : -1;
    let qEnd = end !== undefined && end > qStart ? end : -1;

    // Verify if given offsets correspond to sourceQuote
    if (qStart >= 0 && qEnd <= textToSearch.length) {
      const candidate = textToSearch.slice(qStart, qEnd);
      if (candidate.toLowerCase() !== sourceQuote.toLowerCase()) {
        qStart = textToSearch.indexOf(sourceQuote);
        if (qStart >= 0) {
          qEnd = qStart + sourceQuote.length;
        }
      }
    } else {
      qStart = textToSearch.indexOf(sourceQuote);
      if (qStart >= 0) {
        qEnd = qStart + sourceQuote.length;
      }
    }

    if (qStart === -1 || qEnd === -1) {
      return (
        <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 leading-relaxed font-mono">
          <mark className="bg-amber-100 text-amber-900 font-semibold px-1 py-0.5 rounded border border-amber-300 mx-0.5">
            {sourceQuote}
          </mark>
        </div>
      );
    }

    // Cut excerpt at word boundaries before and after
    let beforeIndex = Math.max(0, qStart - 60);
    if (beforeIndex > 0) {
      const spaceIdx = textToSearch.indexOf(" ", beforeIndex);
      if (spaceIdx !== -1 && spaceIdx < qStart) {
        beforeIndex = spaceIdx + 1;
      }
    }

    let afterIndex = Math.min(textToSearch.length, qEnd + 60);
    if (afterIndex < textToSearch.length) {
      const spaceIdx = textToSearch.lastIndexOf(" ", afterIndex);
      if (spaceIdx !== -1 && spaceIdx > qEnd) {
        afterIndex = spaceIdx;
      }
    }

    const rawBefore = textToSearch.slice(beforeIndex, qStart);
    const highlighted = textToSearch.slice(qStart, qEnd);
    const rawAfter = textToSearch.slice(qEnd, afterIndex);

    const cleanBefore = cleanMarkdownForDisplay(rawBefore);
    const cleanAfter = cleanMarkdownForDisplay(rawAfter);

    return (
      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 leading-relaxed font-mono">
        <span className="text-slate-400 font-sans">{beforeIndex > 0 ? "… " : ""}</span>
        <span>{cleanBefore}</span>
        <mark className="bg-amber-100 text-amber-900 font-semibold px-1 py-0.5 rounded border border-amber-300 mx-0.5">
          {highlighted}
        </mark>
        <span>{cleanAfter}</span>
        <span className="text-slate-400 font-sans">{afterIndex < textToSearch.length ? " …" : ""}</span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4 overflow-hidden sm:overflow-y-auto">
      <div className="bg-white sm:rounded-2xl shadow-xl sm:border border-slate-200 w-full max-w-4xl h-full sm:h-auto max-h-full sm:max-h-[90vh] flex flex-col overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/50 shrink-0">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5">
              <h2 className="text-lg font-bold text-slate-900">
                Import rules from guideline
              </h2>
              {step === "review" && (
                <span className="text-xs font-semibold px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full whitespace-nowrap w-fit">
                  Review and approve
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {step === "input"
                ? "Paste your brand guideline or upload a DOCX document. AI will extract discrete governing rules."
                : "Review and edit AI-drafted rules. Deselect duplicates or rules you do not wish to adopt."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 min-h-0 h-9 w-9 !px-0"
            title="Close"
          >
            ✕
          </Button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-6">
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
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUseSample}
                    className="text-blue-600 hover:text-blue-800 bg-blue-50/50 hover:bg-blue-100 border-blue-200"
                  >
                    Use sample guideline
                  </Button>
                  <label className="text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3.5 py-1.5 min-h-[40px] rounded-lg transition cursor-pointer border border-slate-300 inline-flex items-center gap-1.5 select-none">
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

              <div className="flex items-center justify-between gap-3 text-xs text-slate-500 sticky bottom-0 -mx-4 px-4 sm:mx-0 sm:px-0 py-3 sm:py-0 bg-white border-t border-slate-200 sm:border-0">
                <span>{guidelineText.length} characters (min 50)</span>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={isDrafting || guidelineText.trim().length < 50}
                  loading={isDrafting}
                  loadingText={draftingStep}
                  onClick={handleDraftRules}
                >
                  Draft rules
                </Button>
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
                    {plural(drafts.length, "rule drafted", "rules drafted")}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("input")}
                  className="text-blue-600 hover:text-blue-800 ml-auto min-h-0 py-1"
                >
                  Edit source text
                </Button>
              </div>

              {/* Draft Cards List */}
              <div className="space-y-4">
                {drafts.map((draft) => {
                  const isChecked = selectedIds.has(draft.temp_id);
                  const isDup = Boolean(draft.duplicate_of);
                  const matchedRuleText = draft.duplicate_of ? rulesMap.get(draft.duplicate_of) : undefined;
                  const dupTooltip = matchedRuleText
                    ? `Matched ${draft.duplicate_of}: "${matchedRuleText}"`
                    : `Possible duplicate of ${draft.duplicate_of}`;

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
                        <label className="flex items-center gap-2.5 min-h-10 sm:min-h-0 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(draft.temp_id)}
                            className="w-5 h-5 sm:w-4 sm:h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
                          />
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            {draft.code}
                          </span>
                        </label>

                        <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:items-center gap-2">
                          {isDup && (
                            <span
                              title={dupTooltip}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-md cursor-help whitespace-nowrap"
                            >
                              ⚠ Possible duplicate of {draft.duplicate_of}
                            </span>
                          )}

                          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                            <select
                              value={draft.category}
                              onChange={(e) =>
                                updateDraft(draft.temp_id, {
                                  category: e.target.value as GuidelineDraft["category"],
                                })
                              }
                              className="w-full sm:w-auto text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900 min-h-[40px] sm:min-h-0"
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
                              className="w-full sm:w-auto text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900 min-h-[40px] sm:min-h-0"
                            >
                              <option value="high">High</option>
                              <option value="medium">Medium</option>
                              <option value="low">Low</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Rule Text (Editable with auto-growing textarea) */}
                      <div className="space-y-1.5 mb-3">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                          Rule Statement (Editable)
                        </label>
                        <AutoGrowingTextarea
                          value={draft.text}
                          onChange={(e) =>
                            updateDraft(draft.temp_id, { text: e.target.value })
                          }
                          className="w-full text-xs p-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 leading-normal"
                        />
                      </div>

                      {/* Source Quote with Context Excerpt */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
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
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 shrink-0">
            <span className="text-sm font-semibold text-slate-700">
              {selectedIds.size} selected of {plural(drafts.length, "rule")}
            </span>
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setStep("input")}
                disabled={isApplying}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={isApplying || selectedIds.size === 0}
                loading={isApplying}
                loadingText="Adding…"
                onClick={handleApplyRules}
                className="bg-blue-600 hover:bg-blue-700 border-blue-600"
              >
                {selectedIds.size > 0 ? `Add ${plural(selectedIds.size, "rule")}` : "Add rules"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

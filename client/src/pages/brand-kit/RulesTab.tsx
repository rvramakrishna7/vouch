import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { ImportGuidelineModal } from "./ImportGuidelineModal.js";

export interface Rule {
  id: string;
  organization_id: string;
  code: string;
  category: "claims" | "tone" | "terminology" | "accessibility";
  severity: "high" | "medium" | "low";
  text: string;
  version: number;
  status: "active" | "archived" | "draft";
  created_at: string;
}

export function RulesTab({ isBrandManager }: { isBrandManager: boolean }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);

  // Add rule state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState<Rule["category"]>("claims");
  const [newSeverity, setNewSeverity] = useState<Rule["severity"]>("high");
  const [newText, setNewText] = useState("");
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Edit rule state
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [editSeverity, setEditSeverity] = useState<Rule["severity"]>("high");
  const [editText, setEditText] = useState("");
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const fetchRules = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<Rule[]>("/api/rules");
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleAddRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    setSubmittingAdd(true);
    setError(null);
    setSuccess(null);

    try {
      const created = await apiFetch<Rule>("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          category: newCategory,
          severity: newSeverity,
          text: newText.trim(),
        }),
      });

      setSuccess(`Rule ${created.code} created successfully.`);
      setNewText("");
      setShowAddForm(false);
      await fetchRules();
    } catch (err) {
      if (err instanceof ApiError && err.data && typeof err.data === "object" && "details" in err.data) {
        setError(JSON.stringify((err.data as { details: unknown }).details));
      } else {
        setError(err instanceof Error ? err.message : "Failed to create rule");
      }
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleStartEdit = (rule: Rule) => {
    setEditingRule(rule);
    setEditSeverity(rule.severity);
    setEditText(rule.text);
    setError(null);
    setSuccess(null);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingRule || !editText.trim()) return;

    setSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await apiFetch<Rule>(`/api/rules/${editingRule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          severity: editSeverity,
          text: editText.trim(),
        }),
      });

      setSuccess(`Rule ${updated.code} updated (version ${updated.version}).`);
      setEditingRule(null);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rule");
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleArchive = async (rule: Rule) => {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch<Rule>(`/api/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
      setSuccess(`Rule ${rule.code} archived.`);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive rule");
    }
  };

  const severityBadge = (severity: Rule["severity"]) => {
    switch (severity) {
      case "high":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
            High
          </span>
        );
      case "medium":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            Medium
          </span>
        );
      case "low":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            Low
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Numbered brand rules that govern claims, tone of voice, terminology usage, and accessibility standards.
        </p>
        {isBrandManager && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="text-sm font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              Import from guideline
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              {showAddForm ? "Cancel" : "+ Add rule"}
            </button>
          </div>
        )}
      </div>

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 rounded-lg">
          {success}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-800 rounded-lg">
          {error}
        </div>
      )}

      {/* Add rule form */}
      {showAddForm && (
        <form onSubmit={handleAddRule} className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Add New Governance Rule</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as Rule["category"])}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              >
                <option value="claims">claims (CLAIM-xx)</option>
                <option value="tone">tone (TONE-xx)</option>
                <option value="terminology">terminology (TERM-xx)</option>
                <option value="accessibility">accessibility (ACC-xx)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Severity</label>
              <select
                value={newSeverity}
                onChange={(e) => setNewSeverity(e.target.value as Rule["severity"])}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Rule Statement / Guidelines</label>
            <textarea
              required
              rows={2}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. Every environmental claim must be backed by an approved fact."
              className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-slate-900"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingAdd}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {submittingAdd ? "Saving…" : "Save Rule"}
            </button>
          </div>
        </form>
      )}

      {/* Edit modal / drawer */}
      {editingRule && (
        <form onSubmit={handleSaveEdit} className="bg-amber-50/50 border border-amber-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Editing Rule: <span className="font-mono text-blue-700">{editingRule.code}</span> (v{editingRule.version})
            </h3>
            <button
              type="button"
              onClick={() => setEditingRule(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Severity</label>
            <select
              value={editSeverity}
              onChange={(e) => setEditSeverity(e.target.value as Rule["severity"])}
              className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Rule Statement</label>
            <textarea
              required
              rows={3}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-slate-900"
            />
            <p className="mt-1 text-xs text-slate-500">
              Editing the statement text automatically increments the rule version.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingRule(null)}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingEdit}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {submittingEdit ? "Updating…" : "Update Rule"}
            </button>
          </div>
        </form>
      )}

      {/* Rules table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading rules…</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No brand rules registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="stack-table w-full text-left text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Rule Text</th>
                  <th className="px-4 py-3">Ver</th>
                  <th className="px-4 py-3">Status</th>
                  {isBrandManager && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50/50 transition-colors">
                    <td data-label="Code" className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {rule.code}
                    </td>
                    <td data-label="Category" className="px-4 py-3 text-slate-600 capitalize whitespace-nowrap">
                      {rule.category}
                    </td>
                    <td data-label="Severity" className="px-4 py-3 whitespace-nowrap">
                      {severityBadge(rule.severity)}
                    </td>
                    <td data-label="Rule" className="px-4 py-3 text-slate-800 max-w-md">
                      {rule.text}
                    </td>
                    <td data-label="Version" className="px-4 py-3 text-slate-500 font-mono text-xs whitespace-nowrap">
                      v{rule.version}
                    </td>
                    <td data-label="Status" className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          rule.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {rule.status}
                      </span>
                    </td>
                    {isBrandManager && (
                      <td data-label="Actions" className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(rule)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                        {rule.status !== "archived" && (
                          <button
                            type="button"
                            onClick={() => handleArchive(rule)}
                            className="text-xs font-medium text-slate-500 hover:text-slate-800"
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ImportGuidelineModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onApplied={(count) => {
          setSuccess(`Successfully imported ${count} rule(s) into Brand Kit.`);
          void fetchRules();
        }}
      />
    </div>
  );
}

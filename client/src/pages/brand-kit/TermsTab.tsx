import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "../../lib/api.js";

export interface Term {
  id: string;
  organization_id: string;
  term: string;
  type: "preferred" | "banned" | "regulated";
  replacement: string | null;
  created_at: string;
}

export function TermsTab({ isBrandManager }: { isBrandManager: boolean }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add term state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [newType, setNewType] = useState<Term["type"]>("banned");
  const [newReplacement, setNewReplacement] = useState("");
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Edit term state
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);
  const [editTerm, setEditTerm] = useState("");
  const [editType, setEditType] = useState<Term["type"]>("banned");
  const [editReplacement, setEditReplacement] = useState("");
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Delete inline confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTerms = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<Term[]>("/api/terms");
      setTerms(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load terms");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTerms();
  }, []);

  const handleAddTerm = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTerm.trim()) return;

    setSubmittingAdd(true);
    setError(null);
    setSuccess(null);

    try {
      const created = await apiFetch<Term>("/api/terms", {
        method: "POST",
        body: JSON.stringify({
          term: newTerm.trim(),
          type: newType,
          replacement: newReplacement.trim() || undefined,
        }),
      });

      setSuccess(`Term "${created.term}" added.`);
      setNewTerm("");
      setNewReplacement("");
      setShowAddForm(false);
      await fetchTerms();
    } catch (err) {
      if (err instanceof ApiError && err.data && typeof err.data === "object" && "details" in err.data) {
        setError(JSON.stringify((err.data as { details: unknown }).details));
      } else {
        setError(err instanceof Error ? err.message : "Failed to add term");
      }
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleStartEdit = (term: Term) => {
    setEditingTerm(term);
    setEditTerm(term.term);
    setEditType(term.type);
    setEditReplacement(term.replacement ?? "");
    setConfirmDeleteId(null);
    setError(null);
    setSuccess(null);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTerm || !editTerm.trim()) return;

    setSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await apiFetch<Term>(`/api/terms/${editingTerm.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          term: editTerm.trim(),
          type: editType,
          replacement: editReplacement.trim() || null,
        }),
      });

      setSuccess(`Term "${updated.term}" updated.`);
      setEditingTerm(null);
      await fetchTerms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update term");
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDelete = async (term: Term) => {
    setDeletingId(term.id);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/terms/${term.id}`, { method: "DELETE" });
      setSuccess(`Term "${term.term}" deleted.`);
      setConfirmDeleteId(null);
      await fetchTerms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete term");
    } finally {
      setDeletingId(null);
    }
  };

  const typeBadge = (type: Term["type"]) => {
    switch (type) {
      case "banned":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
            Banned
          </span>
        );
      case "regulated":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            Regulated
          </span>
        );
      case "preferred":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            Preferred
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Controlled brand vocabulary: banned terms that violate guidelines, regulated terms requiring explicit substantiation, and preferred terms.
        </p>
        {isBrandManager && (
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 rounded-lg transition-colors"
          >
            {showAddForm ? "Cancel" : "+ Add term"}
          </button>
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

      {/* Add term form */}
      {showAddForm && (
        <form onSubmit={handleAddTerm} className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Add Controlled Term</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Term / Phrase</label>
              <input
                required
                type="text"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="e.g. 100% natural"
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Governance Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as Term["type"])}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              >
                <option value="banned">Banned (strictly prohibited)</option>
                <option value="regulated">Regulated (requires citation)</option>
                <option value="preferred">Preferred (standard phrasing)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Replacement / Guidance (optional)</label>
              <input
                type="text"
                value={newReplacement}
                onChange={(e) => setNewReplacement(e.target.value)}
                placeholder="e.g. tested"
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
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
              {submittingAdd ? "Saving…" : "Save Term"}
            </button>
          </div>
        </form>
      )}

      {/* Edit term form */}
      {editingTerm && (
        <form onSubmit={handleSaveEdit} className="bg-amber-50/50 border border-amber-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Editing Term: <span className="font-semibold text-blue-700">{editingTerm.term}</span>
            </h3>
            <button
              type="button"
              onClick={() => setEditingTerm(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Term</label>
              <input
                required
                type="text"
                value={editTerm}
                onChange={(e) => setEditTerm(e.target.value)}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Governance Type</label>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value as Term["type"])}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              >
                <option value="banned">Banned</option>
                <option value="regulated">Regulated</option>
                <option value="preferred">Preferred</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Replacement</label>
              <input
                type="text"
                value={editReplacement}
                onChange={(e) => setEditReplacement(e.target.value)}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingTerm(null)}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingEdit}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {submittingEdit ? "Updating…" : "Update Term"}
            </button>
          </div>
        </form>
      )}

      {/* Terms table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading terms…</div>
        ) : terms.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No brand terms registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="stack-table w-full text-left text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Term / Phrase</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Replacement / Guidance</th>
                  {isBrandManager && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {terms.map((term) => (
                  <tr key={term.id} className="hover:bg-slate-50/50 transition-colors">
                    <td data-label="Term" className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {term.term}
                    </td>
                    <td data-label="Type" className="px-4 py-3 whitespace-nowrap">
                      {typeBadge(term.type)}
                    </td>
                    <td data-label="Guidance" className="px-4 py-3 text-slate-700 text-xs">
                      {term.replacement || "—"}
                    </td>
                    {isBrandManager && (
                      <td data-label="Actions" className="px-4 py-3 text-right whitespace-nowrap">
                        {confirmDeleteId === term.id ? (
                          <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 px-2 py-1 rounded text-xs">
                            <span className="text-red-700 font-medium">Are you sure?</span>
                            <button
                              type="button"
                              disabled={deletingId === term.id}
                              onClick={() => handleDelete(term)}
                              className="font-bold text-red-700 hover:text-red-900 underline"
                            >
                              {deletingId === term.id ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-slate-500 hover:text-slate-800"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="space-x-2">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(term)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(term.id);
                                setEditingTerm(null);
                              }}
                              className="text-xs font-medium text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          </div>
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
    </div>
  );
}

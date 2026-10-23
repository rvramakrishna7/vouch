import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "../../lib/api.js";

export interface Fact {
  id: string;
  organization_id: string;
  code: string;
  statement: string;
  source: string;
  owner: string | null;
  valid_until: string;
  expired: boolean;
  created_at: string;
}

export function FactsTab({ isBrandManager }: { isBrandManager: boolean }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add fact state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStatement, setNewStatement] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newValidUntil, setNewValidUntil] = useState("");
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Edit fact state
  const [editingFact, setEditingFact] = useState<Fact | null>(null);
  const [editStatement, setEditStatement] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editOwner, setEditOwner] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const fetchFacts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<Fact[]>("/api/facts");
      setFacts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load facts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFacts();
  }, []);

  const handleAddFact = async (e: FormEvent) => {
    e.preventDefault();
    if (!newStatement.trim() || !newSource.trim() || !newValidUntil) return;

    setSubmittingAdd(true);
    setError(null);
    setSuccess(null);

    try {
      const created = await apiFetch<Fact>("/api/facts", {
        method: "POST",
        body: JSON.stringify({
          statement: newStatement.trim(),
          source: newSource.trim(),
          owner: newOwner.trim() || undefined,
          valid_until: newValidUntil,
        }),
      });

      setSuccess(`Fact ${created.code} created successfully.`);
      setNewStatement("");
      setNewSource("");
      setNewOwner("");
      setNewValidUntil("");
      setShowAddForm(false);
      await fetchFacts();
    } catch (err) {
      if (err instanceof ApiError && err.data && typeof err.data === "object" && "details" in err.data) {
        setError(JSON.stringify((err.data as { details: unknown }).details));
      } else {
        setError(err instanceof Error ? err.message : "Failed to create fact");
      }
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleStartEdit = (fact: Fact) => {
    setEditingFact(fact);
    setEditStatement(fact.statement);
    setEditSource(fact.source);
    setEditOwner(fact.owner ?? "");
    setEditValidUntil(fact.valid_until.slice(0, 10));
    setError(null);
    setSuccess(null);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingFact || !editStatement.trim() || !editSource.trim() || !editValidUntil) return;

    setSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await apiFetch<Fact>(`/api/facts/${editingFact.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          statement: editStatement.trim(),
          source: editSource.trim(),
          owner: editOwner.trim() || null,
          valid_until: editValidUntil,
        }),
      });

      setSuccess(`Fact ${updated.code} updated successfully.`);
      setEditingFact(null);
      await fetchFacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update fact");
    } finally {
      setSubmittingEdit(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Approved facts with verifiable sources and expiry dates. Claims in marketing copy cite these numbered facts.
        </p>
        {isBrandManager && (
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 rounded-lg transition-colors"
          >
            {showAddForm ? "Cancel" : "+ Add fact"}
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

      {/* Add fact form */}
      {showAddForm && (
        <form onSubmit={handleAddFact} className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Add New Approved Fact</h3>
          <div>
            <label className="block text-xs font-medium text-slate-700">Fact Statement</label>
            <textarea
              required
              rows={2}
              value={newStatement}
              onChange={(e) => setNewStatement(e.target.value)}
              placeholder="e.g. Aqualeaf bottles keep drinks cold for 24 hours."
              className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-slate-900"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Source Document / Proof</label>
              <input
                required
                type="text"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                placeholder="e.g. Lab thermal test report #2026"
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Owner (optional)</label>
              <input
                type="text"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="e.g. Quality Assurance"
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Valid Until</label>
              <input
                required
                type="date"
                value={newValidUntil}
                onChange={(e) => setNewValidUntil(e.target.value)}
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
              {submittingAdd ? "Saving…" : "Save Fact"}
            </button>
          </div>
        </form>
      )}

      {/* Edit fact form */}
      {editingFact && (
        <form onSubmit={handleSaveEdit} className="bg-amber-50/50 border border-amber-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Editing Fact: <span className="font-mono text-blue-700">{editingFact.code}</span>
            </h3>
            <button
              type="button"
              onClick={() => setEditingFact(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Statement</label>
            <textarea
              required
              rows={2}
              value={editStatement}
              onChange={(e) => setEditStatement(e.target.value)}
              className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-slate-900"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Source</label>
              <input
                required
                type="text"
                value={editSource}
                onChange={(e) => setEditSource(e.target.value)}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Owner</label>
              <input
                type="text"
                value={editOwner}
                onChange={(e) => setEditOwner(e.target.value)}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Valid Until</label>
              <input
                required
                type="date"
                value={editValidUntil}
                onChange={(e) => setEditValidUntil(e.target.value)}
                className="mt-1 block w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingFact(null)}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingEdit}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
            >
              {submittingEdit ? "Updating…" : "Update Fact"}
            </button>
          </div>
        </form>
      )}

      {/* Facts table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading facts…</div>
        ) : facts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No approved facts registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="stack-table w-full text-left text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Fact Statement</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Valid Until</th>
                  <th className="px-4 py-3">Status</th>
                  {isBrandManager && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {facts.map((fact) => (
                  <tr key={fact.id} className="hover:bg-slate-50/50 transition-colors">
                    <td data-label="Code" className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {fact.code}
                    </td>
                    <td data-label="Statement" className="px-4 py-3 text-slate-800 max-w-md font-medium">
                      {fact.statement}
                    </td>
                    <td data-label="Source" className="px-4 py-3 text-slate-600 text-xs max-w-xs">
                      {fact.source}
                    </td>
                    <td data-label="Owner" className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {fact.owner || "—"}
                    </td>
                    <td data-label="Valid until" className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {fact.valid_until.slice(0, 10)}
                    </td>
                    <td data-label="Status" className="px-4 py-3 whitespace-nowrap">
                      {fact.expired ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-200 animate-pulse">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active
                        </span>
                      )}
                    </td>
                    {isBrandManager && (
                      <td data-label="Actions" className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(fact)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
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

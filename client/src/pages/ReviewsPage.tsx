export function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Review Queue
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Review flagged claims, evaluate intent-preserving fixes, and approve or request changes before publication.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Reviewer Decision Center
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Review queues, diff viewer, finding resolution approvals, and override reason workflows will appear here in Step S9 and S10.
        </p>
      </div>
    </div>
  );
}

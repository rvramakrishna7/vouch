import { useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { FactsTab } from "./brand-kit/FactsTab.js";
import { RulesTab } from "./brand-kit/RulesTab.js";
import { TermsTab } from "./brand-kit/TermsTab.js";

type Tab = "rules" | "facts" | "terms";

export function BrandKitPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("rules");

  const isBrandManager = user?.role === "brand_manager";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Brand Kit
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          The single source of truth for your brand: numbered rules, approved facts with verification dates, and terminology.
        </p>
      </div>

      {!isBrandManager && (
        <div
          role="status"
          className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 text-sm text-amber-800 rounded-xl"
        >
          <span className="font-semibold">Note:</span>
          <span>Read-only: only the Brand Manager can change the Brand Kit.</span>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto" aria-label="Brand Kit Tabs">
          <button
            type="button"
            onClick={() => setActiveTab("rules")}
            className={`min-h-11 md:min-h-0 inline-flex items-end whitespace-nowrap px-3.5 pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "rules"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            Rules
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("facts")}
            className={`min-h-11 md:min-h-0 inline-flex items-end whitespace-nowrap px-3.5 pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "facts"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            Approved Facts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("terms")}
            className={`min-h-11 md:min-h-0 inline-flex items-end whitespace-nowrap px-3.5 pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "terms"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            Controlled Terms
          </button>
        </nav>
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === "rules" && <RulesTab isBrandManager={isBrandManager} />}
        {activeTab === "facts" && <FactsTab isBrandManager={isBrandManager} />}
        {activeTab === "terms" && <TermsTab isBrandManager={isBrandManager} />}
      </div>
    </div>
  );
}

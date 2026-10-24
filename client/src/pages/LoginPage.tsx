import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../auth/AuthContext.js";
import { Button } from "../components/Button.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { getRoleHome } from "../components/ProtectedLayout.js";

export function LoginPage() {
  const { loginDemo, login, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Cold start pre-warm: ping GET /api/health?warm=1 once on mount (fire and forget, no UI)
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || "";
    fetch(`${apiUrl}/api/health?warm=1`).catch(() => {});
  }, []);

  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemoLogin = async (role: Role) => {
    setError(null);
    setActiveRole(role);
    setSubmitting(true);
    try {
      const user = await loginDemo(role);
      navigate(getRoleHome(user.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setActiveRole(null);
      setSubmitting(false);
    }
  };

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      navigate(getRoleHome(user.role), { replace: true });
    } catch (err) {
      setError(
        err instanceof Error && err.message === "invalid_credentials"
          ? "Invalid email or password"
          : err instanceof Error
            ? err.message
            : "Failed to sign in",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-slate-50 relative">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 flex items-center justify-center">
          Vouch<span className="login-dot-animated" data-testid="login-dot">.</span>
        </h1>
        <p className="mt-1 text-base font-semibold text-slate-700 dark:text-slate-300">
          Every claim, backed by proof.
        </p>
        <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
          Vouch checks marketing content against your brand's approved facts
          and rules before it is published.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 rounded-xl sm:px-10">
          {error && (
            <div
              role="alert"
              className="mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <div className="space-y-3">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              One-click demo evaluation
            </span>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDemoLogin("creator")}
              className="w-full flex flex-col items-start p-4 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-all text-left group disabled:opacity-50 min-h-[40px] cursor-pointer"
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-slate-900 group-hover:text-blue-700">
                  Try as Creator
                </span>
                {submitting && activeRole === "creator" && (
                  <span className="text-xs text-blue-600 font-medium animate-pulse">
                    Signing in…
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 mt-1">
                Submit content and fix issues
              </span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDemoLogin("reviewer")}
              className="w-full flex flex-col items-start p-4 border border-slate-200 rounded-lg hover:border-purple-400 hover:bg-purple-50/50 transition-all text-left group disabled:opacity-50 min-h-[40px] cursor-pointer"
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-slate-900 group-hover:text-purple-700">
                  Try as Reviewer
                </span>
                {submitting && activeRole === "reviewer" && (
                  <span className="text-xs text-purple-600 font-medium animate-pulse">
                    Signing in…
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 mt-1">
                Approve or request changes
              </span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDemoLogin("brand_manager")}
              className="w-full flex flex-col items-start p-4 border border-slate-200 rounded-lg hover:border-emerald-400 hover:bg-emerald-50/50 transition-all text-left group disabled:opacity-50 min-h-[40px] cursor-pointer"
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-slate-900 group-hover:text-emerald-700">
                  Try as Brand Manager
                </span>
                {submitting && activeRole === "brand_manager" && (
                  <span className="text-xs text-emerald-600 font-medium animate-pulse">
                    Signing in…
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 mt-1">
                Manage rules, facts and terms
              </span>
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3">
              Sign in with email
            </span>

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-medium text-slate-700"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="demo.creator@aqualeaf.test"
                  disabled={submitting}
                  className="mt-1 block w-full min-h-11 px-3 py-2 border border-slate-300 rounded-md text-sm shadow-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-50"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-slate-700"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="mt-1 block w-full min-h-11 px-3 py-2 border border-slate-300 rounded-md text-sm shadow-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-50"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submitting}
                loading={submitting && activeRole === null}
                loadingText="Signing in…"
                className="w-full"
              >
                Sign in
              </Button>
            </form>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 text-center">
              Demo workspace: use the one-click buttons above. Team sign-up and invites are on the roadmap.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

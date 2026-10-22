import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const ROLE_LABELS: Record<string, { label: string; badgeClass: string }> = {
  creator: {
    label: "Creator",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200",
  },
  reviewer: {
    label: "Reviewer",
    badgeClass: "bg-purple-100 text-purple-800 border-purple-200",
  },
  brand_manager: {
    label: "Brand Manager",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
};

export function Header() {
  const { user, organization, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const roleMeta = ROLE_LABELS[user.role] ?? {
    label: user.role,
    badgeClass: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const handleSwitchRole = () => {
    navigate("/login");
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
      isActive
        ? "bg-slate-900 text-white"
        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
    }`;

  // Nav configuration per role (Requirement 6):
  // Creator: Content, Brand Kit
  // Reviewer: Reviews, Brand Kit
  // Brand Manager: Brand Kit, Reviews (read)
  const navLinks = (() => {
    if (user.role === "creator") {
      return [
        { to: "/content", label: "Content" },
        { to: "/brand-kit", label: "Brand Kit" },
      ];
    }
    if (user.role === "reviewer") {
      return [
        { to: "/reviews", label: "Reviews" },
        { to: "/brand-kit", label: "Brand Kit" },
      ];
    }
    if (user.role === "brand_manager") {
      return [
        { to: "/brand-kit", label: "Brand Kit" },
        { to: "/reviews", label: "Reviews (read)" },
      ];
    }
    return [
      { to: "/content", label: "Content" },
      { to: "/reviews", label: "Reviews" },
      { to: "/brand-kit", label: "Brand Kit" },
    ];
  })();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Vouch
            </span>
            {organization && (
              <>
                <span className="text-slate-300">/</span>
                <span className="text-sm font-medium text-slate-600">
                  {organization.name}
                </span>
              </>
            )}
          </div>

          <nav className="flex items-center gap-1.5">
            {navLinks.map((link) => (
              <NavLink key={link.to} to={link.to} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">
              {user.name}
            </span>
            <span
              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${roleMeta.badgeClass}`}
            >
              {roleMeta.label}
            </span>
          </div>

          <div className="h-4 w-px bg-slate-200" />

          <button
            onClick={handleSwitchRole}
            type="button"
            className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            Switch role
          </button>
          <button
            onClick={handleLogout}
            type="button"
            className="text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

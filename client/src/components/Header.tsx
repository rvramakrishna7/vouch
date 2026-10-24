import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { Button } from "./Button.js";
import { ThemeToggle } from "./ThemeToggle.js";

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
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;

  const roleMeta = ROLE_LABELS[user.role] ?? {
    label: user.role,
    badgeClass: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const handleSwitchRole = () => {
    setMenuOpen(false);
    navigate("/login");
  };

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate("/login");
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
      isActive
        ? "bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100"
        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
    }`;

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center min-h-11 text-base font-medium px-3 rounded-md transition-colors ${
      isActive
        ? "bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100"
        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;

  // Nav configuration per role:
  // Creator: Content, Brand Kit
  // Reviewer: Reviews, Brand Kit, Audit log
  // Brand Manager: Brand Kit, Reviews (read), Audit log
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
        { to: "/audit", label: "Audit log" },
      ];
    }
    if (user.role === "brand_manager") {
      return [
        { to: "/brand-kit", label: "Brand Kit" },
        { to: "/reviews", label: "Reviews (read)" },
        { to: "/audit", label: "Audit log" },
      ];
    }
    return [
      { to: "/content", label: "Content" },
      { to: "/reviews", label: "Reviews" },
      { to: "/brand-kit", label: "Brand Kit" },
    ];
  })();

  const roleBadge = (
    <span
      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border whitespace-nowrap ${roleMeta.badgeClass}`}
    >
      {roleMeta.label}
    </span>
  );

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 relative">
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Vouch
            </span>
            {organization && (
              <>
                <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400 hidden sm:inline truncate">
                  {organization.name}
                </span>
              </>
            )}
          </div>

          <nav className="hidden md:flex items-center gap-1.5">
            {navLinks.map((link) => (
              <NavLink key={link.to} to={link.to} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
              {user.name}
            </span>
            {roleBadge}
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          <ThemeToggle />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSwitchRole}
            type="button"
          >
            Switch role
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            type="button"
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-transparent"
          >
            Sign out
          </Button>
        </div>

        <Button
          type="button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          variant="secondary"
          size="md"
          onClick={() => setMenuOpen((o) => !o)}
          className="md:hidden"
        >
          {menuOpen ? "Hide menu" : "Menu"}
        </Button>
      </div>

      {menuOpen && (
        <div
          id="mobile-menu"
          className="md:hidden absolute left-0 right-0 top-full z-40 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg px-4 py-3 space-y-3"
        >
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
              {user.name}
            </span>
            {roleBadge}
            {organization && (
              <span className="text-xs text-slate-500 dark:text-slate-400 w-full">
                {organization.name}
              </span>
            )}
          </div>
          <div className="border-t border-slate-200 dark:border-slate-800 pt-2">
            <ThemeToggle isMobile className="w-full justify-center" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handleSwitchRole}
              type="button"
              className="w-full"
            >
              Switch role
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={handleLogout}
              type="button"
              className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            >
              Sign out
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

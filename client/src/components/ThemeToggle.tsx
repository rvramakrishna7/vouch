import { useTheme } from "../hooks/useTheme.js";
import { Button } from "./Button.js";

export function ThemeToggle({
  className,
  isMobile,
}: {
  className?: string;
  isMobile?: boolean;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size={isMobile ? "md" : "sm"}
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className={`flex items-center gap-2 ${className || ""}`}
    >
      {theme === "dark" ? (
        <>
          <svg
            className="w-4 h-4 text-amber-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          <span className="text-xs font-medium text-slate-200">Light theme</span>
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4 text-slate-600 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
            />
          </svg>
          <span className="text-xs font-medium text-slate-700">Dark theme</span>
        </>
      )}
    </Button>
  );
}

import React from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "outline";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-800 border-slate-900 shadow-sm disabled:bg-slate-700 dark:bg-emerald-700 dark:text-white dark:hover:bg-emerald-800 dark:border-emerald-700 dark:disabled:bg-emerald-900",
  secondary:
    "bg-white text-slate-700 hover:bg-slate-50 border-slate-200 shadow-sm hover:text-slate-900 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:border-slate-700 dark:hover:text-white",
  danger:
    "bg-red-600 text-white hover:bg-red-700 border-red-600 shadow-sm disabled:bg-red-400 dark:bg-red-600 dark:text-white dark:hover:bg-red-700 dark:border-red-600",
  ghost:
    "bg-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-transparent dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800",
  outline:
    "bg-transparent text-slate-700 hover:bg-slate-50 border-slate-300 shadow-sm dark:text-slate-200 dark:hover:bg-slate-800 dark:border-slate-600",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-xs rounded-lg min-h-[40px]",
  md: "px-4 py-2 text-sm rounded-lg min-h-[40px]",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      loading = false,
      loadingText,
      icon,
      className = "",
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const base =
      "inline-flex items-center justify-center gap-2 font-semibold border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap active:scale-[0.99]";

    const vClass = variantClasses[variant] || variantClasses.secondary;
    const sClass = sizeClasses[size] || sizeClasses.md;

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${vClass} ${sClass} ${className}`.trim()}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin -ml-0.5 h-3.5 w-3.5 text-current shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>{loadingText || children}</span>
          </>
        ) : (
          <>
            {icon && <span className="shrink-0">{icon}</span>}
            {children}
          </>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";

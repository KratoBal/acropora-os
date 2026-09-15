import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
}

const variants = {
  primary: "bg-dusk-900 text-white shadow-sm hover:bg-dusk-800",
  secondary:
    "border border-dusk-200 bg-white text-dusk-700 shadow-sm hover:bg-dusk-50",
  ghost: "text-dusk-600 hover:bg-dusk-100 hover:text-dusk-900",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
};

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
  icon: "size-9",
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

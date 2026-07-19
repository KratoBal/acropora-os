import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  icon?: ReactNode;
  label: string;
  badge?: ReactNode;
}

export function NavItem({
  active = false,
  badge,
  className,
  icon,
  label,
  ...props
}: NavItemProps) {
  return (
    <a
      className={cn(
        "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/80"
          : "text-slate-600 hover:bg-white/70 hover:text-slate-950",
        className,
      )}
      aria-current={active ? "page" : undefined}
      {...props}
    >
      {icon ? (
        <span
          className={cn(
            "text-slate-400 transition-colors group-hover:text-slate-600",
            active && "text-teal-700",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </a>
  );
}

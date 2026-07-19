import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  brand: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function Sidebar({
  brand,
  children,
  className,
  footer,
  ...props
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-slate-50/95 lg:flex",
        className,
      )}
      {...props}
    >
      <div className="flex h-16 shrink-0 items-center px-5">{brand}</div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">{children}</nav>
      {footer ? (
        <div className="shrink-0 border-t border-slate-200 p-3">{footer}</div>
      ) : null}
    </aside>
  );
}

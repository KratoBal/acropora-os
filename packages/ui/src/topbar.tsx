import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface TopbarProps extends HTMLAttributes<HTMLElement> {
  leading?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
}

export function Topbar({
  actions,
  className,
  leading,
  search,
  ...props
}: TopbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md sm:px-6 lg:px-8",
        className,
      )}
      {...props}
    >
      {leading}
      <div className="min-w-0 flex-1">{search}</div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

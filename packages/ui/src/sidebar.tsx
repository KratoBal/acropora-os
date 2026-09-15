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
        // A SOTET OLDALSAV a prototipus kulsejenek a magja (`--nav`, #292346).
        // Keret nincs rajta: sotet savot vilagos lapon nem elvalasztani kell,
        // hanem a kontraszt mar elvalasztja -- egy vonal csak zajt adna hozza.
        "fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-nav text-white lg:flex",
        className,
      )}
      {...props}
    >
      <div className="flex h-16 shrink-0 items-center px-5">{brand}</div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">{children}</nav>
      {footer ? (
        <div className="shrink-0 border-t border-white/10 p-3">{footer}</div>
      ) : null}
    </aside>
  );
}

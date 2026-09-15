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
        // A MENU A SOTET OLDALSAVBAN AL, tehat a szinek ODA szolnak: a
        // `slate-*` rampa vilagos lapra keszult, es sotet alapon a halvany
        // fokozatai olvashatatlanok. Az aktiv sor a prototipus vilagosabb
        // lilaja, nem feher lap -- feher hattertol a menu ket kulon savra
        // esne szet.
        "group flex h-9 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors",
        active
          ? "bg-nav-active text-white shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
          : "text-nav-muted hover:bg-white/5 hover:text-white",
        className,
      )}
      aria-current={active ? "page" : undefined}
      {...props}
    >
      {icon ? (
        <span
          className={cn(
            "text-white/55 transition-colors group-hover:text-white/85",
            active && "text-white",
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

import type { HTMLAttributes } from "react";

import { Button } from "./button";
import { cn } from "./utils";

export interface PaginationProps extends HTMLAttributes<HTMLElement> {
  page: number;
  totalPages: number;
  onPageChange(page: number): void;
  /**
   * HOL ÁLL A LAPOZÓ. Balázs kérése, 2026-09-23 (kanban b1ed1088): a lapozó
   * gomb kerüljön a lista TETEJÉRE IS, az alja mellett -- nem helyette.
   *
   * `"bottom"` (alapértelmezett, visszafelé kompatibilis): a lista alatti,
   * teljes szélességű, elválasztó vonalas doboz -- ugyanaz, ami eddig is
   * itt állt.
   *
   * `"top"`: keret és elválasztó NÉLKÜLI, szűkebb megjelenés, hogy
   * beleférjen egy meglévő szűrő-sorba (pl. az oldalméret-választó mellé,
   * EGY sorban -- ne két külön sávban). A hívó felelőssége, hogy a "top"
   * változatot a saját sorába illessze; ez a komponens csak a saját
   * dobozát/elválasztóját hagyja el, elrendezést nem kényszerít rá.
   */
  position?: "top" | "bottom";
}

export function Pagination({
  className,
  onPageChange,
  page,
  totalPages,
  position = "bottom",
  ...props
}: PaginationProps) {
  const safeTotal = Math.max(1, totalPages);
  return (
    <nav
      aria-label={position === "top" ? "Lapozás, felül" : "Lapozás, alul"}
      className={cn(
        "flex items-center gap-3",
        position === "bottom"
          ? "justify-center border-t border-dusk-200 px-5 py-4 sm:justify-end"
          : "justify-end",
        className,
      )}
      {...props}
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Előző
      </Button>
      <span className="min-w-24 text-center text-sm text-dusk-600">
        {page}. / {safeTotal} oldal
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= safeTotal}
        onClick={() => onPageChange(page + 1)}
      >
        Következő
      </Button>
    </nav>
  );
}

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
  /**
   * MELYIK LISTA SAJÁT TERVE, NE EGY ÁLTALÁNOS "APP-MINTA" -- acrobot
   * döntése (2026-09-25), Balázs mércéje szerint ("minden ami a tervben
   * van"): a webes lista-lapozók a tervben KÉT, EGYMÁSNAK ELLENTMONDÓ
   * mintát adnak (lásd a két konkrét forrást lent), tehát ez a komponens
   * mindkettőt PROPKÉNT hordozza, nem külön másolatként.
   *
   * `"prevNext"` (alapértelmezett, visszafelé kompatibilis): a korábbi,
   * "Előző"/"Következő" gombos + "X. / Y oldal" szöveges forma -- minden
   * más lista (amelyiknek nincs saját, ettől eltérő terve) ezt kapja
   * változatlanul.
   *
   * `"numberedGrey"`: `exchange/figma-telefon-make-12/src/EszközScreen.tsx`
   * 439-447. sor (web Eszköz lista) -- CSAK számozott gombok, nyilak
   * nélkül, aktív oldal sötét (`dusk-900`) háttérrel, fehér szöveggel.
   *
   * `"numberedTeal"`: `exchange/figma-partnerek-make-13/src/
   * PartnersScreen.tsx` 653-663. sor (web Partner lista) -- `‹ Előző`/
   * `Következő ›` szöveges gomb A számozott gombok mellett, aktív oldal
   * teal háttérrel.
   *
   * Egyik minta sem old meg nagy oldalszámnál "..." kihagyást -- a terv
   * maga sem ismeri ezt az esetet (a mintaadat kevés oldalt ad), ezért ez
   * a komponens sem talál ki ilyet.
   */
  variant?: "prevNext" | "numberedGrey" | "numberedTeal";
}

export function Pagination({
  className,
  onPageChange,
  page,
  totalPages,
  position = "bottom",
  variant = "prevNext",
  ...props
}: PaginationProps) {
  const safeTotal = Math.max(1, totalPages);
  const pageNumbers = Array.from({ length: safeTotal }, (_, i) => i + 1);

  return (
    <nav
      aria-label={position === "top" ? "Lapozás, felül" : "Lapozás, alul"}
      className={cn(
        "flex items-center gap-1",
        position === "bottom"
          ? "justify-center border-t border-dusk-200 px-5 py-4 sm:justify-end"
          : "justify-end",
        className,
      )}
      {...props}
    >
      {variant === "prevNext" ? (
        <>
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
        </>
      ) : null}

      {variant === "numberedGrey"
        ? pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={cn(
                "h-7 w-7 cursor-pointer rounded text-xs font-medium transition-colors",
                pageNumber === page
                  ? "bg-dusk-900 text-white"
                  : "text-dusk-500 hover:bg-dusk-100",
              )}
            >
              {pageNumber}
            </button>
          ))
        : null}

      {variant === "numberedTeal" ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ‹ Előző
          </Button>
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={cn(
                "h-7 w-7 cursor-pointer rounded text-xs font-medium transition-colors",
                pageNumber === page
                  ? "bg-pilot-aqua-600 text-white"
                  : "text-pilot-grey-600 hover:bg-pilot-grey-100",
              )}
            >
              {pageNumber}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= safeTotal}
            onClick={() => onPageChange(page + 1)}
          >
            Következő ›
          </Button>
        </>
      ) : null}
    </nav>
  );
}

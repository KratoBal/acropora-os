import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

/**
 * AZ EGYETLEN OLDALFEJLÉC (UI 1. kör, 2. csomag, 2026-11-03). A Figma
 * „Direction F” kereteiből mérve (Beszerzés, Számlázás, Termékek): cím 28/34,
 * 600-as súly, -0,3 px betűköz, #0F1A1C; leírás 14 px, #4F5A68; felülcím
 * 11 px, 600, 0,5 px betűköz, a meleg kiemelés (#A2491A, a keretekben ez az
 * egyetlen felülcím-szín). A stage-söprés négy változatot talált (sötétkék
 * DM Sans, a fehér sáv kis címmel, a 20 px-es cím, és háromféle színű
 * felülcím); a `PilotPageHeader`, a `ServiceListHeader` és a
 * `ServiceDetailHeader` innentől ezt rajzolja, tehát egy oldal nem tud
 * eltérni attól, hogy másik komponenst választ.
 */
export const PAGE_HEADER_CLASSES = {
  root: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
  eyebrow:
    "mb-1.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.05em] text-pilot-accent-warm-text",
  title:
    "text-[28px] font-semibold leading-[34px] tracking-[-0.3px] text-pilot-grey-900",
  description: "mt-2 max-w-2xl text-sm leading-5 text-pilot-grey-600",
  meta: "mt-2 flex flex-wrap items-center gap-2",
  // tördel, hogy egy több gombos sor telefonon se lógjon ki (UI 1. csomag: az UNAS termékszinkron 443 px volt 390-en)
  actions: "flex shrink-0 flex-wrap items-center gap-2",
} as const;

export interface PageHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  title: string;
  description?: string;
  eyebrow?: string;
  /** A cím alatti sor, pl. az eredet és az állapot jelvénye. */
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  meta,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header className={cn(PAGE_HEADER_CLASSES.root, className)} {...props}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className={PAGE_HEADER_CLASSES.eyebrow}>{eyebrow}</p>
        ) : null}
        <h1 className={PAGE_HEADER_CLASSES.title}>{title}</h1>
        {description ? (
          <p className={PAGE_HEADER_CLASSES.description}>{description}</p>
        ) : null}
        {meta ? <div className={PAGE_HEADER_CLASSES.meta}>{meta}</div> : null}
      </div>
      {actions ? (
        <div className={PAGE_HEADER_CLASSES.actions}>{actions}</div>
      ) : null}
    </header>
  );
}

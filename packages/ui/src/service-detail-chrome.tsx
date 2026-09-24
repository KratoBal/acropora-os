"use client";

import type { ReactNode } from "react";

import { ServiceIcon, type ServiceIconName } from "./service-list-chrome";
import { sv } from "./service-theme";

/**
 * A SZERVIZ ADATLAPOK KOZOS DARABJAI, Balazs 2026-09-15-i designjabol.
 *
 * ATKOLTOZOTT IDE `apps/web/src/components/service/` alol, 2026-09-24
 * (partner hibajegy-lapok arculati parositasa, lasd `service-theme.ts` fejleceben
 * a reszletet). Az `apps/web` sajat fajlja innentol csak ujraexportal, a kod
 * valtozatlan.
 *
 * A `ServiceBackLink` SZANDEKOSAN NEM KOLTOZOTT IDE, es ez a fajl kivetele az
 * elozo bekezdes alol. Az eredetije `next/link`-et hasznal, a `@acropora/ui`
 * viszont keretfuggetlen (lasd `nav-item.tsx`: sima `<a>`-t ad, nem
 * `next/link`-et) -- `next` MA nincs a csomag fuggosegei kozott, es felvetele
 * csak ezert az egy komponensert rossz csere lenne. Mindket alkalmazasnak MAR
 * VAN sajat `next` fuggosege, tehat a vissza-hivatkozas HELYBEN, a hivo
 * oldalan kap sajat, apro peldanyt -- ugyanugy, ahogy az `apps/partner`
 * `asset-detail.tsx` sajat `VisszaLink()`-je is helyben all, pontosan ugyanezen
 * okbol.
 */

export function ServiceDetailHeader({
  eyebrow,
  title,
  badge,
  sub,
  actions,
}: {
  /** A sorszam vagy az allapot neve -- a CIM folott, kis nagybetus sorban. */
  eyebrow: string;
  /** A munka TARGYA, nem az azonositoja. */
  title: string;
  badge?: ReactNode;
  /** A cim alatti egy sor: partner, helyszin, ami a tajekozodashoz kell. */
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <p className={sv.eyebrow}>{eyebrow}</p>
        <h1 className={sv.detailTitle}>{title}</h1>
        {badge || sub ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {badge}
            {sub ? <span className="text-xs text-muted">{sub}</span> : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** A feher, keretes doboz. Belso margoval, mert az adatlapon minden panel kap. */
export function ServicePanel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${sv.panel} p-[22px] ${className}`}>
      {children}
    </section>
  );
}

export function ServicePanelHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-[18px] flex items-center justify-between gap-3">
      <h2 className="text-[16px] font-bold text-ink">{title}</h2>
      {action ?? null}
    </div>
  );
}

/**
 * EGY ADAT A PANEL OLDALAN: ikon, halvany cimke, alatta az ertek.
 *
 * A prototipus a jobb oldali oszlopban ezt hasznalja a `dl` helyett, es az
 * ikon nem dekoracio: a jobb hasab sorai kulonbozo dolgokrol szolnak (partner,
 * hely, ember, kapcsolodo lap), es az ikon az, ami vegigfutas nelkul
 * megkulonbozteti oket.
 */
export function ServiceContextRow({
  icon,
  label,
  children,
}: {
  icon: ServiceIconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line py-[15px] last:border-0 last:pb-0">
      <ServiceIcon name={icon} className="size-[18px] text-[#8679aa]" />
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-[11px] text-muted">{label}</span>
        <span className="block text-xs font-medium text-ink">{children}</span>
      </div>
    </div>
  );
}

/** A muszaki adatok ketoszlopos racsa (`dl`), a prototipus `.data-grid`-je. */
export function ServiceDataGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-7 gap-y-[22px] sm:grid-cols-2">{children}</dl>
  );
}

export function ServiceDataItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1.5 text-[11px] text-muted">{label}</dt>
      <dd className="m-0 text-[13px] leading-[1.5] text-ink">{children}</dd>
    </div>
  );
}

/**
 * A KIEMELT PANEL: levendula hatteren a kovetkezo lepes.
 *
 * Azert van sajat alakja, mert a lapon tobb panel all egymas alatt, es kozuluk
 * EGY olyan, amiben teendo van. Ha ugyanugy nez ki, mint a tobbi, akkor a
 * teendo egy adat-panellel egyenrangu -- es epp az a kerdes, amiert valaki
 * megnyitotta a lapot.
 */
export function ServiceNextAction({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#ded4f5] bg-brand-100 p-[22px]">
      <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.17em] text-brand-700">
        {eyebrow}
      </p>
      <h2 className="text-[16px] font-bold text-ink">{title}</h2>
      {children ? (
        <p className="my-2 mb-4 text-xs leading-relaxed text-brand-muted">
          {children}
        </p>
      ) : null}
      {action ?? null}
    </section>
  );
}

/** Az adatlap ket hasabja: a tartalom es a mellette allo oszlop. */
export function ServiceDetailSplit({
  main,
  side,
}: {
  main: ReactNode;
  side: ReactNode;
}) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_288px]">
      <div className="flex flex-col gap-5">{main}</div>
      <div className="flex flex-col gap-5">{side}</div>
    </div>
  );
}

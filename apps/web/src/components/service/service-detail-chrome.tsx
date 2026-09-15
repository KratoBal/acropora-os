"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ServiceIcon, type ServiceIconName } from "./service-list-chrome";
import { sv } from "./service-theme";

/**
 * A SZERVIZ ADATLAPOK KOZOS DARABJAI, Balazs 2026-09-15-i designjabol.
 *
 * Ugyanaz a hatarozas all rajtuk, mint a lista-darabokon: itt vannak, es nem a
 * `packages/ui`-ban, mert ma a szerviz nezetei hasznaljak oket. Ha egy darab
 * masodik modulban is kell, ODA kerul at -- de akkor tudatosan, nem azert,
 * mert veletlenul ott kezdodott.
 *
 * A SZINEK A KOZOS TOKENEKBOL JONNEK (`ink`, `muted`, `line`, `brand-*`), nem
 * kezzel irt ertekekbol: az arculat 2026-09-15-i beolvasztasa ota azok az
 * igazsag-forras, es egy ide masolt hexa MASODIK forras lenne ugyanarra a
 * szinre -- ha a tokenben modosul a lila, ez a fajl nem kovetne, es senki nem
 * szolna rola.
 *
 * NEGY ERTEK MEGIS NYERSEN ALL a szerviz ket uj fajljaban, es ez szandekos: a
 * prototipus hasznal nehany KOZBENSO arnyalatot (`#8679aa` az adat-ikonokra,
 * `#ded4f5` es `#635578` a kiemelt panelen, `#555062` a leiro szovegen),
 * amikhez ma nincs token. Egy "majdnem ugyanaz" megfeleltetes csendben
 * megvaltoztatna a szint, es a diffbol nem latszana, hogy az dontes volt.
 */

/**
 * A VISSZA-HIVATKOZAS AZ ADATLAP FOLOTT, nem a muveletek kozott.
 *
 * A prototipus szandekosan valasztja szet a kettot: a "vissza" NEM muvelet a
 * lapon, hanem kilepes belole. Gombkent, a "Lezaras" es a "Szerkesztes"
 * mellett allva ugyanolyan sulyunak latszik, mint azok -- pedig az egyetlen,
 * ami nem valtoztat semmin.
 */
export function ServiceBackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="mb-[18px] inline-flex items-center gap-[7px] text-xs text-muted hover:text-brand-700"
    >
      <ServiceIcon name="arrowLeft" className="size-4" />
      {children}
    </Link>
  );
}

export function ServiceDetailHeader({
  eyebrow,
  title,
  badge,
  sub,
  lead,
  actions,
}: {
  /** A sorszam vagy az allapot neve -- a CIM folott, kis nagybetus sorban. */
  eyebrow: string;
  /** A munka TARGYA, nem az azonositoja. */
  title: string;
  badge?: ReactNode;
  /** A cim alatti egy sor: partner, helyszin, ami a tajekozodashoz kell. */
  sub?: ReactNode;
  /**
   * EGY MONDAT A CIM ALATT, es NEM ugyanaz, mint a `sub`.
   *
   * A `sub` AZONOSIT (melyik partner, milyen allapot) -- egy sorban all a
   * jelvennyel, es rovid. Ez MAGYARAZ: az urlapok itt mondjak ki, mi tortenik
   * mentesnel. A kettot egy mezobe vonva az azonosito adat es a magyarazo
   * mondat egymas melle kerulne, es a sor ket kulonbozo dolgot allitana.
   */
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <p className={sv.eyebrow}>{eyebrow}</p>
        <h1 className="max-w-[700px] text-[29px] font-extrabold leading-[1.25] tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {badge || sub ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {badge}
            {sub ? <span className="text-xs text-muted">{sub}</span> : null}
          </div>
        ) : null}
        {lead ? (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
            {lead}
          </p>
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
        <p className="my-2 mb-4 text-xs leading-relaxed text-[#635578]">
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

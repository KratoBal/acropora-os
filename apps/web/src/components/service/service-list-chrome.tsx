"use client";

import type { ReactNode } from "react";

import { sv, serviceToneClass, type ServiceTone } from "./service-theme";

/**
 * A SZERVIZ LISTA-OLDALAK KOZOS DARABJAI, Balazs 2026-09-15-i designjabol.
 *
 * Miert itt es nem a `packages/ui`-ban: ezek a darabok ma a szerviz uj
 * arculatat hordozzak, ami az alkalmazas tobbi reszen MEG NEM all. A kozos
 * csomagba tett valtozat azonnal megvaltoztatna otven olyan lap kulsejet, ami
 * nem tartozik ehhez a korhoz. Ha az arculat alkalmazas-szinten landol, ezek
 * felmennek a kozos csomagba -- addig a szerviz sajat lapjai hasznaljak.
 */

/** A prototipus ikonjai, ugyanazokkal az utvonalakkal. */
const iconPaths = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="m15 4 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m7 12 3 3 7-7" />
    </>
  ),
  box: <path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7 5l10 6" />,
  wrench: (
    <path d="M21 7a6 6 0 0 1-8 6L6 20a2 2 0 0 1-3-3l7-7a6 6 0 0 1 7-8l-4 4 4 4z" />
  ),
  building: (
    <path d="M5 21V3h14v18M2 21h20M9 7h1m4 0h1M9 11h1m4 0h1m-6 4h1m4 0h1M10 21v-3h4v3" />
  ),
  location: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  arrowLeft: <path d="M20 12H4m6-6-6 6 6 6" />,
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m2 11v-3a6 6 0 0 0-2-4" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4z" />
      <path d="M8 5v3m0 3v2m0 3v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  sheet: (
    <>
      <path d="M14 3H5v18h14V8z" />
      <path d="M14 3v5h5M8 12h8m-8 4h6" />
    </>
  ),
} as const;

export type ServiceIconName = keyof typeof iconPaths;

export function ServiceIcon({
  name,
  className = "size-5",
}: {
  name: ServiceIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {iconPaths[name]}
    </svg>
  );
}

/**
 * A PROTOTIPUS ALLAPOT-PIRULAJA: szines hatter + egy pont a szoveg elott.
 *
 * A pont nem dekoracio: a hat arnyalatbol ketto (amber es red) hasonlo
 * vilagossagu, es a pont adja a masodik jelet. A cimke szovege TOVABBRA is a
 * meglevo `*-labels.ts` fajlokbol jon, ez a komponens csak megjelenit.
 */
export function ServiceStatusBadge({
  tone,
  children,
}: {
  tone: ServiceTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-[5px] text-[11px] font-semibold leading-tight ${serviceToneClass[tone]}`}
    >
      <span
        aria-hidden="true"
        className="size-[5px] shrink-0 rounded-full bg-current"
      />
      {children}
    </span>
  );
}

export function ServiceListHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
      <div>
        <p className={sv.eyebrow}>{eyebrow}</p>
        <h1 className={sv.pageTitle}>{title}</h1>
        <p className={sv.pageLead}>{lead}</p>
      </div>
      {action ?? null}
    </header>
  );
}

export interface ServiceListTab {
  key: string;
  label: string;
}

export function ServiceListTabs({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: ServiceListTab[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  return (
    <div className={sv.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(tab.key)}
            className={`${sv.tab} ${on ? sv.tabActive : ""}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A LISTA LABLECE: hany talalat van, es hogy a lista VEGE-e ez.
 *
 * A prototipus itt mindig azt irja, hogy "A lista vegere ertel". Nalunk a
 * lista LAPOZOTT, tehat ez csak az utolso lapon igaz -- a kozbenso lapokon
 * hazugsag lenne, es epp azt a kerdest hagyna megvalaszolatlanul, amiert
 * valaki a lap aljara nez. Ezert all itt a lapszam helyette.
 */
export function ServiceListFooter({
  shown,
  totalItems,
  page,
  totalPages,
}: {
  shown: number;
  totalItems: number;
  page: number;
  totalPages: number;
}) {
  return (
    <div className={sv.tableFooter}>
      <span>
        {totalItems} találat
        {totalItems > shown ? `, ebből ${shown} ezen a lapon` : ""}
      </span>
      <span>
        {totalPages <= 1
          ? "A lista végére értél"
          : `${page} / ${totalPages}. lap`}
      </span>
    </div>
  );
}

export function ServiceSearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={sv.search}>
      <ServiceIcon name="search" className="size-[17px] text-[#686477]" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        className={sv.searchInput}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

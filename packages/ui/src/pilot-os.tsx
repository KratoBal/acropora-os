"use client";
import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";

import type { ThumbnailFallback } from "./entity-thumbnail-fallback";
import { Icon } from "./icon";

/**
 * ACROPORA OS, DIRECTION F: A KÖZÖS ÉPÍTŐELEMEK (Balázs briefje, 2026-09-30,
 * Figma `ji64fTFss0jqm5Uifd0zhE`, 273:33 Termékek lista és 273:34 adatlap).
 *
 * A brief 8. pontja szerint nem a Termékek oldalba égetett Figma-másolat,
 * hanem újrahasználható elemek, mert a többi OS oldal (elsőként a Beszerzés,
 * amelynek terve már kész ugyanebben a fájlban) ugyanezekből épül. A
 * meglévő `pilot-*` tokenekre épülnek (az aqua és a szürke skála betűre
 * egyezik a Direction F változóival), plusz a `pilot-accent-warm-*` és a
 * `pilot-green-*` párra (`figma-theme.css`).
 *
 * A MÉRETEK A NODE-FÁBÓL JÖNNEK, NEM A KÉPRŐL: kártya-sugár 16, a fejlécben
 * 3×22-es, 1,5-ös sugarú narancs sín a kártya bal szélén, cím 14/600,
 * alcím 12/400; táblázatfejléc 42 magas, 11/600, 0,5-ös betűköz, nagybetű;
 * sor 72 magas; thumbnail 40×40, sugár 8.
 */

/** Egy kártya a Direction F adatlapon: cím, alcím, művelet, meleg sín. */
export function PilotSection({
  title,
  subtitle,
  action,
  accent = true,
  tone = "default",
  children,
  bodyClassName = "px-5 py-5",
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** A narancs sín a cím előtt. Alapból van: a terv minden kártyán rajzolja. */
  accent?: boolean;
  /**
   * `warm`: a halvány meleg háttér (a terv szerint a belső megjegyzés
   * kártyáján). Nem állapot, csak hangsúly.
   */
  tone?: "default" | "warm";
  children?: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-pilot-grey-200 ${
        tone === "warm" ? "bg-pilot-accent-warm-soft" : "bg-white"
      } ${className}`}
    >
      <header className="relative flex items-start justify-between gap-3 border-b border-pilot-grey-200 px-5 pb-4 pt-[18px]">
        {accent ? (
          <span
            aria-hidden="true"
            data-testid="pilot-section-accent"
            className="absolute left-0 top-4 h-[22px] w-[3px] rounded-[1.5px] bg-pilot-accent-warm"
          />
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-5 text-pilot-grey-900">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-4 text-pilot-grey-500">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children !== undefined ? (
        <div className={bodyClassName}>{children}</div>
      ) : null}
    </section>
  );
}

/**
 * Címke-érték párok rácsa (`dl`). A hiányzó érték "—": egy üres cella nem
 * mondja meg, hogy nincs adat, vagy a lap nem töltött be.
 */
export function PilotDataGrid({
  columns = 2,
  children,
}: {
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const layout = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  }[columns];
  return <dl className={`grid gap-x-6 gap-y-5 ${layout}`}>{children}</dl>;
}

export function PilotDataItem({
  label,
  children,
  hint,
  mono = false,
}: {
  label: string;
  children?: ReactNode;
  /** Egy sor a mező alatt, ha az érték magyarázatra szorul. */
  hint?: ReactNode;
  mono?: boolean;
}) {
  const empty =
    children === null ||
    children === undefined ||
    (typeof children === "string" && children.trim() === "");
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-4 text-pilot-grey-500">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm font-semibold leading-5 text-pilot-grey-900 ${
          mono ? "font-mono" : ""
        }`}
      >
        {empty ? "—" : children}
      </dd>
      {hint ? (
        <p className="mt-1 text-[11px] leading-4 text-pilot-grey-500">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A SOR KÉPE, VAGY A TARTALÉKA (`thumbnailFallback`): kategória-ikon,
 * márka-monogram, és csak a végén a generikus csomag. Visszafogott, ERP-
 * jellegű (a brief 4. pontja), nem webshopos termékkártya.
 */
export function PilotThumbnail({
  src,
  alt = "",
  fallback,
  size = 40,
}: {
  src?: string | null;
  alt?: string;
  fallback: ThumbnailFallback;
  size?: number;
}) {
  const box = { width: size, height: size };
  // A törött kép (hibás URL, elérhetetlen kiszolgáló) a tartalékra esik
  // vissza, nem marad üres négyzet: a sorrend kép, kategória, márka.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc)
    return (
      // a külső termékkép URL-je, nem a Next képoptimalizálón át
      <img
        src={src}
        alt={alt}
        style={box}
        onError={() => setFailedSrc(src)}
        className="shrink-0 rounded-lg border border-pilot-grey-200 bg-white object-cover"
      />
    );
  return (
    <span
      style={box}
      data-thumbnail-fallback={fallback.kind}
      className="flex shrink-0 items-center justify-center rounded-lg bg-pilot-grey-100 text-pilot-grey-500"
    >
      {fallback.kind === "monogram" ? (
        <span className="text-[11px] font-semibold tracking-[0.02em] text-pilot-grey-600">
          {fallback.text}
        </span>
      ) : (
        <Icon
          name={fallback.kind === "icon" ? fallback.icon : "package"}
          size={Math.round(size * 0.45)}
        />
      )}
    </span>
  );
}

/** Egy oszlop a közös rácsban: a fejléc ÉS a cella ugyanebből épül. */
export interface PilotTableColumn<Row> {
  id: string;
  header: ReactNode;
  /** CSS szélesség a `<col>`-on (px, %, vagy üresen: a maradék hely). */
  width?: string;
  /** Számoszlop: jobbra zárva a fejléc ÉS az adat is. */
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
}

/**
 * A KÖZÖS TÁBLÁZAT-RÁCS (a brief 5. pontja: "a header és a data row
 * ugyanazt az oszloprácsot használja", "ne legyen kézzel egymástól
 * függetlenül pozicionált header/data grid").
 *
 * Valódi `<table>`, `table-fixed` elrendezéssel és `<colgroup>`-pal: a
 * szélességet és az igazítást EGY oszlopdefiníció adja a fejlécnek és a
 * celláknak is, tehát a kettő nem tud elcsúszni egymáshoz képest. A Figma
 * rácsa abszolút pozíciókból áll; ezt szándékosan nem követi, csak a
 * méreteit.
 */
export function PilotDataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowActivate,
  rowLabel,
  rowClassName,
  minWidth = 960,
}: {
  columns: readonly PilotTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Egy sor kiemelése (például az elavult rendelésé); a hover és a fókusz megmarad. */
  rowClassName?: (row: Row) => string;
  /** A sor kattintásra és Enter/Szóköz billentyűre is ezt hívja. */
  onRowActivate?: (row: Row) => void;
  /** A sor akadálymentes neve, ha a sor kattintható. */
  rowLabel?: (row: Row) => string;
  minWidth?: number;
}) {
  const alignClass = (align: PilotTableColumn<Row>["align"]) =>
    align === "right" ? "text-right" : "text-left";
  const onKeyDown = (row: Row) => (event: KeyboardEvent) => {
    if (!onRowActivate) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowActivate(row);
    }
  };
  return (
    <div className="overflow-x-auto">
      <table
        style={{ minWidth }}
        className="w-full table-fixed border-collapse text-left"
      >
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.id}
              style={column.width ? { width: column.width } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-pilot-grey-100">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={`h-[42px] px-4 text-[11px] font-semibold uppercase leading-4 tracking-[0.05em] text-pilot-grey-500 first:pl-5 last:pr-5 ${alignClass(column.align)}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-pilot-grey-200">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              tabIndex={onRowActivate ? 0 : undefined}
              aria-label={onRowActivate && rowLabel ? rowLabel(row) : undefined}
              onClick={onRowActivate ? () => onRowActivate(row) : undefined}
              onKeyDown={onRowActivate ? onKeyDown(row) : undefined}
              className={`${
                onRowActivate
                  ? "h-[72px] cursor-pointer bg-white transition-colors hover:bg-pilot-grey-50 focus:bg-pilot-grey-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pilot-aqua-600"
                  : "h-[72px] bg-white"
              } ${rowClassName?.(row) ?? ""}`}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={`px-4 py-3 align-middle text-sm first:pl-5 last:pr-5 ${alignClass(column.align)}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * AZ ADATLAP PÁROS SORAI (a brief 6. pontja): a jobb oldal nem egy
 * függetlenül lefelé csúszó oszlop, hanem minden bal kártyának van egy
 * párja ugyanabban a sorban, közös kezdőponttal. Egy közös rács, soronként
 * két cellával; ami után nem áll pár, az a bal oszlopban marad.
 *
 * Szűkebb képernyőn (a `xl` alatt) egy oszlopba törik, a pár a sajátja
 * alá kerül: így az olvasási sorrend a párt együtt tartja.
 */
export function PilotPairedRows({
  rows,
  sideWidth = 352,
}: {
  rows: ReadonlyArray<{ id: string; main: ReactNode; side?: ReactNode }>;
  sideWidth?: number;
}) {
  return (
    <div
      className="grid items-start gap-6 xl:[grid-template-columns:minmax(0,1fr)_var(--pilot-side)]"
      style={{ ["--pilot-side" as string]: `${sideWidth}px` }}
    >
      {rows.map((row) => [
        <div key={`${row.id}-main`} className="min-w-0 xl:col-start-1">
          {row.main}
        </div>,
        row.side ? (
          <div key={`${row.id}-side`} className="min-w-0 xl:col-start-2">
            {row.side}
          </div>
        ) : null,
      ])}
    </div>
  );
}

/**
 * A LAP FEJLÉCE: felülcím (az adatlapon az SKU, meleg szöveggel), cím 28/34,
 * leírás, alatta opcionális jelvény-sor, jobbra a művelet.
 */
export function PilotPageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /** A cím alatti sor, pl. az eredet és az állapot jelvénye. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.05em] text-pilot-accent-warm-text">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.3px] text-pilot-grey-900">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-5 text-pilot-grey-600">
            {description}
          </p>
        ) : null}
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/**
 * A SZÍNEZETT CALLOUT (Beszerzés-brief, 2026-09-30, 8., 11. és 16. pont): a
 * színt a SZÜLŐ adja, a belső szöveg-tartó átlátszó. A Figma QA-ban két
 * helyen fehér csík maradt a leírás mögött, mert egy belső elem saját fehér
 * hátteret kapott; itt egyetlen elem sem kap hátteret a keret alatt.
 *
 * `warm`: import / ellenőrzendő terület (narancs, nem hiba). `aqua`:
 * hasznos működési kontextus (pl. a projektkészlet). A jobb oldali rész
 * (`action`) nem zsugorodik, a szöveg rugalmas és tördel.
 */
export function PilotCallout({
  tone,
  title,
  description,
  action,
  children,
}: {
  tone: "warm" | "aqua";
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const palette =
    tone === "warm"
      ? {
          box: "border border-pilot-accent-warm bg-pilot-accent-warm-soft",
          title: "text-pilot-grey-900",
          text: "text-pilot-accent-warm-text",
        }
      : {
          box: "bg-pilot-aqua-50",
          title: "text-pilot-aqua-700",
          text: "text-pilot-grey-600",
        };
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${palette.box}`}
    >
      <div className="min-w-0 flex-1 bg-transparent">
        <h3 className={`text-sm font-semibold leading-5 ${palette.title}`}>
          {title}
        </h3>
        {description ? (
          <p className={`mt-1 text-xs leading-5 ${palette.text}`}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {action}
        </div>
      ) : null}
    </section>
  );
}

/**
 * LINKFÜLEK EGY MODUL TESTVÉR-OLDALAIHOZ (a Beszerzés lista teteje:
 * Beszerzések, Várható beérkezések, NAV számla lekérés). Navigáció, nem
 * állapot: minden fül egy valódi útvonal, az aktív `aria-current="page"`.
 * A hívó adja a linket (`renderLink`), mert a csomag nem Next.js alkalmazás.
 */
export function PilotLinkTabs({
  tabs,
  label,
  renderLink,
}: {
  tabs: ReadonlyArray<{ href: string; label: string; active: boolean }>;
  label: string;
  renderLink?: (tab: {
    href: string;
    className: string;
    children: ReactNode;
    "aria-current"?: "page";
  }) => ReactNode;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const className = `inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg px-3.5 text-sm transition-colors ${
          tab.active
            ? "bg-pilot-aqua-50 font-semibold text-pilot-aqua-700 ring-1 ring-pilot-aqua-600"
            : "bg-white text-pilot-grey-600 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50 hover:text-pilot-grey-900"
        }`;
        const props = {
          href: tab.href,
          className,
          children: tab.label,
          ...(tab.active ? { "aria-current": "page" as const } : {}),
        };
        return (
          <span key={tab.href} className="contents">
            {renderLink ? renderLink(props) : <a {...props} />}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * EGY VALÓDI RÁDIÓCSOPORT, EGY SORBAN (a Számlázás-brief 4. pontja: "valódi
 * accessible radio group, keyboard navigation és megfelelő label"). Natív
 * `<input type="radio">`-kból áll egy `fieldset`-ben: a nyilak, a Tab és a
 * képernyőolvasó a böngészőé, nem kézzel újraírt. A kijelölés aqua (a
 * Direction F-ben a kiválasztás színe).
 *
 * Egy opció letiltható (`disabled`), és a csoport egésze is, rövid
 * magyarázattal (`hint`): a brief 5. pontja szerint egy nem értelmezett
 * választás rejtve vagy letiltva jelenik meg, indoklással. Hogy mikor, azt a
 * hívó dönti el (a domain képessége), ez a komponens nem.
 */
export function PilotRadioGroup<Value extends string>({
  name,
  label,
  options,
  value,
  onChange,
  disabled = false,
  hint,
}: {
  /** A natív `name`: egy lapon két csoport ne ütközzön. */
  name: string;
  label: string;
  options: ReadonlyArray<{ value: Value; label: string; disabled?: boolean }>;
  value: Value | null;
  onChange: (value: Value) => void;
  disabled?: boolean;
  /** Egy sor a csoport után, pl. hogy miért nem választható. */
  hint?: ReactNode;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2"
    >
      <legend className="float-left mr-1 text-xs text-pilot-grey-600">
        {label}:
      </legend>
      {options.map((option) => {
        const checked = option.value === value;
        const off = disabled || option.disabled;
        return (
          <label
            key={option.value}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm ${
              off ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            } ${checked ? "font-semibold text-pilot-grey-900" : "text-pilot-grey-700"}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="size-4 accent-pilot-aqua-600"
            />
            {option.label}
          </label>
        );
      })}
      {hint ? (
        <p className="basis-full text-xs text-pilot-grey-500">{hint}</p>
      ) : null}
    </fieldset>
  );
}

/**
 * SABLONVÁLTOZÓK KATTINTHATÓ CHIPEKKÉNT (a Számlázás-brief 17. pontja): a
 * chip a változó nevét adja a hívónak (`onInsert`), aki a kurzorhoz szúrja.
 * Hogy mely változók léteznek egy dokumentumtípusnál, azt a hívó adja.
 */
export function PilotVariableChips({
  label = "Használható változók",
  variables,
  onInsert,
}: {
  label?: string;
  variables: readonly string[];
  onInsert: (variable: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-pilot-grey-500">{label}</p>
      <ul className="flex flex-wrap gap-2">
        {variables.map((variable) => (
          <li key={variable}>
            <button
              type="button"
              onClick={() => onInsert(variable)}
              aria-label={`${variable} beszúrása`}
              className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-pilot-aqua-50 px-3 font-mono text-xs text-pilot-aqua-700 ring-1 ring-pilot-aqua-200 transition-colors hover:bg-pilot-aqua-100"
            >
              {variable}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CÍMKE–ÉRTÉK SOROK ÖSSZESÍTŐHÖZ (a terv "Számla összesen" kártyája): az
 * érték jobbra zár, az `emphasis` sor (pl. a bruttó) félkövér. Az értékeket
 * a hívó számolja és formázza; ez csak elrendez.
 */
export function PilotTotals({
  rows,
}: {
  rows: ReadonlyArray<{
    label: string;
    value: ReactNode;
    emphasis?: boolean;
  }>;
}) {
  return (
    <dl className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4"
        >
          <dt
            className={`text-sm ${row.emphasis ? "font-semibold text-pilot-grey-900" : "text-pilot-grey-600"}`}
          >
            {row.label}
          </dt>
          <dd className="text-right text-sm font-semibold tabular-nums text-pilot-grey-900">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

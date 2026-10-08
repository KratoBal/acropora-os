"use client";
import { Pagination } from "@acropora/ui";
import type { ReactNode } from "react";

/**
 * AZ ELSZÁMOLÁSOK KÖZÖS DARABJAI (Figma 45 · OS / Settlements: 618:1641,
 * 618:2082, 618:1788, 618:2268, 618:1935, 618:2454). A három szolgáltató
 * lapja ugyanebből épül: a behúzás sávja, a havi fájl kártyája, a lista
 * kártyája, és a részletnél a számok sávja, az ellenőrzés sávja.
 */

/**
 * A Gmail-behúzás állapota egy sávban: „Aktív” aqua kerettel, ha magától
 * fut; „Kikapcsolva” meleg kerettel, ha nem (az ok a mondatban).
 */
export function SettlementSyncStrip({
  active,
  title,
  text,
}: {
  active: boolean;
  /** Egy kiemelt mondat a szöveg előtt (a kikapcsolt állapot neve). */
  title?: string;
  text: string;
}) {
  return (
    <section
      data-testid="behuzas-sav"
      className={`flex flex-col gap-2 rounded-2xl border px-5 py-3 sm:flex-row sm:items-center ${
        active
          ? "border-pilot-aqua-700 bg-pilot-aqua-50"
          : "border-pilot-accent-warm bg-pilot-accent-warm-soft"
      }`}
    >
      <span
        className={`shrink-0 self-start rounded-md px-3 py-1 text-xs font-medium sm:self-auto ${
          active
            ? "bg-pilot-aqua-100 text-pilot-aqua-700"
            : "bg-white/60 text-pilot-accent-warm-text"
        }`}
      >
        {active ? "Aktív" : "Kikapcsolva"}
      </span>
      <div
        className={`text-xs ${
          active ? "text-pilot-aqua-700" : "text-pilot-accent-warm-text"
        }`}
      >
        {title ? (
          <p className="font-semibold text-pilot-grey-900">{title}</p>
        ) : null}
        <p>{text}</p>
      </div>
    </section>
  );
}

/** A havi könyvelési fájl kártyája: cím, aqua alcím, összegző sor, jobbra a választó. */
export function SettlementMonthCard({
  title,
  subtitle,
  summary,
  controls,
}: {
  title: string;
  subtitle: string;
  summary?: ReactNode;
  controls: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-pilot-grey-900">{title}</h2>
        <p className="mt-1 text-xs text-pilot-aqua-700">{subtitle}</p>
        {summary ? (
          <p className="mt-3 text-xs text-pilot-aqua-700">{summary}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {controls}
      </div>
    </section>
  );
}

/** A hónap-választó a havi kártyán, a terv mezőjének alakjában. */
export function SettlementMonthInput({
  value,
  onChange,
  label = "A riport hónapja",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <input
      type="month"
      aria-label={label}
      className="h-10 rounded-lg border border-pilot-grey-200 bg-white px-3 text-sm text-pilot-grey-900"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Egy lap a listából (a szerver a teljes listát adja, a terv lapoz). */
export const SETTLEMENT_PAGE_SIZE = 20;

export function settlementPage<T>(items: readonly T[], page: number) {
  const totalPages = Math.max(
    1,
    Math.ceil(items.length / SETTLEMENT_PAGE_SIZE),
  );
  const current = Math.min(Math.max(page, 1), totalPages);
  const from = (current - 1) * SETTLEMENT_PAGE_SIZE;
  return {
    page: current,
    totalPages,
    items: items.slice(from, from + SETTLEMENT_PAGE_SIZE),
    range:
      items.length === 0
        ? "0 / 0"
        : `${(from + 1).toLocaleString("hu-HU")}–${Math.min(from + SETTLEMENT_PAGE_SIZE, items.length).toLocaleString("hu-HU")} / ${items.length.toLocaleString("hu-HU")}`,
  };
}

/**
 * A táblázat kártyája: cím, jobbra a darabszám aqua szöveggel, a táblázat,
 * és ha lapoz, alul a tartomány és a lapozó.
 */
export function SettlementTableCard({
  title,
  subtitle,
  count,
  paging,
  children,
}: {
  title?: string;
  subtitle?: string;
  count?: string;
  paging?: {
    page: number;
    totalPages: number;
    range: string;
    onPageChange: (page: number) => void;
  };
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
      {title ? (
        <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h2
              className={`text-sm font-semibold ${
                subtitle ? "text-pilot-aqua-700" : "text-pilot-grey-900"
              }`}
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-pilot-grey-600">{subtitle}</p>
            ) : null}
          </div>
          {count ? (
            <span className="shrink-0 text-xs text-pilot-aqua-700">
              {count}
            </span>
          ) : null}
        </header>
      ) : null}
      {children}
      {paging ? (
        <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-pilot-aqua-700">{paging.range}</p>
          <Pagination
            variant="directionF"
            position="bottom"
            page={paging.page}
            totalPages={paging.totalPages}
            onPageChange={paging.onPageChange}
          />
        </div>
      ) : null}
    </section>
  );
}

/** A részlet számai egy sávban, egymás mellett (Figma: 5 cella, aqua címke). */
export function SettlementStats({
  items,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl
      data-testid="szamok-sav"
      className="grid grid-cols-2 overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white sm:grid-cols-3 lg:grid-cols-5"
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="border-b border-r border-pilot-grey-200 px-5 py-4 last:border-r-0"
        >
          <dt className="text-xs text-pilot-aqua-700">{item.label}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-pilot-grey-900">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A részlet sávja egy jellel bal oldalt: „Ellenőrzés” meleg kerettel (kézi
 * döntés kell), „Információ” aqua kerettel (a kimutatás figyelmeztetése).
 */
export function SettlementNotice({
  tone,
  title,
  children,
}: {
  tone: "check" | "info";
  title: string;
  children: ReactNode;
}) {
  const check = tone === "check";
  return (
    <section
      className={`flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center ${
        check
          ? "border-pilot-accent-warm bg-pilot-accent-warm-soft"
          : "border-pilot-aqua-700 bg-pilot-aqua-50"
      }`}
    >
      <span
        className={`shrink-0 self-start rounded-md px-3 py-1 text-xs sm:self-auto ${
          check
            ? "bg-white/60 text-pilot-accent-warm-text"
            : "bg-pilot-blue-50 text-pilot-blue-700"
        }`}
      >
        {check ? "Ellenőrzés" : "Információ"}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-pilot-grey-900">{title}</h2>
        <div className="mt-0.5 text-xs text-pilot-aqua-700">{children}</div>
      </div>
    </section>
  );
}

/** A sorok jóváhagyó mezője és gombja (a kimenő számla kézi megadása). */
export function SettlementApproveField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onApprove,
  hint,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onApprove: () => void;
  hint?: ReactNode;
}) {
  return (
    <div className="flex min-w-[280px] flex-wrap items-center gap-2">
      <input
        aria-label={label}
        className="h-10 min-w-0 flex-1 rounded-lg border border-pilot-grey-200 bg-white px-3 text-sm text-pilot-grey-900 focus:border-pilot-aqua-600 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-100"
        value={value}
        placeholder={placeholder}
        maxLength={100}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled || !value.trim()}
        className="h-10 rounded-lg bg-pilot-aqua-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
      >
        Jóváhagyás
      </button>
      {hint ? <p className="w-full text-xs text-amber-700">{hint}</p> : null}
    </div>
  );
}

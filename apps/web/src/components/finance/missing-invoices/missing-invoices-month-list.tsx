"use client";

import {
  Icon,
  PilotBadge,
  PilotButton,
  PilotDataTable,
  PilotPageHeader,
  type PilotTableColumn,
} from "@acropora/ui";

import {
  MONTH_STATE_BADGES,
  MONTH_STATE_LABELS,
  formatAmount,
  formatMonth,
  type MonthRow,
} from "./missing-invoices-model";

/**
 * HIÁNYZÓ SZÁMLÁK: A HÓNAPOK (Figma 343:3 és 343:651).
 *
 * Megjelenítő komponens: az adat a hívótól jön. A hónapok a legújabbtól
 * lefelé állnak (a szerver sorrendjében), a sor egésze kattintható.
 *
 * KIVONAT NÉLKÜL A SZÁMOK NEM NULLÁK, HANEM ISMERETLENEK: a cella "—", nem "0".
 * Egy 0 azt állítaná, hogy megnéztük és nincs hiány. A RÉSZLEGES kivonatnál
 * (acrobot 25265) a számok állnak, a jelvény alatt a kivonat nélküli számlák.
 */
export function MissingInvoicesMonthList({
  months,
  error,
  onRetry,
  onOpen,
  company,
}: {
  /** `null`: töltés. */
  months: MonthRow[] | null;
  error: string | null;
  onRetry: () => void;
  onOpen: (month: string) => void;
  /** A cég, akinek a nevére a számla szólhat; a szerver konfigurációjából. */
  company: { name: string; taxNumber: string } | null;
}) {
  const unknown = (row: MonthRow) => row.state === "STATEMENT_MISSING";
  const count = (row: MonthRow, key: keyof MonthRow["counts"], tone: string) =>
    unknown(row) ? (
      <span className={tone}>—</span>
    ) : (
      <span className={`tabular-nums ${tone}`}>{row.counts[key]}</span>
    );
  const columns: PilotTableColumn<MonthRow>[] = [
    {
      id: "month",
      header: "Hónap",
      width: "150px",
      cell: (row) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatMonth(row.month)}
        </span>
      ),
    },
    {
      id: "charges",
      header: "Terhelések",
      width: "88px",
      cell: (row) => count(row, "charges", "text-pilot-grey-600"),
    },
    {
      id: "found",
      header: "Megvan",
      width: "76px",
      cell: (row) => count(row, "found", "font-semibold text-pilot-green-700"),
    },
    {
      id: "unmatched",
      header: "Nem párosodott",
      width: "112px",
      cell: (row) =>
        count(row, "notMatched", "font-semibold text-pilot-amber-700"),
    },
    {
      id: "noInvoice",
      header: "Nincs számla",
      width: "100px",
      cell: (row) =>
        count(row, "noInvoice", "font-semibold text-pilot-red-700"),
    },
    {
      // A FIGMÁBAN NINCS (acrobot 25328): csak NAV-adat, eredeti nincs.
      id: "originalMissing",
      header: "Eredeti hiányzik",
      width: "112px",
      cell: (row) =>
        count(row, "originalMissing", "font-semibold text-pilot-amber-700"),
    },
    {
      id: "missingAmount",
      header: "Hiányzó összeg",
      width: "128px",
      cell: (row) => (
        <span className="font-semibold tabular-nums text-pilot-grey-900">
          {unknown(row) ? "—" : formatAmount(row.missingAmountHuf, "HUF")}
        </span>
      ),
    },
    {
      id: "state",
      header: "Állapot",
      cell: (row) => (
        <span className="block min-w-0">
          <PilotBadge variant={MONTH_STATE_BADGES[row.state]}>
            {MONTH_STATE_LABELS[row.state]}
          </PilotBadge>
          {row.state === "STATEMENT_PARTIAL" &&
          row.missingStatementAccounts.length > 0 ? (
            <span className="mt-1 block truncate text-xs text-pilot-grey-500">
              Nincs kivonat: {row.missingStatementAccounts.join(", ")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "open",
      header: <span className="sr-only">Megnyitás</span>,
      width: "44px",
      align: "right",
      cell: () => (
        <Icon
          name="chevron-left"
          size={16}
          className="inline rotate-180 text-pilot-aqua-700"
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PilotPageHeader
        title="Hiányzó számlák"
        description="Bankkivonat kontra számlák, hónaponként: mi van meg, és mi hiányzik a könyvelőnek."
      />
      <section className="overflow-hidden rounded-xl bg-white ring-1 ring-pilot-grey-200">
        {error ? (
          <div role="alert" className="space-y-3 px-5 py-6 text-sm">
            <p className="text-pilot-red-700">{error}</p>
            <PilotButton variant="secondary" size="action" onClick={onRetry}>
              Újrapróbálás
            </PilotButton>
          </div>
        ) : months === null ? (
          <p role="status" className="px-5 py-10 text-sm text-pilot-grey-500">
            A hónapok betöltése…
          </p>
        ) : months.length === 0 ? (
          <p className="px-5 py-10 text-sm text-pilot-grey-500">
            Még nincs feltöltött bankkivonat.
          </p>
        ) : (
          <>
            <PilotDataTable
              columns={columns}
              rows={months}
              rowKey={(row) => row.month}
              onRowActivate={(row) => onOpen(row.month)}
              rowLabel={(row) => `${formatMonth(row.month)} megnyitása`}
              minWidth={900}
            />
            <p className="px-5 py-4 text-xs text-pilot-grey-500">
              A sorra kattintva megnyílik az adott hónap részletes egyeztetése.
            </p>
          </>
        )}
      </section>
      {company ? (
        <aside className="rounded-xl bg-pilot-grey-100 px-5 py-4 text-sm ring-1 ring-pilot-grey-200">
          <p className="font-semibold text-pilot-grey-900">
            Csak az {company.name} (adószám: {company.taxNumber}) nevére szóló
            számla számít meglévőnek.
          </p>
          <p className="mt-1 text-xs text-pilot-grey-600">
            Magánszemély nevére kiállított bizonylat külön hiányállapotként
            jelenik meg, és javítást igényel.
          </p>
        </aside>
      ) : null}
    </div>
  );
}

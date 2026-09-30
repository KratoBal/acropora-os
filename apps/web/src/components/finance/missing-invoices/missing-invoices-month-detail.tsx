"use client";

import {
  Pagination,
  PilotBadge,
  PilotButton,
  PilotDataTable,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  ServiceListTabs,
  type PilotTableColumn,
} from "@acropora/ui";

import {
  CHARGE_STATE_BADGES,
  CHARGE_STATE_LABELS,
  CATEGORY_LABELS,
  CHARGE_TABS,
  FILTER_CATEGORIES,
  INVOICE_SOURCE_LABELS,
  formatAmount,
  formatDay,
  formatMonth,
  type BankAccountOption,
  type ChargeCategory,
  type ChargeRow,
  type ChargeTab,
  type MonthState,
} from "./missing-invoices-model";

export interface MonthSummary {
  found: number;
  notMatched: number;
  /** A Nem a cégre szól és a Csak díjbekérő is ide számít. */
  noInvoice: number;
  /** Csak NAV-adat, eredeti nincs: az ÖTÖDIK csempe (acrobot 25328). */
  originalMissing: number;
  noInvoiceNeeded: number;
}

export interface MonthFilters {
  search: string;
  category: ChargeCategory | "";
  accountId: string;
}

/**
 * HIÁNYZÓ SZÁMLÁK: EGY HÓNAP (Figma 343:219, és a KÖTELEZŐ MÉRCE 343:867).
 *
 * AZ 1280 PIXELES MÉRCE (brief 10. pont): hosszú partnernév NEM tolhatja el az
 * összeget, a számlát, a forrást és az állapotot. A tábla `table-fixed` rácsa
 * (`PilotDataTable`) minden oszlopnak fix szélességet ad, CSAK a partner kapja
 * a maradékot, és ott a név levágódik (`truncate`, a teljes név a `title`-ben).
 * A `minWidth` 900: az 1280-as tartalomszélességen belül marad, tehát nincs
 * vízszintes görgetés.
 *
 * KÜLÖN ÁLLAPOTOK, KÜLÖN LAPOK (brief 14. pont): nincs kivonat (343:1299),
 * minden megvan (343:1515), a töltés, és a Figmában nem szereplő részleges
 * kivonat (acrobot 25265), ahol a lap áll, felette egy sáv mondja meg, melyik
 * számlához hiányzik a kivonat.
 */
export function MissingInvoicesMonthDetail({
  month,
  accounts,
  state,
  summary,
  tab,
  onTab,
  filters,
  onFilters,
  rows,
  totalItems,
  page,
  pageSize,
  totalPages,
  onPage,
  onOpenRow,
  error,
  onRetry,
  canManage,
  onUploadStatement,
  onDownloadMissing,
  onDownloadPackage,
  exporting,
}: {
  month: string;
  accounts: BankAccountOption[];
  /** A szerver hónap-állapota; `null`: töltés. */
  state: MonthState | null;
  /** `null`: töltés. */
  summary: MonthSummary | null;
  tab: ChargeTab;
  onTab: (tab: ChargeTab) => void;
  filters: MonthFilters;
  onFilters: (patch: Partial<MonthFilters>) => void;
  /** `null`: töltés. */
  rows: ChargeRow[] | null;
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPage: (page: number) => void;
  onOpenRow: (row: ChargeRow) => void;
  error: string | null;
  onRetry: () => void;
  /** Feltöltés és export (`finance.manage`). */
  canManage: boolean;
  onUploadStatement: () => void;
  /**
   * A két export; ha nincs megadva, a gomb nem jelenik meg (az export végpontjai
   * nautilus 5. szeletével jönnek, addig a felület nem kínál nem létező
   * letöltést).
   */
  onDownloadMissing?: () => void;
  onDownloadPackage?: () => void;
  exporting: boolean;
}) {
  const title = formatMonth(month);
  const monthName = title.split(" ")[1] ?? title;
  const hasStatement = state !== "STATEMENT_MISSING";
  const allFound = state === "READY";
  const withoutStatement = accounts.filter((account) => !account.hasStatement);
  const filtered = Boolean(
    filters.search || filters.category || filters.accountId,
  );

  const columns: PilotTableColumn<ChargeRow>[] = [
    {
      id: "date",
      header: "Dátum",
      width: "108px",
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-pilot-grey-700">
          {formatDay(row.date)}
        </span>
      ),
    },
    {
      id: "partner",
      header: "Partner",
      cell: (row) =>
        row.partner ? (
          <span
            className="block truncate font-semibold text-pilot-grey-900"
            title={row.partner}
          >
            {row.partner}
          </span>
        ) : (
          <span className="text-pilot-grey-500">—</span>
        ),
    },
    {
      id: "category",
      header: "Kategória",
      width: "140px",
      cell: (row) => (
        <span className="block truncate text-pilot-grey-600">
          {CATEGORY_LABELS[row.category]}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Összeg",
      width: "118px",
      align: "right",
      cell: (row) => (
        <span className="block whitespace-nowrap tabular-nums">
          <span className="block font-semibold text-pilot-grey-900">
            {formatAmount(row.amount, row.currency)}
          </span>
          {row.original ? (
            <span className="block text-xs text-pilot-grey-500">
              {formatAmount(row.original.amount, row.original.currency)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "invoice",
      header: "Számla",
      width: "120px",
      cell: (row) => (
        <span
          className="block truncate text-pilot-grey-800"
          title={row.document?.number}
        >
          {row.document?.number ?? "—"}
        </span>
      ),
    },
    {
      id: "source",
      header: "Forrás",
      width: "92px",
      cell: (row) => (
        <span className="text-pilot-grey-600">
          {row.document ? INVOICE_SOURCE_LABELS[row.document.source] : "—"}
        </span>
      ),
    },
    {
      id: "state",
      header: "Állapot",
      width: "150px",
      cell: (row) => (
        <PilotBadge variant={CHARGE_STATE_BADGES[row.state]}>
          {CHARGE_STATE_LABELS[row.state]}
        </PilotBadge>
      ),
    },
    {
      id: "action",
      header: <span className="sr-only">Művelet</span>,
      width: "48px",
      align: "right",
      cell: (row) => (
        <button
          type="button"
          aria-label={`${row.partner ?? formatDay(row.date)} részletei`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenRow(row);
          }}
          className="cursor-pointer rounded-md px-2 py-1 text-pilot-grey-500 hover:bg-pilot-grey-100 hover:text-pilot-grey-800"
        >
          …
        </button>
      ),
    },
  ];

  const tiles: ReadonlyArray<{
    label: string;
    value: number | undefined;
    tone: string;
  }> = [
    {
      label: "Megvan",
      value: summary?.found,
      tone: "text-pilot-green-700",
    },
    {
      label: "Nem párosodott",
      value: summary?.notMatched,
      tone: "text-pilot-amber-700",
    },
    {
      label: "Nincs számla",
      value: summary?.noInvoice,
      tone: "text-pilot-red-700",
    },
    {
      label: "Eredeti hiányzik",
      value: summary?.originalMissing,
      tone: "text-pilot-amber-700",
    },
    {
      label: "Nem kell számla",
      value: summary?.noInvoiceNeeded,
      tone: "text-pilot-grey-600",
    },
  ];

  const actions =
    canManage && hasStatement && (onDownloadMissing || onDownloadPackage) ? (
      <div
        role="group"
        aria-label="Exportok"
        className="flex max-w-full flex-wrap justify-end gap-2"
      >
        {allFound || !onDownloadMissing ? null : (
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={exporting}
            onClick={onDownloadMissing}
          >
            Hiánylista letöltése
          </PilotButton>
        )}
        {onDownloadPackage ? (
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={exporting}
            onClick={onDownloadPackage}
          >
            Könyvelői csomag
          </PilotButton>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <PilotPageHeader
        title={title}
        description={accounts.map((account) => account.name).join(" · ")}
        actions={actions}
      />

      {error ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl bg-white px-5 py-6 text-sm ring-1 ring-pilot-grey-200"
        >
          <p className="text-pilot-red-700">{error}</p>
          <PilotButton variant="secondary" size="action" onClick={onRetry}>
            Újrapróbálás
          </PilotButton>
        </div>
      ) : summary === null || state === null ? (
        <p
          role="status"
          className="rounded-xl bg-white px-5 py-10 text-sm text-pilot-grey-500 ring-1 ring-pilot-grey-200"
        >
          Az egyeztetés betöltése…
        </p>
      ) : !hasStatement ? (
        <section className="rounded-xl bg-white px-6 py-16 text-center ring-1 ring-pilot-grey-200">
          <h2 className="text-xl font-semibold text-pilot-grey-900">
            Ehhez a hónaphoz nincs bankkivonat
          </h2>
          <p className="mt-3 text-sm text-pilot-grey-600">
            Töltsd fel a {monthName}i bankkivonatot, hogy az egyeztetés
            elinduljon.
          </p>
          {canManage ? (
            <div className="mt-8">
              <PilotButton
                variant="primary"
                size="regular"
                onClick={onUploadStatement}
              >
                Kivonat feltöltése
              </PilotButton>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {withoutStatement.length > 0 ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-pilot-grey-100 px-5 py-3 text-sm ring-1 ring-pilot-grey-200"
            >
              <p className="text-pilot-grey-700">
                Részleges kivonat: ehhez a hónaphoz nincs kivonat a(z){" "}
                {withoutStatement.map((account) => account.name).join(", ")}{" "}
                számlához, ezért a hónap még nem zárható le.
              </p>
              {canManage ? (
                <PilotButton
                  variant="secondary"
                  size="action"
                  onClick={onUploadStatement}
                >
                  Kivonat feltöltése
                </PilotButton>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((tile) => (
              <article
                key={tile.label}
                className="rounded-xl bg-white px-4 py-4 ring-1 ring-pilot-grey-200"
              >
                <p className="text-sm text-pilot-grey-600">{tile.label}</p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums ${tile.tone}`}
                >
                  {tile.value}
                </p>
              </article>
            ))}
          </div>

          {allFound ? (
            <section className="rounded-xl bg-pilot-green-50 px-6 py-16 text-center ring-1 ring-pilot-grey-200">
              <h2 className="text-xl font-semibold text-pilot-green-700">
                Minden terheléshez megvan a számla
              </h2>
              <p className="mt-3 text-sm text-pilot-grey-600">
                A {monthName}i hónap készen áll a könyvelőnek. A könyvelői
                csomag letölthető.
              </p>
            </section>
          ) : (
            <>
              <ServiceListTabs
                label="Terhelések állapot szerint"
                tabs={CHARGE_TABS.map(({ key, label }) => ({ key, label }))}
                active={tab}
                onSelect={(key) => onTab(key as ChargeTab)}
              />
              <div className="flex flex-wrap gap-3">
                <div className="w-full sm:w-72">
                  <PilotInput
                    aria-label="Keresés a terhelések között"
                    placeholder="Partner, közlemény, összeg…"
                    value={filters.search}
                    onChange={(search) => onFilters({ search })}
                  />
                </div>
                <div className="w-full sm:w-48">
                  <PilotSelect
                    aria-label="Kategória"
                    value={filters.category}
                    onChange={(category) =>
                      onFilters({ category: category as ChargeCategory | "" })
                    }
                  >
                    <option value="">Kategória</option>
                    {FILTER_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </PilotSelect>
                </div>
                <div className="w-full sm:w-44">
                  <PilotSelect
                    aria-label="Bankszámla"
                    value={filters.accountId}
                    onChange={(accountId) => onFilters({ accountId })}
                  >
                    <option value="">Bankszámla</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </PilotSelect>
                </div>
              </div>

              <section className="overflow-hidden rounded-xl bg-white ring-1 ring-pilot-grey-200">
                {rows === null ? (
                  <p
                    role="status"
                    className="px-5 py-10 text-sm text-pilot-grey-500"
                  >
                    A terhelések betöltése…
                  </p>
                ) : rows.length === 0 ? (
                  <p className="px-5 py-10 text-sm text-pilot-grey-500">
                    {filtered
                      ? "Nincs a szűrésnek megfelelő terhelés."
                      : "Ebben a nézetben nincs terhelés."}
                  </p>
                ) : (
                  <>
                    <PilotDataTable
                      columns={columns}
                      rows={rows}
                      rowKey={(row) => row.id}
                      onRowActivate={onOpenRow}
                      rowLabel={(row) =>
                        `${row.partner ?? "Ismeretlen partner"}, ${formatDay(row.date)}`
                      }
                      minWidth={900}
                    />
                    <div className="flex items-center justify-between gap-3 px-5 py-4">
                      <p className="text-xs text-pilot-grey-500">
                        {(page - 1) * pageSize + 1}–
                        {(page - 1) * pageSize + rows.length} / {totalItems}{" "}
                        {tab === "MISSING" ? "hiányzó terhelés" : "terhelés"}
                      </p>
                      <Pagination
                        page={page}
                        totalPages={totalPages}
                        onPageChange={onPage}
                      />
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Pagination,
  PilotButton,
  PilotDataTable,
  PilotInput,
  PilotSelect,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  BILLING_DOCUMENT_LIST_PAGE_SIZE,
  INCOMING_BANK_MATCH_LABELS,
  INCOMING_BANK_MATCH_STATES,
  INCOMING_PAYMENT_STATE_LABELS,
  INCOMING_PAYMENT_STATES,
  INVOICE_FORMAT_LABELS,
  type IncomingDocumentListItem,
  type IncomingDocumentListResponse,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { billingDocumentsApi } from "@/lib/api/billing-documents";
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { PAYMENT_STATE_TONE, PaymentBadge } from "./billing-payment";

const PAGE_SIZE = String(BILLING_DOCUMENT_LIST_PAGE_SIZE.default);

export const incomingDocumentHref = (id: string) =>
  `${BILLING_LIST_PATH}/bejovo/${id}`;

/** Összeg a pénznem tizedeseivel, pénznem-jel nélkül (a DEVIZA oszlop mondja). */
export function incomingAmount(value: string, currency: string): string {
  const digits = currency === "HUF" ? 0 : 2;
  return new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

const rateText = (value: string | null) =>
  value
    ? new Intl.NumberFormat("hu-HU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(Number(value))
    : "—";

/** A számla jelzői: a típus röviden (a „Számla” itt „Normál”) és a formátum. */
const flagsText = (item: IncomingDocumentListItem) =>
  `${item.kindCode.toUpperCase() === "SZ" ? "Normál" : item.kindLabel} · ${
    INVOICE_FORMAT_LABELS[item.invoiceFormat]
  }`;

/** A banki párosítás színe (a kifizetésé a közös `PAYMENT_STATE_TONE`). */
const bankTone = (state: IncomingDocumentListItem["bankMatch"]["state"]) =>
  state === "PAIRED"
    ? "text-pilot-aqua-700"
    : state === "NOT_TO_PAIR"
      ? "text-pilot-grey-500"
      : "text-pilot-accent-warm-text";

/** Az oszlopok a Figma 374:651 kerete szerint. */
export const INCOMING_COLUMNS: readonly PilotTableColumn<IncomingDocumentListItem>[] =
  [
    {
      id: "invoice",
      header: "Számla",
      width: "140px",
      cell: (item) => (
        <span className="flex flex-col gap-0.5">
          <span className="truncate font-semibold text-pilot-grey-900">
            {item.documentNumber}
          </span>
          <span className="text-xs text-pilot-aqua-700">{flagsText(item)}</span>
        </span>
      ),
    },
    {
      id: "supplier",
      header: "Szállító",
      cell: (item) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className="truncate font-semibold text-pilot-grey-900"
            title={item.supplierName}
          >
            {item.supplierName}
          </span>
          <span className="text-xs text-pilot-grey-500">
            {item.supplierTaxNumber ?? "—"}
          </span>
        </span>
      ),
    },
    {
      id: "dates",
      header: "Dátumok",
      width: "150px",
      cell: (item) => (
        <span className="flex flex-col gap-0.5 text-xs text-pilot-grey-600">
          <span>Kelt: {formatDay(item.issueDate)}</span>
          <span>Telj.: {formatDay(item.fulfillmentDate)}</span>
          <span className="text-pilot-grey-500">
            Hat.: {formatDay(item.dueDate)}
          </span>
        </span>
      ),
    },
    {
      id: "payment",
      header: "Fizetés",
      width: "130px",
      cell: (item) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-pilot-grey-900">
            {item.paymentMethod ?? "—"}
          </span>
          {/* a kimenő listával azonos jelzés és dátumírás (#1368) */}
          <PaymentBadge
            paymentState={item.paymentState}
            paidAmount={item.paidAmount}
            lastPaymentDate={item.lastPaymentDate}
            currency={item.currency}
          />
        </span>
      ),
    },
    {
      id: "currency",
      header: "Deviza",
      width: "80px",
      cell: (item) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-pilot-grey-900">
            {item.currency}
          </span>
          <span className="text-xs tabular-nums text-pilot-grey-500">
            {item.currency === "HUF" ? "—" : rateText(item.exchangeRate)}
          </span>
        </span>
      ),
    },
    {
      id: "totals",
      header: "Összegek",
      width: "170px",
      align: "right",
      cell: (item) => (
        <span className="flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums">
          <span className="text-xs text-pilot-grey-600">
            Nettó {incomingAmount(item.netAmount, item.currency)}
          </span>
          <span className="text-xs text-pilot-grey-600">
            ÁFA {incomingAmount(item.vatAmount, item.currency)}
          </span>
          <span className="font-semibold text-pilot-grey-900">
            Bruttó {incomingAmount(item.grossAmount, item.currency)}
          </span>
        </span>
      ),
    },
    {
      id: "state",
      header: "Állapot / bank",
      width: "190px",
      cell: (item) => (
        <span className="flex flex-col gap-0.5 pl-2 text-xs">
          <span className="text-pilot-grey-600">
            {item.kindLabel}
            {item.cancelled ? " · sztornózott" : ""}
          </span>
          <span className={PAYMENT_STATE_TONE[item.paymentState].text}>
            {INCOMING_PAYMENT_STATE_LABELS[item.paymentState]}
          </span>
          <span className={bankTone(item.bankMatch.state)}>
            {INCOMING_BANK_MATCH_LABELS[item.bankMatch.state]}
          </span>
        </span>
      ),
    },
  ];

/** Az időszak választéka: az elmúlt két év hónapjai, a legújabb elöl. */
function monthOptions(today = new Date()): { value: string; label: string }[] {
  const names = new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
  });
  return Array.from({ length: 24 }, (_, back) => {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1),
    );
    return {
      value: date.toISOString().slice(0, 7),
      label: names.format(date),
    };
  });
}

/** `YYYY-MM` -> a hónap első és utolsó napja. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

const FILTER_KEYS = [
  "q",
  "idoszak",
  "datum",
  "fizetes",
  "tipus",
  "penznem",
  "bank",
  "page",
] as const;

/**
 * A BEJÖVŐ SZÁMLÁK LISTÁJA (Figma 374:651; az adat a #1367 végpontja). A
 * szűrők az URL-ben, mint a kimenő listán: egy számlából visszalépve a lista
 * ugyanott áll. A kulcsok a kimenőétől különböznek, és a nézetváltás mindet
 * törli, tehát egy kimenő szűrő nem szivárog át ide.
 */
export function BillingIncomingList({ token }: { token: string }) {
  const router = useRouter();
  const { params, update } = useUrlQuery();
  const months = useMemo(() => monthOptions(), []);
  const period = urlChoice(
    params,
    "idoszak",
    ["", ...months.map((m) => m.value)],
    "",
  );
  const dateBasis = urlChoice(params, "datum", ["kelt", "teljesites"], "kelt");
  const paymentState = urlChoice(
    params,
    "fizetes",
    ["", ...INCOMING_PAYMENT_STATES],
    "",
  );
  const bankMatch = urlChoice(
    params,
    "bank",
    ["", ...INCOMING_BANK_MATCH_STATES],
    "",
  );
  const kindCode = params.get("tipus") ?? "";
  const currency = params.get("penznem") ?? "";
  const page = urlPage(params);
  const appliedSearch = params.get("q") ?? "";
  const [search, setSearch] = useState(appliedSearch);
  const hasFilters = Boolean(
    appliedSearch ||
    period ||
    dateBasis !== "kelt" ||
    paymentState ||
    bankMatch ||
    kindCode ||
    currency,
  );

  const [data, setData] = useState<IncomingDocumentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        update({
          q: search.trim() || null,
          ...(search.trim() !== appliedSearch ? { page: null } : {}),
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [appliedSearch, search, update]);

  const query = useMemo(() => {
    const value = new URLSearchParams();
    value.set("page", String(page));
    value.set("pageSize", PAGE_SIZE);
    if (appliedSearch) value.set("q", appliedSearch);
    if (period) {
      const range = monthRange(period);
      value.set("from", range.from);
      value.set("to", range.to);
    }
    if (dateBasis === "teljesites") value.set("dateBasis", "FULFILLMENT");
    if (paymentState) value.set("paymentState", paymentState);
    if (kindCode) value.set("kindCode", kindCode);
    if (currency) value.set("currency", currency);
    if (bankMatch) value.set("bankMatch", bankMatch);
    return value;
  }, [
    appliedSearch,
    bankMatch,
    currency,
    dateBasis,
    kindCode,
    page,
    paymentState,
    period,
  ]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(await billingDocumentsApi.incomingList(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A bejövő számlák nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [query, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const setFilter = (key: string, value: string) =>
    update({ [key]: value || null, page: null });
  const clearFilters = () => {
    setSearch("");
    update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
  };
  const goToPage = (next: number) =>
    update({ page: next === 1 ? null : String(next) });

  return (
    <>
      <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-[2_1_320px]">
            <PilotInput
              aria-label="Szállító keresése"
              value={search}
              onChange={setSearch}
              leadingIcon={<Icon name="search" size={17} />}
              placeholder="Szállító neve vagy adószáma…"
              className="h-10"
            />
          </div>
          <PilotSelect
            chevron
            aria-label="Időszak"
            value={period}
            onChange={(value) => setFilter("idoszak", value)}
            className="min-w-[200px] flex-[1_1_210px] [&_select]:h-10"
          >
            <option value="">Időszak: mind</option>
            {months.map((month) => (
              <option key={month.value} value={month.value}>
                Időszak: {month.label}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Dátum alapja"
            value={dateBasis}
            onChange={(value) =>
              setFilter("datum", value === "kelt" ? "" : value)
            }
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            <option value="kelt">Dátum: kelt</option>
            <option value="teljesites">Dátum: teljesítés</option>
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Fizetés"
            value={paymentState}
            onChange={(value) => setFilter("fizetes", value)}
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            <option value="">Fizetve / nincs</option>
            {INCOMING_PAYMENT_STATES.map((state) => (
              <option key={state} value={state}>
                {INCOMING_PAYMENT_STATE_LABELS[state]}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Típus"
            value={kindCode}
            onChange={(value) => setFilter("tipus", value)}
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            <option value="">Minden típus</option>
            {(data?.facets.kindCodes ?? []).map((kind) => (
              <option key={kind.code} value={kind.code}>
                {kind.label}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Pénznem"
            value={currency}
            onChange={(value) => setFilter("penznem", value)}
            className="min-w-[150px] flex-[1_1_160px] [&_select]:h-10"
          >
            <option value="">Minden pénznem</option>
            {(data?.facets.currencies ?? []).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Banki párosítás"
            value={bankMatch}
            onChange={(value) => setFilter("bank", value)}
            className="min-w-[200px] flex-[1_1_210px] [&_select]:h-10"
          >
            <option value="">Bankkal párosodott / nem</option>
            {INCOMING_BANK_MATCH_STATES.map((state) => (
              <option key={state} value={state}>
                {INCOMING_BANK_MATCH_LABELS[state]}
              </option>
            ))}
          </PilotSelect>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto cursor-pointer whitespace-nowrap text-xs text-pilot-accent-warm-text hover:underline"
            >
              Szűrők törlése
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      {loading && !data ? (
        <div aria-label="Bejövő számlák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data && !error ? (
        data.items.length ? (
          <section className="relative overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
            <span
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 bg-pilot-accent-warm"
            />
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-pilot-accent-warm-text">
                {data.pagination.totalItems.toLocaleString("hu-HU")} bejövő
                számla
              </p>
              <Pagination
                variant="directionF"
                position="top"
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={goToPage}
              />
            </div>
            <PilotDataTable
              columns={INCOMING_COLUMNS}
              rows={data.items}
              rowKey={(item) => item.id}
              onRowActivate={(item) =>
                router.push(incomingDocumentHref(item.id))
              }
              rowLabel={(item) =>
                `Bejövő ${item.kindLabel.toLowerCase()} ${item.documentNumber}, ${item.supplierName} megnyitása`
              }
              minWidth={1040}
            />
            <div className="flex justify-end border-t border-pilot-grey-200 px-5 py-4">
              <Pagination
                variant="directionF"
                position="bottom"
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={goToPage}
              />
            </div>
          </section>
        ) : (
          <EmptyState
            title={hasFilters ? "Nincs találat" : "Még nincs bejövő számla"}
            description={
              hasFilters
                ? "Módosítsd a keresést vagy töröld a szűrőket."
                : "A Számlázz.hu adatkapcsolatán érkező beszállítói számlák itt jelennek meg."
            }
            action={
              hasFilters ? (
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={clearFilters}
                >
                  Szűrők törlése
                </PilotButton>
              ) : undefined
            }
          />
        )
      ) : null}
    </>
  );
}

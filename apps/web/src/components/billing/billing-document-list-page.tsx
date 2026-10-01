"use client";

import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Pagination,
  PilotButton,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import {
  BILLING_DOCUMENT_LIST_PAGE_SIZE,
  BILLING_DOCUMENT_ORIGINS,
  BILLING_DOCUMENT_STATUS_LABELS,
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_TYPES,
  getDocumentCapabilities,
  hasPermission,
  INVOICE_FORMAT_LABELS,
  INVOICE_FORMATS,
  PERMISSIONS,
  type BillingDocumentListItem,
  type BillingDocumentListResponse,
} from "@acropora/types";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";
import {
  BILLING_LIST_PATH,
  BillingDocumentTable,
  billingDocumentHref,
} from "./billing-document-table";
import { BillingIncomingList } from "./billing-incoming-list";
import { BillingReceiptsView } from "./billing-receipts-view";
import {
  BILLING_VIEWS,
  BillingViewTiles,
  type BillingView,
} from "./billing-view-tiles";

const PAGE_SIZE = String(BILLING_DOCUMENT_LIST_PAGE_SIZE.default);

function pageRange(pagination: BillingDocumentListResponse["pagination"]) {
  const total = pagination.totalItems;
  if (total === 0) return "0 / 0";
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, total);
  return `${from.toLocaleString("hu-HU")}–${to.toLocaleString("hu-HU")} / ${total.toLocaleString("hu-HU")}`;
}

/** Az oldal leírása nézetenként (Figma 330:355, 374:651, 374:1033). */
const VIEW_DESCRIPTIONS: Record<BillingView, string> = {
  kimeno:
    "Kiállított és előkészítés alatt lévő számlák, díjbekérők, előlegszámlák és szállítólevelek.",
  bejovo:
    "Beszállítói számlák a Számlázz.hu pénzügyi adatkapcsolatból, banki párosítási és fizetési állapotokkal.",
  nyugtak: "A Számlázz.hu-ból naponta, kötegelve érkező nyugták.",
};

/**
 * A SZÁMLÁZÁS OLDALA (Balázs újraterv-promptja, acrobot 25869): közös fejléc,
 * a három nézet csempéje, alatta a választott nézet. A nézet az URL `nezet`
 * kulcsában áll; a kimenő az alap, az ő URL-je tiszta marad.
 *
 * A NÉZETVÁLTÁS MINDEN SZŰRŐT TÖRÖL: a három nézet szűrői mások, és egy
 * kimenő „Csak a külsők” vagy egy lapszám nem jelenthet semmit a bejövőn.
 */
export function BillingDocumentListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_VIEW),
  );
  const canCreate = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_CREATE),
  );
  const { params } = useUrlQuery();
  const view = urlChoice(params, "nezet", BILLING_VIEWS, "kimeno");

  const selectView = (next: BillingView) => {
    if (next === view) return;
    router.replace(next === "kimeno" ? pathname : `${pathname}?nezet=${next}`, {
      scroll: false,
    });
  };
  const newDocument = () => router.push(`${BILLING_LIST_PATH}/uj`);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a számlázáshoz"
        description="billing.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title="Számlázás"
        description={VIEW_DESCRIPTIONS[view]}
        actions={
          canCreate ? (
            <PilotButton size="regular" onClick={newDocument}>
              Új számla
            </PilotButton>
          ) : undefined
        }
      />
      <BillingViewTiles active={view} onSelect={selectView} />
      <div
        role="tabpanel"
        aria-labelledby={`billing-view-${view}`}
        className="space-y-6"
      >
        {view === "bejovo" ? (
          <BillingIncomingList token={token} />
        ) : view === "nyugtak" ? (
          <BillingReceiptsView token={token} />
        ) : (
          <OutgoingList
            token={token}
            canCreate={canCreate}
            onNew={newDocument}
          />
        )}
      </div>
    </PilotThemeRoot>
  );
}

/**
 * A KIMENŐ LISTA (Balázs briefje, 2026-09-30, "Dokumentumlista"): a négy
 * bizonylattípus és a vázlatok egy listán, nem típusonként külön oldalon.
 *
 * A SZŰRŐK ÉS A LAP AZ URL-BEN (`useUrlQuery`, #1271): egy bizonylatból
 * visszalépve a lista ugyanott áll. A keresés késleltetve íródik, a szűrő-
 * váltás a lapot nullázza, a "Szűrők törlése" mindent visszaállít.
 *
 * A SOR EGÉSZE KATTINTHATÓ (brief 7. pont); a vázlat a szerkesztőbe, minden
 * más a részletekre nyílik (a szerver `opens` mezője szerint).
 */
function OutgoingList({
  token,
  canCreate,
  onNew,
}: {
  token: string;
  canCreate: boolean;
  onNew: () => void;
}) {
  const router = useRouter();

  const { params, update } = useUrlQuery();
  const documentType = urlChoice(
    params,
    "documentType",
    ["", ...BILLING_DOCUMENT_TYPES],
    "",
  );
  const status = urlChoice(
    params,
    "status",
    ["", ...BILLING_DOCUMENT_STATUSES],
    "",
  );
  const invoiceFormat = urlChoice(
    params,
    "invoiceFormat",
    ["", ...INVOICE_FORMATS],
    "",
  );
  // a forrás (acrobot 25812): a mieink, a Számlázz.hu-ból kapott külsők, vagy mind
  const origin = urlChoice(
    params,
    "origin",
    ["", ...BILLING_DOCUMENT_ORIGINS],
    "",
  );
  const page = urlPage(params);
  const appliedSearch = params.get("q") ?? "";
  const [search, setSearch] = useState(appliedSearch);
  const hasFilters = Boolean(
    appliedSearch || documentType || status || invoiceFormat || origin,
  );

  const [data, setData] = useState<BillingDocumentListResponse | null>(null);
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
    if (documentType) value.set("documentType", documentType);
    if (status) value.set("status", status);
    if (invoiceFormat) value.set("invoiceFormat", invoiceFormat);
    if (origin) value.set("origin", origin);
    return value;
  }, [appliedSearch, documentType, invoiceFormat, origin, page, status]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(await billingDocumentsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A bizonylatok nem tölthetők be.",
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
    update({
      q: null,
      documentType: null,
      status: null,
      invoiceFormat: null,
      origin: null,
      page: null,
    });
  };
  const goToPage = (next: number) =>
    update({ page: next === 1 ? null : String(next) });
  const open = (item: BillingDocumentListItem) =>
    router.push(billingDocumentHref(item));

  return (
    <>
      <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-[2_1_360px]">
            <PilotInput
              aria-label="Bizonylat keresése"
              value={search}
              onChange={setSearch}
              leadingIcon={<Icon name="search" size={17} />}
              placeholder="Bizonylatszám, partner, hivatkozás…"
              className="h-10"
            />
          </div>
          <PilotSelect
            chevron
            aria-label="Dokumentumtípus"
            value={documentType}
            onChange={(value) => setFilter("documentType", value)}
            className="min-w-[190px] flex-[1_1_200px] [&_select]:h-10"
          >
            <option value="">Minden dokumentumtípus</option>
            {BILLING_DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {getDocumentCapabilities(type).label}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Állapot"
            value={status}
            onChange={(value) => setFilter("status", value)}
            className="min-w-[170px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="">Minden állapot</option>
            {BILLING_DOCUMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {BILLING_DOCUMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Formátum"
            value={invoiceFormat}
            onChange={(value) => setFilter("invoiceFormat", value)}
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            <option value="">Minden formátum</option>
            {INVOICE_FORMATS.map((value) => (
              <option key={value} value={value}>
                {INVOICE_FORMAT_LABELS[value]}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Forrás"
            value={origin}
            onChange={(value) => setFilter("origin", value)}
            className="min-w-[170px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="">Minden forrás</option>
            <option value="OWN">Csak a mieink</option>
            <option value="EXTERNAL">Csak a külsők</option>
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
        <div aria-label="Bizonylatok betöltése" className="space-y-3">
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
                {data.pagination.totalItems.toLocaleString("hu-HU")} bizonylat
              </p>
              <Pagination
                variant="directionF"
                position="top"
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={goToPage}
              />
            </div>
            <BillingDocumentTable items={data.items} onOpen={open} />
            <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-pilot-grey-500">
                {pageRange(data.pagination)}
              </p>
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
            title={hasFilters ? "Nincs találat" : "Még nincs bizonylat"}
            description={
              hasFilters
                ? "Módosítsd a keresést vagy töröld a szűrőket."
                : "Az első számlát az Új számla gombbal lehet elkészíteni."
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
              ) : canCreate ? (
                <PilotButton size="regular" onClick={onNew}>
                  Új számla
                </PilotButton>
              ) : undefined
            }
          />
        )
      ) : null}
    </>
  );
}

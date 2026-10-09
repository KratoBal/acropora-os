"use client";
import {
  Alert,
  Button,
  EmptyState,
  Icon,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ExpectedArrivalListItem,
  type ExpectedArrivalSource,
  type SupplierInvoiceMailSyncStatus,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { urlChoice, useUrlQuery } from "@/lib/navigation/use-url-query";
import { expectedArrivalsApi } from "@/lib/api/expected-arrivals";

import {
  PilotFilterCard,
  PilotListCard,
  PurchasingTabs,
} from "./purchasing-pilot-shell";

/** A lista egy lapja (a terv lapoz; a szerver a teljes listát adja). */
const PAGE_SIZE = 25;

type Stage = ExpectedArrivalListItem["stage"];

const STAGE_LABEL: Record<Stage, string> = {
  INVOICE: "Bevételezhető",
  PROFORMA: "Csak proforma, a számla még nem érkezett meg",
  LATE_CORRECTION: "Bevételezés után javított számla érkezett",
};

const STAGE_BADGE: Record<Stage, "success" | "amber" | "danger"> = {
  INVOICE: "success",
  PROFORMA: "amber",
  LATE_CORRECTION: "danger",
};

/** A keresés a beszállító nevére, a rendelés- és a számlaszámra szűr. */
function matches(item: ExpectedArrivalListItem, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [item.supplierName, item.orderReference, item.invoiceNumber].some(
    (value) => value?.toLowerCase().includes(needle),
  );
}

function formatAmount(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

/** A kézi ellenőrzés eredménye egy mondatban. */
function syncSentence(run: {
  documentsRead: number;
  reminderCount: number;
}): string {
  const parts = [
    run.documentsRead > 0
      ? `${run.documentsRead} új dokumentum beolvasva.`
      : "Nincs új beszállítói levél.",
  ];
  // a felszólítás mellékletét (a régi számlát) nem olvassuk be: ez látszódjon
  if (run.reminderCount > 0)
    parts.push(
      `${run.reminderCount} fizetési felszólítás kihagyva, nem nyit várható beérkezést.`,
    );
  return parts.join(" ");
}

/** A "Nem kell" csak a levélből jött, még nyitott tételnek jár. */
function dismissable(item: ExpectedArrivalListItem): boolean {
  return item.source === "MAIL" && item.stage !== "LATE_CORRECTION";
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("hu-HU") : "—";
}

/** A levél-behúzás állapota egy mondatban, a lap tetején. */
function mailPullSentence(status: SupplierInvoiceMailSyncStatus): string {
  switch (status.state) {
    case "ENABLED":
      return `A beszállítói levelek behúzása ${status.intervalMinutes} percenként fut magától.`;
    case "NO_KEY":
      return "A beszállítói levelek behúzása be van kapcsolva, de nincs hozzá Gmail-kulcs.";
    case "NO_SENDERS":
      return "A beszállítói levelek behúzása be van kapcsolva, de egy feladó sincs megadva.";
    default:
      return "A beszállítói levelek behúzása nem fut magától; a „Levelek ellenőrzése” gomb kézzel indítja.";
  }
}

/**
 * VÁRHATÓ BEÉRKEZÉSEK (Balázs, 2026-09-30): "a Beszerzés alatt található
 * Várható beérkezések menüpontban ott van a lista, miből kiválasztja, melyik
 * számlát akarja bevételezni, és utána megcsinálja a beszerzést".
 *
 * Egy lista, forrás szerint jelölve: a levélből jött rendelések (a proformáé
 * még nem bevételezhető) és a NAV-ból jött, még be nem vételezett számlák. Egy
 * sorra kattintva a szerkesztő előtöltve nyílik; a mentés után a tétel lekerül.
 */
export function ExpectedArrivalListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ExpectedArrivalListItem[] | null>(null);
  const [dismissed, setDismissed] = useState<ExpectedArrivalListItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mailStatus, setMailStatus] =
    useState<SupplierInvoiceMailSyncStatus | null>(null);
  // A FORRÁS-SZŰRŐ AZ URL-BEN (Balázs kérése, 2026-09-30): a szerkesztőből
  // visszalépve a lista ugyanazt a forrást mutatja.
  const { params, update } = useUrlQuery();
  const source = urlChoice<"" | ExpectedArrivalSource>(
    params,
    "source",
    ["MAIL", "NAV"],
    "",
  );
  const setSource = (next: "" | ExpectedArrivalSource) => {
    update({ source: next || null });
    setPage(1);
  };
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<"" | Stage>("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, status] = await Promise.all([
        expectedArrivalsApi.list(token),
        expectedArrivalsApi.syncStatus(token).catch(() => null),
      ]);
      setItems(list.items);
      setDismissed(list.dismissed ?? []);
      setMailStatus(status);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A lista nem tölthető be.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const run = await expectedArrivalsApi.sync(token);
      setSyncNotice(syncSentence(run));
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A levelek ellenőrzése nem sikerült.",
      );
    } finally {
      setSyncing(false);
    }
  };

  /** "Nem kell" és visszavétel: a szerver auditálja, a lista újratöltődik. */
  const handleMove = async (id: string, action: "dismiss" | "restore") => {
    setBusyId(id);
    setError(null);
    try {
      await expectedArrivalsApi[action](token, id);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusyId(null);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a listához"
        description="A megtekintéshez purchasing.view jogosultság szükséges."
      />
    );

  return (
    <ExpectedArrivalView
      items={items}
      dismissed={dismissed}
      loading={loading}
      error={error}
      syncing={syncing}
      syncNotice={syncNotice}
      mailStatus={mailStatus}
      canManage={canManage}
      busyId={busyId}
      source={source}
      setSource={setSource}
      search={search}
      setSearch={(value) => {
        setSearch(value);
        setPage(1);
      }}
      stage={stage}
      setStage={(value) => {
        setStage(value);
        setPage(1);
      }}
      page={page}
      setPage={setPage}
      onSync={() => void handleSync()}
      onReload={() => void load()}
      onMove={(id, action) => void handleMove(id, action)}
      onOpen={(item) => router.push(item.editorPath!)}
      onNew={() => router.push("/beszerzes/uj")}
    />
  );
}

/**
 * A LAP KINÉZETE (Figma 611:321, „OS / Purchasing / Expected / Desktop”):
 * fejléc a művelettel, a Beszerzés fülei, szűrőkártya, a lista kártyája a
 * darabszámmal és a lapozóval. A tartalom és a viselkedés a mai: a forrás-
 * szűrő, a „Nem kell”, a levél-behúzás és a kivett tételek megmaradnak, a
 * terv stílusában.
 */
function ExpectedArrivalView(props: {
  items: ExpectedArrivalListItem[] | null;
  dismissed: ExpectedArrivalListItem[];
  loading: boolean;
  error: string | null;
  syncing: boolean;
  syncNotice: string | null;
  mailStatus: SupplierInvoiceMailSyncStatus | null;
  canManage: boolean;
  busyId: string | null;
  source: "" | ExpectedArrivalSource;
  setSource: (value: "" | ExpectedArrivalSource) => void;
  search: string;
  setSearch: (value: string) => void;
  stage: "" | Stage;
  setStage: (value: "" | Stage) => void;
  page: number;
  setPage: (page: number) => void;
  onSync: () => void;
  onReload: () => void;
  onMove: (id: string, action: "dismiss" | "restore") => void;
  onOpen: (item: ExpectedArrivalListItem) => void;
  onNew: () => void;
}) {
  const { items, canManage, busyId } = props;
  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (item) =>
          (!props.source || item.source === props.source) &&
          (!props.stage || item.stage === props.stage) &&
          matches(item, props.search),
      ),
    [items, props.source, props.stage, props.search],
  );
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(props.page, totalPages);
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = Boolean(props.source || props.stage || props.search);

  const columns: PilotTableColumn<ExpectedArrivalListItem>[] = [
    {
      id: "reference",
      header: "Rendelés / számla",
      width: "19%",
      cell: (item) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-pilot-grey-600">
            {[
              item.orderReference ? `rendelés ${item.orderReference}` : null,
              item.invoiceNumber,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
          <PilotBadge variant={item.source === "MAIL" ? "blue" : "grey"}>
            {item.source === "MAIL" ? "Levél" : "NAV"}
          </PilotBadge>
        </div>
      ),
    },
    {
      id: "supplier",
      header: "Beszállító",
      width: "22%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {item.supplierName}
        </span>
      ),
    },
    {
      id: "arrived",
      header: "Érkezett",
      width: "12%",
      cell: (item) => (
        <span className="text-pilot-grey-600">
          {formatDate(item.arrivedAt)}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Nettó összeg",
      align: "right",
      width: "14%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(item.netTotal, item.currency)}
        </span>
      ),
    },
    {
      id: "stage",
      header: "Állapot",
      width: "18%",
      cell: (item) => (
        <PilotBadge variant={STAGE_BADGE[item.stage]}>
          {STAGE_LABEL[item.stage]}
        </PilotBadge>
      ),
    },
    {
      id: "lines",
      header: "Tételek",
      align: "right",
      width: "13%",
      cell: (item) => (
        <span className="text-sm text-pilot-blue-700">
          {item.lineCount === null
            ? "—"
            : item.suggestedLineCount
              ? `${item.lineCount} tétel (${item.suggestedLineCount} javaslattal)`
              : `${item.lineCount} tétel`}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            align: "right" as const,
            width: "9%",
            cell: (item: ExpectedArrivalListItem) =>
              dismissable(item) ? (
                // a sor kattintása és Enterje a szerkesztőt nyitná
                <span
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <PilotButton
                    variant="ghost"
                    disabled={busyId === item.id}
                    onClick={() => props.onMove(item.id, "dismiss")}
                  >
                    Nem kell
                  </PilotButton>
                </span>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Várható beérkezések"
        description="A beérkezett, de még be nem vételezett beszállítói számlák. Válassz egyet a bevételezéshez: a szerkesztő előtöltve nyílik."
        actions={
          canManage ? (
            <>
              {props.mailStatus?.canRunNow ? (
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={props.onSync}
                  disabled={props.syncing}
                >
                  {props.syncing ? "Ellenőrzés..." : "Levelek ellenőrzése"}
                </PilotButton>
              ) : null}
              <PilotButton size="regular" onClick={props.onNew}>
                Új beszerzés
              </PilotButton>
            </>
          ) : undefined
        }
      />
      <PurchasingTabs active="/beszerzes/varhato" />
      {props.mailStatus ? (
        <p
          className="text-xs text-pilot-grey-500"
          data-testid="levelbehuzas-allapot"
        >
          {mailPullSentence(props.mailStatus)}
        </p>
      ) : null}
      {props.syncNotice ? (
        <Alert
          variant="info"
          title="Ellenőrzés kész"
          description={props.syncNotice}
        />
      ) : null}
      {props.error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={props.error}
          action={
            <Button variant="secondary" onClick={props.onReload}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      <PilotFilterCard
        onClear={
          hasFilters
            ? () => {
                props.setSearch("");
                props.setStage("");
                props.setSource("");
              }
            : undefined
        }
      >
        <div className="min-w-[240px] flex-[2_1_360px]">
          <PilotInput
            aria-label="Keresés a várható beérkezések között"
            value={props.search}
            onChange={props.setSearch}
            leadingIcon={<Icon name="search" size={17} />}
            placeholder="Beszállító, rendelésazonosító, számlaszám…"
            className="h-10"
          />
        </div>
        <PilotSelect
          chevron
          aria-label="Forrás"
          value={props.source}
          onChange={(value) =>
            props.setSource(value as "" | ExpectedArrivalSource)
          }
          className="min-w-[160px] flex-[1_1_180px] [&_select]:h-10"
        >
          <option value="">Minden forrás</option>
          <option value="MAIL">Levélből</option>
          <option value="NAV">NAV</option>
        </PilotSelect>
        <PilotSelect
          chevron
          aria-label="Állapot"
          value={props.stage}
          onChange={(value) => props.setStage(value as "" | Stage)}
          className="min-w-[180px] flex-[1_1_200px] [&_select]:h-10"
        >
          <option value="">Minden állapot</option>
          <option value="INVOICE">Bevételezhető</option>
          <option value="PROFORMA">Csak proforma</option>
          <option value="LATE_CORRECTION">Javított számla érkezett</option>
        </PilotSelect>
      </PilotFilterCard>
      {props.loading && !items ? (
        <div aria-label="Várható beérkezések betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {items ? (
        shown.length ? (
          <PilotListCard
            count={`${shown.length.toLocaleString("hu-HU")} várható beérkezés`}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              totalItems: shown.length,
              totalPages,
            }}
            onPageChange={props.setPage}
          >
            <PilotDataTable
              columns={columns}
              rows={pageItems}
              rowKey={(item) => `${item.source}-${item.id}`}
              rowTestId="varhato-sor"
              onRowActivate={props.onOpen}
              rowCanActivate={(item) => item.editorPath !== null}
              rowLabel={(item) => `${item.supplierName} bevételezése`}
              minWidth={900}
            />
          </PilotListCard>
        ) : (
          <EmptyState
            title={hasFilters ? "Nincs találat" : "Nincs várható beérkezés"}
            description={
              hasFilters
                ? "Módosítsd a keresést vagy a szűrőket."
                : "Minden beérkezett számla be van vételezve."
            }
          />
        )
      ) : null}
      {props.dismissed.length ? (
        <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
          <details data-testid="kivett-tetelek">
            <summary className="cursor-pointer text-sm font-semibold text-pilot-grey-900">
              Kivett tételek ({props.dismissed.length})
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              {props.dismissed.map((item) => (
                <li
                  key={item.id}
                  data-testid="kivett-sor"
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    <span className="font-semibold text-pilot-grey-900">
                      {item.supplierName}
                    </span>{" "}
                    <span className="text-xs text-pilot-grey-600">
                      {item.invoiceNumber ?? item.orderReference ?? "—"}
                    </span>{" "}
                    · {formatAmount(item.netTotal, item.currency)}
                  </span>
                  {canManage ? (
                    <PilotButton
                      variant="secondary"
                      disabled={busyId === item.id}
                      onClick={() => props.onMove(item.id, "restore")}
                    >
                      Visszavétel
                    </PilotButton>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </PilotThemeRoot>
  );
}

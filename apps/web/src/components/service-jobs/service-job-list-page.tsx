"use client";

import {
  Alert,
  PilotDataTable,
  type PilotTableColumn,
  PilotButton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { urlChoice, useUrlQuery } from "@/lib/navigation/use-url-query";
import {
  ServiceIcon,
  ServiceListFooter,
  ServiceListHeader,
  ServiceListTabs,
  ServiceSearchField,
  ServiceStatusBadge,
} from "@/components/service/service-list-chrome";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import {
  ServiceListStats,
  type ServiceStatTile,
} from "@/components/service/service-list-stats";
import { sv } from "@/components/service/service-theme";
import { serviceJobsApi } from "@/lib/api/service-jobs";
// A dátumformázó a munkalapoknál él. Nem másolom ide: két formázó egy
// felületen előbb-utóbb két különböző alakot ad ugyanarra az időpontra.
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import {
  serviceJobStatusLabel,
  serviceJobStatusTone,
} from "./service-job-labels";
import {
  itemsForTab,
  listSummary,
  MAINTENANCE_TABS,
  maintenanceItemsForTab,
  type MaintenanceTab,
  SERVICE_JOB_TABS,
  type ServiceJobTab,
  tabDefinition,
  totalForTab,
} from "./service-job-list-view";

type JobRow = ServiceJobListResponse["items"][number];

export const MAINTENANCE_JOB_TABLE_MIN_WIDTH = 1040;

/*
  A KARBANTARTÁS-LISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a hibajegy címe (a link) a kártya címe, a többi oszlop a felirata mellett.

  A HELYSZÍN TELJES ÚTJA A PARTNER ALATT (Balázs 2026-09-16, a munkalap-listával együtt kérte): enélkül
  ugyanannál a partnernél két jegy megkülönböztethetetlen volt azon a képernyőn, ahol választani kell
  közülük. NINCS SOR, HA NINCS ÚT: egy "Nincs helyszín" felirat többet állítana, mint amit tudunk,
  mert a jegynek lehet helyszíne úgy is, hogy az utat nem tudjuk felépíteni.
  A PARTNER MÁST LÁT, és ez itt is látszik: a belső állapot a jelvényen, a partneré alatta. Enélkül
  a kezelő nem tudja, mit olvas a másik fél.
*/
/**
 * HOVÁ VISZ A KARBANTARTÁS-LISTA SORA: MINDIG A KARBANTARTÁSI LAPRA (Luca, 2026-11-18 14:43:46 UTC; acrobot 55968: „a karbantartási lapra kattintva ne a munkalapra vigyen, hanem
 * magára a lapra”). Az 55781-es kitérő (az egyetlen munkalapos sor a munkalapot nyitotta) megszűnt. A karbantartási lap nem hibajegy: a sor sosem a `/szerviz/hibajegyek` alá visz.
 */
export const maintenanceSheetHref = (job: { id: string }): string =>
  `/szerviz/karbantartas/${job.id}`;

export const MAINTENANCE_JOB_COLUMNS: PilotTableColumn<JobRow>[] = [
  {
    id: "job",
    header: "Karbantartási lap",
    width: "280px",
    cell: (job) => (
      <>
        <Link href={maintenanceSheetHref(job)} className={sv.rowTitle}>
          {job.title}
        </Link>
        <div className={sv.rowMeta}>{job.jobNumber}</div>
        {job.hidden ? (
          <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Rejtett
          </span>
        ) : null}
      </>
    ),
  },
  {
    id: "customer",
    header: "Partner",
    width: "240px",
    cell: (job) => (
      <>
        <div>{job.customerName ?? "Nincs megadva"}</div>
        {job.departmentPath?.length ? (
          <div className={sv.rowMeta}>{job.departmentPath.join(" / ")}</div>
        ) : null}
      </>
    ),
  },
  {
    id: "status",
    header: "Állapot",
    width: "220px",
    // A KARBANTARTÁS ÁLLAPOTA A MUNKALAPOK ALÁÍRÁSÁBÓL JÖN (Balázs, 2026-11-18): minden aláírva = Kész, különben Folyamatban; nincs
    // hibajegy-állapot és partner-állapot sor (a karbantartási lap nem hibajegy). A fajta nélküli/hibajegy sor a régi módon.
    cell: (job) =>
      job.kind === "MAINTENANCE" ? (
        <ServiceStatusBadge tone={job.maintenanceDone ? "green" : "blue"}>
          {job.maintenanceDone ? "Kész" : "Folyamatban"}
        </ServiceStatusBadge>
      ) : (
        <>
          <ServiceStatusBadge tone={serviceJobStatusTone(job.status)}>
            {serviceJobStatusLabel[job.status]}
          </ServiceStatusBadge>
          <div className={`mt-1 ${sv.rowMeta}`}>
            A partner ezt látja: {job.partnerStatusLabel}
          </div>
        </>
      ),
  },
  {
    id: "worksheets",
    header: "Munkalap",
    width: "130px",
    nowrap: true,
    cell: (job) => (
      <span className={sv.tag}>
        <ServiceIcon name="sheet" className="size-[13px] shrink-0" />
        {job.worksheetCount} munkalap
      </span>
    ),
  },
  {
    id: "createdAt",
    header: "Létrehozva",
    width: "170px",
    nowrap: true,
    cell: (job) => (
      <span className={sv.rowMeta}>{formatDateTime(job.createdAt)}</span>
    ),
  },
];

/**
 * A HIBAJEGYEK LISTÁJA, A KÖZÖS SZERVIZ-KÜLSŐVEL.
 *
 * A FEJLÉC, A FÜLEK, A CSEMPÉK, A JELVÉNY ÉS A LÁBLÉC A `components/service/`
 * alól jön, ugyanabból, amit a munkalap- és az eszköz-lista használ. Ez a fájl
 * a saját változatait EL IS DOBTA: három szerviz-lista, egy külső - és a
 * márkaszín egyetlen fájlban áll, nem háromban.
 *
 * AMI ITT MARAD, MERT A HIBAJEGYÉ: hogy melyik fül mit kér a szervertől, és
 * hogy a számok honnan jönnek.
 */
export function ServiceJobListPage({
  kind = "REPAIR",
}: {
  kind?: "REPAIR" | "MAINTENANCE";
}) {
  const { session } = useAuth();
  /*
    A FÜL, A KERESÉS ÉS A REJTETTEK KAPCSOLÓJA AZ URL-BEN (Balázs kérése,
    2026-09-30): a jegyről visszalépve a lista ugyanott áll. A gépelt szöveg
    helyi, a KÉSLELTETETT keresés viszont az URL-be kerül: az az, amit a lista
    ténylegesen lekérdez.
  */
  const { params, update } = useUrlQuery();
  const maintenance = kind === "MAINTENANCE";
  // a karbantartás saját fülei (a jelvény logikája), a hibajegyé a régi
  const tabs: { id: ServiceJobTab | MaintenanceTab; label: string }[] =
    maintenance ? MAINTENANCE_TABS : SERVICE_JOB_TABS;
  const defaultTab = maintenance ? "progress" : "open";
  const tab = urlChoice<ServiceJobTab | MaintenanceTab>(
    params,
    "tab",
    tabs.map((entry) => entry.id),
    defaultTab,
  );
  const appliedSearch = params.get("q") ?? "";
  const includeHidden = params.get("hidden") === "1";
  const [search, setSearch] = useState(appliedSearch);
  const setTab = (next: ServiceJobTab | MaintenanceTab) =>
    update({ tab: next === defaultTab ? null : next });
  const [data, setData] = useState<ServiceJobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  /**
   * A REJTES SAJAT JOG, ES NEM A `canManage`.
   *
   * Balazs kerese, 2026-09-18 11:09 UTC, mar eles hasznalat kozben: "a gomb
   * ottmarad es megnyomhato barmelyik lapnal, jegynel. Azt szeretnem, hogy csak
   * admin jogos felhasznalonal jelenjen meg".
   *
   * A `SERVICE_MANAGE` a napi szerviz-munka jogkore: a sajat szerelo
   * kollegaink ES a partner-fiokok is viselik. A `SERVICE_HIDE` csak OWNER es
   * ADMIN.
   *
   * ES EZ CSAK A FELULET. A vegpont a felulet nelkul is hivhato, ezert a
   * szerver is kapuz (`RequirePermissions(SERVICE_HIDE)` plusz a szolgaltatas
   * sajat ellenorzese). Egy UI-only kapu nem kapu.
   */
  const canHide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_HIDE),
  );
  const token = session?.token ?? "";
  // the maintenance tabs filter the badge's field on the client: the list asks for everything
  const scope = maintenance ? "all" : tabDefinition(tab as ServiceJobTab).scope;

  /*
    A GÉPELÉS NEM KÉRÉSENKÉNT MEGY LE. A keresés a SZERVEREN szűr, tehát minden
    leütés egy lekérdezés lenne - a késleltetés nem szépészet, hanem az, hogy a
    lista ne villogjon félig begépelt szavakra.
  */
  useEffect(() => {
    const timer = setTimeout(() => update({ q: search.trim() || null }), 250);
    return () => clearTimeout(timer);
  }, [search, update]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(
          await serviceJobsApi.list(
            token,
            scope,
            signal,
            appliedSearch,
            includeHidden,
            kind,
          ),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : kind === "MAINTENANCE"
                ? "A karbantartási lapok nem tölthetők be."
                : "A hibajegyek nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [appliedSearch, canView, includeHidden, kind, scope, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const items = useMemo(
    () =>
      data
        ? maintenance
          ? maintenanceItemsForTab(data.items, tab as MaintenanceTab)
          : itemsForTab(data.items, tab as ServiceJobTab)
        : [],
    [data, maintenance, tab],
  );
  const summary = data ? listSummary(data.counts) : null;

  // What this list holds, in words: the maintenance list used to say "hibajegy" everywhere.
  const thing = kind === "MAINTENANCE" ? "karbantartási lap" : "hibajegy";

  /**
   * A HÁROM CSEMPE SZÁMA A TELJES HALMAZBÓL JÖN, nem a betöltött lapból - ezért
   * ad a szerver állapotonkénti darabszámot. Amíg nincs válasz, `null` áll
   * bennük: egy nulla azt állítaná, hogy nincs ilyen jegy, és aki ezt látja,
   * nem keres tovább.
   */
  const tiles: ServiceStatTile[] = [
    {
      key: "open",
      icon: "wrench",
      tone: "purple",
      label: `Nyitott ${thing}`,
      count: summary?.open ?? null,
    },
    {
      key: "waiting",
      icon: "clock",
      tone: "amber",
      label: "Válaszra vagy alkatrészre vár",
      count: summary?.waiting ?? null,
    },
    {
      key: "closed",
      icon: "sheet",
      tone: "green",
      label: "Lezárt ügy",
      count: summary?.closed ?? null,
    },
  ];

  if (!canView)
    return (
      <Alert
        variant="danger"
        title={
          kind === "MAINTENANCE"
            ? "Nincs hozzáférésed a karbantartási lapokhoz"
            : "Nincs hozzáférésed a hibajegyekhez"
        }
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <div>
      <ServiceOfflineNotice
        state={data ? { kind: "loaded" } : { kind: "empty" }}
      />
      <ServiceListHeader
        eyebrow="Szerviz / Munkatér"
        title={kind === "MAINTENANCE" ? "Karbantartás" : "Hibajegyek"}
        lead={
          kind === "MAINTENANCE"
            ? "A karbantartási lapok a szervizmunka életútját és a hozzájuk kapcsolt munkalapokat egy helyen tartják."
            : "Minden bejelentésnek legyen következő lépése. A hibajegy a lánc első eleme: mögötte állnak a munkalapok."
        }
        action={
          canManage ? (
            <Link
              href={
                kind === "MAINTENANCE"
                  ? "/szerviz/karbantartas/uj"
                  : "/szerviz/hibajegyek/uj"
              }
            >
              <PilotButton>
                <ServiceIcon name="plus" className="mr-1.5 size-[17px]" />
                {kind === "MAINTENANCE"
                  ? "Új karbantartási lap"
                  : "Új hibajegy"}
              </PilotButton>
            </Link>
          ) : undefined
        }
      />
      {error ? (
        <div className="mb-6">
          <Alert
            variant="danger"
            title="Betöltési hiba"
            description={error}
            action={
              <PilotButton variant="secondary" onClick={() => void load()}>
                Újrapróbálás
              </PilotButton>
            }
          />
        </div>
      ) : null}
      {/* a hibajegy-állapot szerinti csempék a karbantartási listán nem jelennek meg (nincs állapotgép) */}
      {kind === "MAINTENANCE" ? null : (
        <ServiceListStats
          tiles={tiles}
          active={tab}
          onSelect={(key) => setTab(key as ServiceJobTab)}
          label="Hibajegyek állapot szerint"
        />
      )}
      <div className={sv.panel}>
        <ServiceListTabs
          tabs={tabs.map((entry) => ({
            key: entry.id,
            label: entry.label,
          }))}
          active={tab}
          onSelect={(key) => setTab(key as ServiceJobTab | MaintenanceTab)}
          label={
            kind === "MAINTENANCE"
              ? "Karbantartások szűrése"
              : "Hibajegyek szűrése"
          }
        />
        <div className={sv.toolbar}>
          <ServiceSearchField
            label={
              kind === "MAINTENANCE"
                ? "Karbantartás keresése"
                : "Hibajegy keresése"
            }
            placeholder={
              kind === "MAINTENANCE"
                ? "Munkaszám, partner vagy cím"
                : "Hibajegyszám, partner vagy hiba"
            }
            value={search}
            onChange={setSearch}
          />
          {/* A jelolo CSAK annak latszik, aki vissza is tudja allitani a
              rejtett jegyeket: egy nezo szamara a hosszabb lista magyarazat
              nelkul maradna. */}
          {canHide ? (
            <PilotButton
              variant={includeHidden ? "primary" : "secondary"}
              onClick={() => update({ hidden: includeHidden ? null : "1" })}
            >
              {includeHidden ? "Rejtettek nélkül" : "Rejtettek is"}
            </PilotButton>
          ) : null}
        </div>
        {loading && !data ? (
          <p className="px-5 py-8 text-xs text-muted">
            {kind === "MAINTENANCE"
              ? "Karbantartási lapok betöltése..."
              : "Hibajegyek betöltése..."}
          </p>
        ) : null}
        {data && items.length ? (
          <>
            <PilotDataTable
              columns={MAINTENANCE_JOB_COLUMNS}
              rows={items}
              rowKey={(job) => job.id}
              rowTestId="maintenance-job-row"
              minWidth={MAINTENANCE_JOB_TABLE_MIN_WIDTH}
            />
            {/*
              NEM LAPOZO LISTA: a szerver egy hataron belul ad sorokat, es a
              `truncated` mondja meg, ha van tobb. Korabban ide ket ertelmetlen
              szam kerult (lapszam es osszes lap, mindketto egy), plusz egy
              szoveg-felulíras. A `tail` a ket allapotot kulon agra teszi, tehat
              a "vegere ertel" mondat ezen a listan ki sem mondhato.
            */}
            <ServiceListFooter
              shown={items.length}
              totalItems={
                maintenance
                  ? items.length
                  : totalForTab(data.counts, tab as ServiceJobTab)
              }
              tail={{ kind: "capped", truncated: data.truncated }}
            />
          </>
        ) : null}
        {data && !items.length ? (
          <p className="px-5 py-10 text-center text-xs text-muted">
            {appliedSearch
              ? `Erre a keresésre nincs ${thing} ezen a fülön.`
              : tab === "open"
                ? `Nyitott ${thing} jelenleg nincs. A lezártakat a fenti füleken nézheted meg.`
                : tab === "progress"
                  ? "Folyamatban lévő karbantartási lap jelenleg nincs. A készeket a fenti füleken nézheted meg."
                  : `Ezen a fülön most nincs ${thing}.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

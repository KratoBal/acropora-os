"use client";

import { Alert, Button } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
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
  SERVICE_JOB_TABS,
  type ServiceJobTab,
  tabDefinition,
  totalForTab,
} from "./service-job-list-view";

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
export function ServiceJobListPage() {
  const { session } = useAuth();
  const [tab, setTab] = useState<ServiceJobTab>("open");
  const [search, setSearch] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [appliedSearch, setAppliedSearch] = useState("");
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
  const { scope } = tabDefinition(tab);

  /*
    A GÉPELÉS NEM KÉRÉSENKÉNT MEGY LE. A keresés a SZERVEREN szűr, tehát minden
    leütés egy lekérdezés lenne - a késleltetés nem szépészet, hanem az, hogy a
    lista ne villogjon félig begépelt szavakra.
  */
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

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
          ),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegyek nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [appliedSearch, canView, includeHidden, scope, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const items = useMemo(
    () => (data ? itemsForTab(data.items, tab) : []),
    [data, tab],
  );
  const summary = data ? listSummary(data.counts) : null;

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
      label: "Nyitott hibajegy",
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
        title="Nincs hozzáférésed a hibajegyekhez"
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
        title="Hibajegyek"
        lead="Minden bejelentésnek legyen következő lépése. A hibajegy a lánc első eleme: mögötte állnak a munkalapok."
        action={
          canManage ? (
            <Link href="/szerviz/hibajegyek/uj">
              <Button>
                <ServiceIcon name="plus" className="mr-1.5 size-[17px]" />
                Új hibajegy
              </Button>
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
              <Button variant="secondary" onClick={() => void load()}>
                Újrapróbálás
              </Button>
            }
          />
        </div>
      ) : null}
      <ServiceListStats
        tiles={tiles}
        active={tab}
        onSelect={(key) => setTab(key as ServiceJobTab)}
        label="Hibajegyek állapot szerint"
      />
      <div className={sv.panel}>
        <ServiceListTabs
          tabs={SERVICE_JOB_TABS.map((entry) => ({
            key: entry.id,
            label: entry.label,
          }))}
          active={tab}
          onSelect={(key) => setTab(key as ServiceJobTab)}
          label="Hibajegyek szűrése"
        />
        <div className={sv.toolbar}>
          <ServiceSearchField
            label="Hibajegy keresése"
            placeholder="Hibajegyszám, partner vagy hiba"
            value={search}
            onChange={setSearch}
          />
          {/* A jelolo CSAK annak latszik, aki vissza is tudja allitani a
              rejtett jegyeket: egy nezo szamara a hosszabb lista magyarazat
              nelkul maradna. */}
          {canHide ? (
            <Button
              variant={includeHidden ? "primary" : "secondary"}
              onClick={() => setIncludeHidden((elozo) => !elozo)}
            >
              {includeHidden ? "Rejtettek nélkül" : "Rejtettek is"}
            </Button>
          ) : null}
        </div>
        {loading && !data ? (
          <p className="px-5 py-8 text-xs text-muted">
            Hibajegyek betöltése...
          </p>
        ) : null}
        {data && items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr>
                    <th className={sv.tableHead}>Hibajegy</th>
                    <th className={sv.tableHead}>Partner</th>
                    <th className={sv.tableHead}>Állapot</th>
                    <th className={sv.tableHead}>Munkalap</th>
                    <th className={sv.tableHead}>Létrehozva</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((job) => (
                    <tr key={job.id} className={sv.tableRow}>
                      <td className={sv.tableCell}>
                        <Link
                          href={`/szerviz/hibajegyek/${job.id}`}
                          className={sv.rowTitle}
                        >
                          {job.title}
                        </Link>
                        <div className={sv.rowMeta}>{job.jobNumber}</div>
                        {job.hidden ? (
                          <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            Rejtett
                          </span>
                        ) : null}
                      </td>
                      <td className={sv.tableCell}>
                        <div>{job.customerName ?? "Nincs megadva"}</div>
                        {/*
                          A HELYSZIN TELJES UTJA A PARTNER ALA.

                          Ez a lista eddig SEMMIT nem mondott a helyszinrol.
                          Ugyanannal a partnernel ket jegy tehat
                          megkulonboztethetetlen volt pont azon a kepernyon,
                          ahol valasztani kell kozuluk. Balazs 2026-09-16-an a
                          munkalap-listara kerte a teljes utat, es ugyanabban a
                          mondatban ide is.

                          NINCS SOR, HA NINCS UT. Egy "Nincs helyszin" felirat
                          tobbet allitana, mint amit tudunk: a jegynek lehet
                          helyszine ugy is, hogy az utat nem tudjuk felepiteni.
                        */}
                        {job.departmentPath?.length ? (
                          <div className={sv.rowMeta}>
                            {job.departmentPath.join(" / ")}
                          </div>
                        ) : null}
                      </td>
                      <td className={sv.tableCell}>
                        <ServiceStatusBadge
                          tone={serviceJobStatusTone(job.status)}
                        >
                          {serviceJobStatusLabel[job.status]}
                        </ServiceStatusBadge>
                        {/* A PARTNER MÁST LÁT, és ez itt is látszik: a belső
                            állapot a jelvényen, a partneré alatta. Enélkül a
                            kezelő nem tudja, mit olvas a másik fél. */}
                        <div className={`mt-1 ${sv.rowMeta}`}>
                          A partner ezt látja: {job.partnerStatusLabel}
                        </div>
                      </td>
                      <td className={sv.tableCell}>
                        <span className={sv.tag}>
                          <ServiceIcon
                            name="sheet"
                            className="size-[13px] shrink-0"
                          />
                          {job.worksheetCount} munkalap
                        </span>
                      </td>
                      <td className={sv.tableCell}>
                        <span className={sv.rowMeta}>
                          {formatDateTime(job.createdAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/*
              NEM LAPOZO LISTA: a szerver egy hataron belul ad sorokat, es a
              `truncated` mondja meg, ha van tobb. Korabban ide ket ertelmetlen
              szam kerult (lapszam es osszes lap, mindketto egy), plusz egy
              szoveg-felulíras. A `tail` a ket allapotot kulon agra teszi, tehat
              a "vegere ertel" mondat ezen a listan ki sem mondhato.
            */}
            <ServiceListFooter
              shown={items.length}
              totalItems={totalForTab(data.counts, tab)}
              tail={{ kind: "capped", truncated: data.truncated }}
            />
          </>
        ) : null}
        {data && !items.length ? (
          <p className="px-5 py-10 text-center text-xs text-muted">
            {appliedSearch
              ? "Erre a keresésre nincs hibajegy ezen a fülön."
              : tab === "open"
                ? "Nyitott hibajegy jelenleg nincs. A lezártakat a fenti füleken nézheted meg."
                : "Ezen a fülön most nincs hibajegy."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

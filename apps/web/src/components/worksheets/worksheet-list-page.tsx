"use client";

import { Alert, Avatar, Button, EmptyState, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetListResponse,
  type WorksheetSelectablePartner,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
  ServiceListStats,
  type ServiceStatTile,
} from "@/components/service/service-list-stats";
import { sv } from "@/components/service/service-theme";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  formatDateTime,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
  worksheetStatusTone,
} from "./worksheet-labels";

const TABS = [
  { key: "all", label: "Összes" },
  { key: "DRAFT", label: "Piszkozat" },
  { key: "AWAITING_SIGNATURE", label: "Aláírásra vár" },
  { key: "SIGNED", label: "Aláírva" },
  { key: "REJECTED", label: "Elutasítva" },
];

export function WorksheetListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<WorksheetListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [partners, setPartners] = useState<WorksheetSelectablePartner[]>([]);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";
  const userId = session?.user.id ?? "";
  const mineOnly = params.get("assigneeId") === userId && Boolean(userId);
  const activeStatus = params.get("status") ?? "";

  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", "25");
    return value;
  }, [params]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await worksheetsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalapok nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, query, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * A PARTNER-VALASZTO A MEGNYITHATO PARTNEREK LISTAJAT KERI, nem a lapokon
   * szereplo nevekbol epul. Az utobbi csak azokat kinalna, amik EPP LATSZANAK
   * az aktualis lapon -- vagyis a szuro pont azt nem tudna felkinalni, amire a
   * felhasznalo szurni akar. Ha a hivas elhasal, a valaszto nem jelenik meg, a
   * lista tovabb mukodik.
   */
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void worksheetsApi
      .selectablePartners(token, controller.signal)
      .then((response) => setPartners(response.items))
      .catch(() => setPartners([]));
    return () => controller.abort();
  }, [canView, token]);

  /**
   * A CSEMPEK SZAMAI A LISTA SAJAT VALASZAN ERKEZNEK.
   *
   * Eddig harom KULON lista-hivas adta oket, es a sajat hookom fejlecebe magam
   * irtam oda, hogy ez nem a vegso alak. Mostantol a szerver szamolja,
   * ugyanabban a valaszban -- es ott a munkalap allapota a LEGUTOLSO VERZIOE,
   * ugyanaz a szabaly, ami a sorokat is valogatja.
   *
   * AMI VALTOZOTT, PONTOSAN: harom egymas utani korbol egy keresen beluli
   * parhuzamos futas lett, tehat az ablak masodpercekbol ezredmasodpercekre
   * szukult, es a HAROM CSEMPE mar nem tud egymasnak ellentmondani (egy
   * lekerdezesbol jonnek).
   *
   * AMI NEM VALTOZOTT: ez NEM egy adatbazis-pillanatkep. A lista es a
   * szamlalo kulon lekerdezes, sajat pillanatkeppel -- sot a szamlalo maga is
   * KETTO (a szurt azonositok, majd a legutolso verziok csoportositasa).
   * Egyideju modositas mellett a csempek es a sorok elterhetnek egy tetellel,
   * es a kovetkezo betoltesnel helyreall. Ha ez valaha nem elfogadhato, a
   * megoldas egy kozos tranzakcio, nem egy ujabb komment.
   *
   * ES A HATAR, AMI EZT ELDONTI -- NEM AZ EZREDMASODPERC, HANEM A SZAM SZEREPE
   * (acrobot dontese, 2026-09-15): amig a szam CSAK TAJEKOZTAT, ez a
   * kulonbseg nem szamit. Ha a szambol valaha MUVELET lesz -- "kijelolom mind
   * a szazhuszonhetet", vagy export, aminek a fejlecebe beirjuk, hogy ennyi
   * van --, AKKOR kell a kozos pillanat, mert akkor a szam IGERETTE valik.
   *
   * Ez feltetel, nem elvi allaspont. E nelkul a kovetkezo olvaso ugy erti,
   * hogy a kozos tranzakcio ELVBOL nem kell, es nem fogja eszrevenni, amikor
   * a feltetel megfordul alatta.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search === (params.get("search") ?? "")) return;
      const next = new URLSearchParams(params.toString());
      if (search) next.set("search", search);
      else next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search]);

  /** Szűrő váltása mindig az első oldalra ugrik: a 4. oldal egy másik
   * szűrővel általában nem is létezik. */
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  /**
   * A CSEMPE ES A FUL UGYANAZT IRJA, es a csempe VISSZA is kapcsol: masodszorra
   * megnyomva az "Összes" allapotba tesz. Enelkul egy kivalasztott csempe
   * `aria-pressed="true"` allapotban ragadna, amit csak a fulsorbol lehetne
   * feloldani -- egy nyomogomb, ami csak befele kattint, nem nyomogomb.
   */
  const selectStatus = (key: string) => {
    filter("status", key === "all" || key === activeStatus ? "" : key);
  };

  /** A lapozás KÜLÖN függvény, és ez nem stílus: a `filter` a végén
   * mindig `page=1`-et ír, tehát rajta keresztül lapozva a "Következő"
   * gomb csendben az első oldalra vinne. */
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a munkalapokhoz"
        description="service.view jogosultság szükséges."
      />
    );

  const counts = data?.counts ?? null;
  const tiles: ServiceStatTile[] = [
    {
      key: "DRAFT",
      icon: "edit",
      tone: "purple",
      label: "Szerkesztés alatt",
      count: counts?.DRAFT ?? null,
    },
    {
      key: "AWAITING_SIGNATURE",
      icon: "clock",
      tone: "amber",
      label: "Aláírásra vár",
      count: counts?.AWAITING_SIGNATURE ?? null,
    },
    {
      key: "SIGNED",
      icon: "checkCircle",
      tone: "green",
      label: "Aláírt munkalap",
      count: counts?.SIGNED ?? null,
    },
  ];

  return (
    <div>
      <ServiceOfflineNotice
        state={data ? { kind: "loaded" } : { kind: "empty" }}
      />
      <ServiceListHeader
        eyebrow="Szerviz / munkatér"
        title="Munkalapok"
        lead="A helyszíni munkától az aláírásig. A sorszám a lezáráskor keletkezik, piszkozatnak nincs száma."
        action={
          canManage ? (
            <Link href="/szerviz/munkalapok/uj">
              <Button>
                <ServiceIcon name="plus" className="mr-1.5 size-[17px]" />
                Új munkalap
              </Button>
            </Link>
          ) : undefined
        }
      />
      {error ? (
        <Alert
          className="mb-6"
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
      <ServiceListStats
        tiles={tiles}
        active={activeStatus}
        onSelect={selectStatus}
        label="Munkalapok állapot szerint"
      />
      <section className={sv.panel}>
        <ServiceListTabs
          tabs={TABS}
          active={activeStatus || "all"}
          onSelect={selectStatus}
          label="Munkalapok szűrése állapot szerint"
        />
        <div className={sv.toolbar}>
          <ServiceSearchField
            label="Munkalap keresése"
            placeholder="Munkalapszám, partner vagy tárgy"
            value={search}
            onChange={setSearch}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            {partners.length ? (
              <label>
                <span className="sr-only">Partner szűrő</span>
                <select
                  className={sv.select}
                  value={params.get("customerId") ?? ""}
                  onChange={(event) => filter("customerId", event.target.value)}
                >
                  <option value="">Minden partner</option>
                  {partners.map((partner) => (
                    <option key={partner.customerId} value={partner.customerId}>
                      {partner.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              variant={mineOnly ? "primary" : "secondary"}
              disabled={!userId}
              onClick={() => filter("assigneeId", mineOnly ? "" : userId)}
            >
              {mineOnly ? "Minden munkalap" : "Csak amit rám osztottak"}
            </Button>
          </div>
        </div>
        {loading && !data ? (
          <div className="space-y-3 p-5" aria-label="Munkalapok betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : null}
        {data?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead>
                  <tr>
                    <th className={sv.tableHead}>Munkalap</th>
                    <th className={sv.tableHead}>Partner</th>
                    <th className={sv.tableHead}>Felelős</th>
                    <th className={sv.tableHead}>Állapot</th>
                    {/* A "Bruttó" oszlop 2026-09-17-én kikerült: Balázs
                        döntése ("B") szerint az ár sehol nem jelenik meg. */}
                    <th className={sv.tableHead}>Módosítva</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((worksheet) => (
                    <tr key={worksheet.id} className={sv.tableRow}>
                      <td className={sv.tableCell}>
                        {/* A TARGY A CIM, A SZAM A MASODSOR -- a designbol, es
                            ez forditva volt. A kollega a munka TARGYARA
                            emlekszik, a sorszamot legfeljebb visszakeresi; egy
                            azonositokbol allo oszlopot vegig kell olvasni
                            ahhoz, hogy barmit megtalaljon benne. */}
                        <Link
                          href={`/szerviz/munkalapok/${worksheet.id}`}
                          className={sv.rowTitle}
                        >
                          {worksheet.subject}
                        </Link>
                        <span className={`mt-1 block ${sv.rowMeta}`}>
                          {worksheetLabelOrDraft(worksheet.label)}
                          {worksheet.versionCount > 1
                            ? ` · ${worksheet.versionCount} verzió`
                            : ""}
                        </span>
                      </td>
                      <td className={sv.tableCell}>
                        <div className="text-xs font-medium text-ink">
                          {worksheet.customerName}
                        </div>
                        {/*
                          A TELJES UT, HA A SZERVER KULDI, KULONBEN A KOD.

                          Eddig itt a kod allt magaban (`NMD`), es Balazs pont
                          ezt fotozta le 2026-09-16-an. A kod csak TESTVEREK
                          kozott egyedi, tehat ket tavoli ag alatt ugyanaz a
                          `NMD` megengedett -- a listan pedig egymas ala kerul
                          ket olyan sor, amit igy nem lehet megkulonboztetni.

                          A VISSZAESES A REGI ALAK, nem ures cella: ha az utat
                          nem tudjuk felepiteni, ugyanaz latszik, mint eddig.
                        */}
                        <div className={sv.rowMeta}>
                          {worksheet.departmentPath?.length
                            ? worksheet.departmentPath.join(" / ")
                            : worksheet.departmentCode}
                        </div>
                      </td>
                      <td className={sv.tableCell}>
                        {worksheet.assigneeNames[0] ? (
                          <span className="flex items-center gap-2">
                            <Avatar
                              size="sm"
                              name={worksheet.assigneeNames[0]}
                              className="bg-brand-100 text-brand-ink ring-0"
                            />
                            <span className="text-xs text-ink">
                              {worksheet.assigneeNames.join(", ")}
                            </span>
                          </span>
                        ) : (
                          <span className={sv.rowMeta}>Nincs kiosztva</span>
                        )}
                      </td>
                      <td className={sv.tableCell}>
                        <ServiceStatusBadge
                          tone={worksheetStatusTone(worksheet.status)}
                        >
                          {worksheetStatusLabel[worksheet.status]}
                        </ServiceStatusBadge>
                      </td>
                      {/* A DESIGN ITT "Arazasra var"-t mutat a meg nem arazott
                          lapra, ES EZT A LISTA MA NEM TUDJA KIIRNI. A szerver a
                          fejlec osszeget a MAR ARAZOTT sorokbol adja ossze
                          (`sumWorksheetAmounts`), tehat egy teljesen arazatlan
                          lap "0 Ft"-ot kuld -- beture ugyanazt, mint egy
                          valoban ingyenes munka. A kulonbseg a sorokban van, a
                          lista viszont nem kapja meg oket. Kitalalni nem
                          szabad: a kartyan kulon tetel, es a vegpont donti el. */}
                      <td className={`${sv.tableCell} ${sv.rowMeta}`}>
                        {formatDateTime(worksheet.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ServiceListFooter
              shown={data.items.length}
              totalItems={data.pagination.totalItems}
              tail={{
                kind: "paged",
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
              }}
            />
          </>
        ) : data ? (
          <div className="p-5">
            <EmptyState
              title="Nincs munkalap"
              description={
                mineOnly
                  ? "Rád jelenleg nincs munkalap kiosztva."
                  : "Módosítsd a keresést, vagy vegyél fel új munkalapot."
              }
            />
          </div>
        ) : null}
      </section>
      {data ? (
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={data.pagination.page <= 1}
            onClick={() => goToPage(data.pagination.page - 1)}
          >
            Előző
          </Button>
          <span className="self-center text-sm">
            {data.pagination.page} / {Math.max(1, data.pagination.totalPages)}
          </span>
          <Button
            variant="secondary"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => goToPage(data.pagination.page + 1)}
          >
            Következő
          </Button>
        </div>
      ) : null}
    </div>
  );
}

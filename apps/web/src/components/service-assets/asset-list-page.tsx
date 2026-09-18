"use client";

import { Alert, Button, EmptyState, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AssetListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { buildSiteOptions, buildSiteTree } from "@/lib/partners/site-tree";
import { suppliersApi } from "@/lib/api/suppliers";
import {
  readUnitFilter,
  toggleUnitFilter,
  writeUnitFilter,
} from "@/lib/partners/unit-filter";

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
import { assetsApi } from "@/lib/api/assets";
import {
  assetKindLabel,
  assetStatusLabel,
  assetStatusTone,
} from "./asset-labels";

const TABS = [
  { key: "ALL", label: "Összes" },
  /**
   * A BEEPITETT: minden, KIVEVE a kivezetetteket. Balazs kerese, 2026-09-16,
   * szo szerint: "ide szeretnek egy Beepitett opciot meg amiben minden benne
   * van kiveve a kivezetett eszkozok".
   *
   * AZ OSSZES UTAN ALL, ES NEM A SOR VEGEN: a ketto ugyanazt a kerdest
   * valaszolja meg ("mit latok egyszerre"), csak masik hatarral -- egymas
   * mellett a kulonbseguk latszik, a sor vegen egy negyedik allapot-szuronek
   * nezne ki.
   */
  { key: "IN_PLACE", label: "Beépített" },
  { key: "ACTIVE", label: "Aktív" },
  { key: "IN_REPAIR", label: "Javítás alatt" },
  { key: "WARM_STANDBY", label: "Meleg tartalék" },
  { key: "COLD_STANDBY", label: "Hideg tartalék" },
  { key: "RETIRED", label: "Kivezetett" },
];

/**
 * HANY ESZKOZ EGY OLDALON -- KOTOTT HAROM ERTEK, NEM SZABAD SZAM.
 *
 * Balazs kerese (2026-09-18): "a lista tetejere egy olyan legordulo, hogy hany
 * eszkoz jelenjen meg egy oldalon. itt lehetne 25, 50, 100".
 *
 * ES AZERT KOTOTT, MERT A SZERVERNEK FELSO HATARA VAN: a vegpont `@Max(100)`-at
 * ker (`asset.dto.ts`). Egy szabadon beirt 200 nem tobb sort adna, hanem
 * VALIDACIOS HIBAT -- a kezelo pedig nem ertene, miert. A harom ertek mind a
 * hataron BELUL all, a 100 epp rajta.
 */
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = String(PAGE_SIZES[0]);

export function AssetListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<AssetListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";
  /**
   * A FELULET SZANDEKOSAN MAST KULD, MINT A SZERVER SAJAT ALAPERTELMEZESE.
   *
   * A szerver parameter nelkul `ACTIVE`-ra szur, tehat a hianyzo ertek NEM
   * "osszes" -- ez valtozatlanul igaz, es ezert kuldunk MINDIG erteket.
   *
   * AMIT KULDUNK, AZ VISZONT `IN_PLACE` (Balazs kerese, 2026-09-18: "ha
   * betoltom az eszkozok listat akkor a beepitett legyen alapbol kivalasztva").
   * A ketto elterese NEM elirás: ha valaki "javitja" vissza `ACTIVE`-ra, a lista
   * mast fog mutatni elso betolteskor, mint amit Balazs kert.
   */
  const activeStatus = params.get("status") ?? "IN_PLACE";
  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", DEFAULT_PAGE_SIZE);
    if (!value.has("status")) value.set("status", "IN_PLACE");
    return value;
  }, [params]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await assetsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az eszközlista nem tölthető be.",
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
   * A CSEMPEK SZAMAI A LISTA SAJAT VALASZAN ERKEZNEK.
   *
   * Eddig harom KULON lista-hivas adta oket (a legkisebb lapmerettel, csak a
   * `pagination.totalItems` erdekelt) -- a sajat hookom fejlecebe magam irtam
   * oda, hogy ez nem a vegso alak. Mostantol a szerver egyetlen `groupBy`-jal
   * szamolja, ugyanabban a valaszban: harom keresbol nulla lett.
   *
   * ES NEM CSAK OLCSOBB, HANEM PONTOSABB IS -- de PONTOSAN ANNYIVAL, AMENNYIVEL.
   * A harom kulon hivas harom EGYMAS UTANI korben futott: a csempek kozott
   * masodpercek is elteltek, es ha kozben barki mozdított egy eszkozon, ket
   * csempe egymasnak is ellentmondhatott.
   *
   * AMIT EZ NEM AD MEG, ES KORABBAN TULALLITOTTAM ITT: ez NEM egy
   * adatbazis-pillanatkep. A lista, a darabszam es a csempek harom KULON
   * lekerdezes, `Promise.all`-lal -- egy keresen belul, de sajat
   * pillanatkeppel. Egyideju modositas mellett a csempek es a sorok tovabbra
   * is elterhetnek egy tetellel, es a kovetkezo betoltesnel helyreall.
   *
   * AMI VALTOZOTT: az ablak MERETE. Harom egymas utani korbol egy keresen
   * beluli parhuzamos futasra szukult -- masodpercekbol ezredmasodpercekre.
   * Az eltunt, hogy a KET CSEMPE egymasnak ellentmondjon (azok most egy
   * `groupBy`-bol jonnek); ami megmaradt, az a csempek es a sorok kozotti,
   * atmeneti egy-tetelnyi elteres.
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
      search ? next.set("search", search) : next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search]);
  /**
   * A VALASZTO CSAK SZERVIZ-PARTNER TULAJDONOSNAL JELENIK MEG, es ez nem
   * egyszerusites: az alegysegek a PARTNEREN at erhetok el (`/suppliers/:id/units`,
   * a partner tukor-vevojen lognak), globalis alegyseg-lista NINCS. Az eszkoz-lista
   * viszont tobb tulajdonos eszkozeit mutatja, tehat tulajdonos nelkul a valaszto
   * nem tudna mit felkinalni. Merve 2026-08-31.
   */
  /**
   * A RENDEZES A CIMBEN LAKIK, mint a tobbi szuro -- es ez nem stilus: a lap
   * a `params` tartalmat ADJA TOVABB a szervernek (lasd a `query` memot),
   * tehat ami a cimbe kerul, az magatol eljut a lekerdezesig. Igy a rendezett
   * lista MEGOSZTHATO es visszatolthetó, nem egy elveszo komponens-allapot.
   *
   * A HARMADIK KOPPINTAS VISSZAAD AZ ALAPERTELMEZESRE, nem egy harmadik
   * iranyt ad. Enelkul nincs UT VISSZA: aki egyszer rendezett, annak a lap
   * onnantol csak a ket sajat iranya kozott valtana, es a "ahogy eredetileg
   * volt" allapot csak kezi cim-szerkesztessel lenne elerheto.
   *
   * A LAPOZAS MINDIG AZ ELSORE ALL VISSZA. Egy masik rendezes MAS sorokat tesz
   * a harmadik lapra; a regi lapszamot megtartva a felhasznalo a lista
   * kozepere esne, latszolag veletlenszeru tartalomra.
   */
  const setSort = useCallback(
    (sort: string) => {
      const next = new URLSearchParams(params.toString());
      const jelenlegi = params.get("sort");
      const irany = params.get("direction") ?? "asc";
      if (jelenlegi !== sort) {
        next.set("sort", sort);
        next.set("direction", "asc");
      } else if (irany === "asc") {
        next.set("direction", "desc");
      } else {
        next.delete("sort");
        next.delete("direction");
      }
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    },
    [params, pathname, router],
  );

  const ownerId = params.get("ownerId") ?? "";
  const unitsOwnerId = params.get("ownerType") === "SUPPLIER" ? ownerId : "";
  const [units, setUnits] = useState<
    Awaited<ReturnType<typeof suppliersApi.units>>["items"]
  >([]);
  useEffect(() => {
    if (!canView || !unitsOwnerId) {
      setUnits([]);
      return;
    }
    const controller = new AbortController();
    void suppliersApi
      .units(token, unitsOwnerId, controller.signal)
      .then((response) => setUnits(response.items))
      // A HELYSZINEK HIANYA NEM TORI EL A LISTAT: a tobbi szuro mukodik
      // tovabb, es a valaszto egyszeruen nem kinal semmit.
      .catch(() => setUnits([]));
    return () => controller.abort();
  }, [canView, token, unitsOwnerId]);
  const selectedUnits = useMemo(() => readUnitFilter(params), [params]);
  /**
   * A FA SORAI, MELYSEGGEL ES TELJES UTTAL EGYUTT.
   *
   * A LATHATO szoveg csak a csomopont NEVE, mert a hierarchiat a behuzas
   * mutatja -- egy 190 pixeles oszlopban a teljes ut ugyis levagodna. A teljes
   * ut viszont NEM veszhet el: a kod es a nev csak TESTVEREK kozott egyedi
   * (`site-tree.ts`), tehat ket tavoli ag alatt allhat ket "Biodóm". Ezert a
   * gomb HOZZAFERHETO NEVE (`aria-label`) es a hover-szovege a teljes ut. Aki
   * lat, a behuzasbol tudja; aki nem, a felolvasottbol.
   */
  const unitRows = useMemo(() => {
    const pathById = new Map(
      buildSiteOptions(units).map((option) => [option.id, option.label]),
    );
    return buildSiteTree(units).map(({ unit, depth }) => ({
      unit,
      depth,
      path: pathById.get(unit.id) ?? unit.name,
    }));
  }, [units]);

  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  /**
   * A CSEMPE ES A FUL UGYANAZT IRJA. Az "ures" ITT NEM jo visszakapcsolt
   * allapot: parameter nelkul a szerver `ACTIVE`-ra szur, tehat egy kikapcsolt
   * csempe csendben az "Aktiv" listat adna vissza. Ezert a visszakapcsolas
   * kifejezetten `ALL`-t ir.
   */
  const selectStatus = (key: string) => {
    filter("status", key === activeStatus ? "ALL" : key);
  };

  /**
   * Paging has to bypass `filter`: that helper ends by resetting the page
   * to 1 (correct for a filter change - page 4 of a different filter
   * usually does not exist), so paging through it sent every click back to
   * the first page and nothing past the first page was reachable at all.
   */
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az eszköznyilvántartáshoz"
        description="service.view jogosultság szükséges."
      />
    );

  const counts = data?.counts ?? null;
  /**
   * AZ "OSSZES" A NEGY ALLAPOT OSSZEGE, es nem egy kulon szam a szerverrol.
   * Igy nem tud elcsuszni: ha egyszer egy uj allapot kerul a rendszerbe, az
   * osszeg magatol tartalmazza, es nem marad ki egy elfelejtett sorbol.
   */
  const total = counts
    ? Object.values(counts).reduce((sum, value) => sum + value, 0)
    : null;
  const tiles: ServiceStatTile[] = [
    {
      key: "ALL",
      icon: "box",
      tone: "purple",
      label: "Nyilvántartott eszköz",
      count: total,
    },
    {
      key: "IN_REPAIR",
      icon: "wrench",
      tone: "amber",
      label: "Javítás alatt",
      count: counts?.IN_REPAIR ?? null,
    },
    {
      key: "ACTIVE",
      icon: "checkCircle",
      tone: "green",
      label: "Aktívan üzemel",
      count: counts?.ACTIVE ?? null,
    },
  ];

  const panel = (
    <section className={sv.panel}>
      <ServiceListTabs
        tabs={TABS}
        active={activeStatus}
        onSelect={selectStatus}
        label="Eszközök szűrése státusz szerint"
      />
      <div className={sv.toolbar}>
        <ServiceSearchField
          label="Eszköz keresése"
          placeholder="Név, eszközszám, gyártó, modell, sorozatszám"
          value={search}
          onChange={setSearch}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <label>
            <span className="sr-only">Eszköztípus</span>
            <select
              className={sv.select}
              value={params.get("kind") ?? ""}
              onChange={(event) => filter("kind", event.target.value)}
            >
              <option value="">Minden típus</option>
              {Object.entries(assetKindLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {/* HANY ESZKOZ EGY OLDALON.

              A `filter()`-en megy at, ES EZ A LENYEGE: az a segéd a vegen
              VISSZAALLIT AZ ELSO OLDALRA. Enelkul ez a valaszto a leggyakoribb
              nema hibat adna: aki a 7. oldalon all 25-osevel es 100-ra valt, egy
              olyan oldalszamon maradna, ami MAR NEM LETEZIK -- ures listat
              kapna, es az ugy nez ki, mintha nem lenne eszkoze.

              Az ertek a CIMBEN all, nem allapotban: igy a lap megoszthato es
              frissiteskor megmarad. Ez nem uj minta, a mai kod is igy tarolja. */}
          <label>
            <span className="sr-only">Hány eszköz egy oldalon</span>
            <select
              className={sv.select}
              value={params.get("pageSize") ?? DEFAULT_PAGE_SIZE}
              onChange={(event) => filter("pageSize", event.target.value)}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={String(size)}>
                  {size} / oldal
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {loading && !data ? (
        <div className="space-y-3 p-5" aria-label="Eszközök betöltése">
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
                  <SortableHead sort="name" params={params} onSort={setSort}>
                    Eszköz
                  </SortableHead>
                  <SortableHead
                    sort="placement"
                    params={params}
                    onSort={setSort}
                  >
                    Elhelyezés
                  </SortableHead>
                  {/*
                    A KET KOZEPSO OSZLOP NEM RENDEZHETO, ES EZ NEM KIHAGYAS.
                    Egyik sem EGY adat: a "Hierarchia" a szulo neve VAGY a
                    reszegysegek szama VAGY az, hogy onallo; a "Muszaki
                    azonosito" pedig harom mezo osszefuzve. Mindkettonel eloszb
                    el kell donteni, MIT jelent a rendezes, es az nem fejlesztoi
                    dontes -- a kerdes Balazsnal all (2026-09-16).

                    ES AMIERT NEM ADTUNK NEKIK "valamilyen" rendezest: egy
                    kattinthato fejlec, ami a harom mezo OSSZEFUZOTT szoveget
                    rendezi, mukodonek latszik, es olyan sorrendet ad, amit
                    senki nem tud elolvasni.
                  */}
                  <th className={sv.tableHead}>Hierarchia</th>
                  <th className={sv.tableHead}>Műszaki azonosító</th>
                  <SortableHead sort="status" params={params} onSort={setSort}>
                    Státusz
                  </SortableHead>
                </tr>
              </thead>
              <tbody>
                {data.items.map((asset) => (
                  <tr key={asset.id} className={sv.tableRow}>
                    <td className={sv.tableCell}>
                      <Link
                        href={`/szerviz/eszkozok/${asset.id}`}
                        className={sv.rowTitle}
                      >
                        {asset.name}
                      </Link>
                      <span className={`mt-1 block font-mono ${sv.rowMeta}`}>
                        {asset.assetNumber}
                      </span>
                      {/* AZ UGYFEL SAJAT KODJA, csak ha VAN. A kereses eddig is
                          nezte, a sor viszont nem mutatta: az ugyfel felolvasta a
                          sajat kodjat, a talalat feljott, es semmi nem arulta el,
                          MIRE illeszkedett. A felirat azert kell melle, hogy ne
                          legyen osszekeverheto a mi eszkozszamunkkal -- az all
                          folotte, ugyanabban a betutipusban. */}
                      {asset.inventoryNumber ? (
                        <span className={`mt-1 block ${sv.rowMeta}`}>
                          Leltári szám:{" "}
                          <span className="font-mono">
                            {asset.inventoryNumber}
                          </span>
                        </span>
                      ) : null}
                    </td>
                    <td className={sv.tableCell}>
                      <div className="text-xs font-medium text-ink">
                        {asset.owner.displayName}
                      </div>
                      {/* AZ ALEGYSEG A VALASZTOTT HELY, a cim a VISSZAESES.
                          Partner-tulajdonosnal a cim mindig a partner sajat
                          postai cime, tehat alegyseg nelkul ez nem valasztas
                          eredmenye -- es a listaban ez latszik a legkevesbe, mert
                          egy sorban minden helynek ugyanugy nez ki. Ezert all itt
                          is a jeloles, nem csak az adatlapon. */}
                      <div className={sv.rowMeta}>
                        {asset.unit
                          ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                          : asset.owner.type === "SUPPLIER"
                            ? asset.address?.formatted
                              ? `Nincs pontosítva. ${asset.address.formatted}`
                              : "Nincs pontosítva."
                            : (asset.address?.formatted ?? "Nincs pontosítva.")}
                      </div>
                    </td>
                    <td className={`${sv.tableCell} text-xs text-ink`}>
                      {asset.parent ? (
                        <span>
                          Része: <strong>{asset.parent.name}</strong>
                        </span>
                      ) : asset.childCount ? (
                        `${asset.childCount} részegység`
                      ) : (
                        "Önálló eszköz"
                      )}
                    </td>
                    <td className={sv.tableCell}>
                      {[asset.manufacturer, asset.model, asset.serialNumber]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className={sv.tableCell}>
                      <ServiceStatusBadge tone={assetStatusTone[asset.status]}>
                        {assetStatusLabel[asset.status]}
                      </ServiceStatusBadge>
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
            title="Nincs találat"
            description="Módosítsd a szűrőket vagy rögzíts új partnereszközt."
          />
        </div>
      ) : null}
    </section>
  );

  return (
    <div>
      <ServiceOfflineNotice
        state={data ? { kind: "loaded" } : { kind: "empty" }}
      />
      <ServiceListHeader
        eyebrow="Szerviz / munkatér"
        title="Eszköznyilvántartás"
        lead="Tudd, mi hol van, és milyen állapotban. Partnerekhez rendelt rendszerek, berendezések és részegységek QR-azonosítással."
        action={
          canManage ? (
            <Link href="/szerviz/eszkozok/uj">
              <Button>
                <ServiceIcon name="plus" className="mr-1.5 size-[17px]" />
                Új eszköz
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
        label="Eszközök státusz szerint"
      />
      {unitRows.length > 0 ? (
        <div className="grid gap-[18px] lg:grid-cols-[190px_minmax(0,1fr)]">
          {/* A HELYSZINFA TOBBSZOROS VALASZTAST ENGED, es ez nem a design
              egyszerusitese: Balazs dontese szerint egy emberhez TOBB
              csomopont is rendelheto, tehat egy egy-ertekű valaszto kesobb
              nem bovulne, hanem ujraírasra szorulna (`unit-filter.ts`). A
              behuzas a fa melysege, a szurés pedig a RESZFARA szol -- az
              alatta logo eszkozok is bejonnek. */}
          <aside>
            <h2 className="mb-2 px-[11px] text-[13px] font-bold text-ink">
              Helyszínek
            </h2>
            <button
              type="button"
              onClick={() =>
                router.replace(`${pathname}?${writeUnitFilter(params, [])}`)
              }
              className={`${sv.treeItem} ${
                selectedUnits.length === 0 ? sv.treeItemActive : ""
              }`}
            >
              <ServiceIcon name="building" className="size-4" />
              Minden helyszín
            </button>
            {unitRows.map(({ unit, depth, path }) => {
              const on = selectedUnits.includes(unit.id);
              /* AZ ARCHIVALT HELYSZIN IS OTT MARAD A VALASZTOBAN (acrobot
                 dontese, 2026-09-02 21:13): egy eszkoz allhat archivalt
                 helyszinen, es a listat is akarhatja valaki epp arra szurni. A
                 jeloles viszont kell, kulonben a felhasznalo nem erti, miert
                 nem ajanljuk ugyanezt a helyszint az uj munkanal. A jelolo a
                 HOZZAFERHETO NEVBEN is ott van, nem csak a lathato szovegben. */
              const marked = unit.isActive ? path : `${path} · archivált`;
              return (
                <button
                  key={unit.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={marked}
                  title={marked}
                  style={{ paddingLeft: 11 + depth * 19 }}
                  onClick={() =>
                    router.replace(
                      `${pathname}?${writeUnitFilter(
                        params,
                        toggleUnitFilter(selectedUnits, unit.id),
                      )}`,
                    )
                  }
                  className={`${sv.treeItem} ${on ? sv.treeItemActive : ""}`}
                >
                  <ServiceIcon name="location" className="size-4" />
                  <span className="truncate">
                    {unit.name}
                    {unit.isActive ? "" : " · archivált"}
                  </span>
                </button>
              );
            })}
          </aside>
          {panel}
        </div>
      ) : (
        panel
      )}
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

/**
 * EGY RENDEZHETO OSZLOPFEJLEC.
 *
 * Balazs kerese, 2026-09-16: "jo lenne ha kattintassal lehetne rendezni az
 * adatokat".
 *
 * A HAROM ALLAPOT LATSZIK IS, nem csak mukodik: rendezetlen, novekvo, csokkeno.
 * Egy nyil nelkuli kattinthato fejlec ugyanugy nez ki rendezes elott es utan,
 * es a felhasznalo a LISTAT hiszi rossznak, nem a sajat emlekezetet.
 *
 * AZ `aria-sort` A `th` ELEMEN ALL, nem a gombon, mert a szabvany szerint az
 * oszlop a rendezett dolog, nem a kapcsolo. Felolvaso nelkul ez nem latszik,
 * es epp ezert csuszik el csendben.
 */
function SortableHead({
  sort,
  params,
  onSort,
  children,
}: {
  sort: string;
  params: URLSearchParams;
  onSort(sort: string): void;
  children: ReactNode;
}) {
  const aktiv = params.get("sort") === sort;
  const csokkeno = aktiv && params.get("direction") === "desc";
  return (
    <th
      className={sv.tableHead}
      aria-sort={aktiv ? (csokkeno ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className="inline-flex items-center gap-1 uppercase tracking-[0.07em] hover:text-ink"
      >
        {children}
        {/*
          A JELOLES KET DOLGOT MOND EGYSZERRE: hogy ez az oszlop RENDEZHETO
          (halvany kettos nyil), es ha rendez, hogy MERRE. A `aria-hidden` azert
          all rajta, mert a felolvaso mar megkapta ugyanezt az `aria-sort`
          ertekbol -- ketszer elmondva zaj lenne.
        */}
        <span aria-hidden className={aktiv ? "text-ink" : "text-muted/50"}>
          {aktiv ? (csokkeno ? "↓" : "↑") : "⇅"}
        </span>
      </button>
    </th>
  );
}

/**
 * RELATÍV UT, NEM `@/` ALIAS: ez a modul spec-ből is behúzódik (lásd a `tsconfig.test.json` fejlécét).
 */
import type { ServiceJobListItem } from "./types";

/**
 * A KARBANTARTÁS LISTA FÜLEI A WEBES LISTA LOGIKÁJÁVAL (web #2710, Balázs 2026-11-18 11:31 UTC; acrobot 56224). A karbantartásnak nincs hibajegy-állapota: a "Kész" az, hogy van munkalapja, és mind alá van írva
 * (`maintenanceDone`, a szerver számolja). A fülek ezért a KLIENSEN szűrnek ugyanarra a mezőre, mint a weben, és egy szerver-hívás elég mind a háromhoz (kind=MAINTENANCE, scope=all): a szerver kétszáz sornál vág, de
 * ez a hívás csak karbantartási lapokat hoz, tehát a vágás itt nem hibajegyekkel osztozik.
 */
export type MaintenanceTab = "progress" | "done" | "all";

export const MAINTENANCE_TABS: { id: MaintenanceTab; label: string }[] = [
  { id: "progress", label: "Folyamatban" },
  { id: "done", label: "Kész" },
  { id: "all", label: "Összes" },
];

export const DEFAULT_MAINTENANCE_TAB: MaintenanceTab = "progress";

/** A szerver sorai egy fülhöz; a hiányzó `maintenanceDone` itt `false`, mert a szerver minden karbantartási soron küldi. */
export function maintenanceItemsForTab(
  items: readonly ServiceJobListItem[],
  tab: MaintenanceTab,
): ServiceJobListItem[] {
  if (tab === "all") return [...items];
  const done = tab === "done";
  return items.filter((item) => Boolean(item.maintenanceDone) === done);
}

/** Egy vegyes lista (a mentett másolat) karbantartási sorai. */
export function maintenanceRowsOf(
  items: readonly ServiceJobListItem[],
): ServiceJobListItem[] {
  return items.filter((item) => item.kind === "MAINTENANCE");
}

export interface CachedMaintenanceResult {
  items: ServiceJobListItem[];
  /** Hány mentett karbantartási sor készsége ismeretlen (a fülön kívül is számít). */
  unknown: number;
}

/**
 * A MENTETT MÁSOLAT FÜLE, AZ ISMERETLENT KIMONDVA.
 *
 * A mentett sor nem mindig hordozza a `maintenanceDone` mezőt: a lapot megnyitva a részletlap írja a listasort, és a részletlap a készséget nem küldi (csak a partner változata). Egy hiányzó mező itt ISMERETLEN, nem "folyamatban":
 * a szerver-ág `Boolean(undefined)` szabálya egy kész lapot a Folyamatban fülre tenne, és azt a szerelő nem tudná megkülönböztetni egy valódi folyamatban lévőtől. Az ismeretlen sor ezért csak az Összes fülön látszik, a
 * szám pedig a képernyőn kimondja, hányról van szó.
 */
export function cachedMaintenanceForTab(
  items: readonly ServiceJobListItem[],
  tab: MaintenanceTab,
): CachedMaintenanceResult {
  const rows = maintenanceRowsOf(items);
  const unknown = rows.filter(
    (item) => item.maintenanceDone === undefined,
  ).length;
  if (tab === "all") return { items: rows, unknown };
  const done = tab === "done";
  return {
    // `=== done` (nem `Boolean(...)`): az ismeretlen (`undefined`) sem a `true`, sem a `false` fülhöz nem egyenlő
    items: rows.filter((item) => item.maintenanceDone === done),
    unknown,
  };
}

/**
 * A FÜL SZERVER-ÁLLAPOTA (#2711): a Folyamatban és a Kész a saját állapotát kéri, az Összes egyiket sem (a teljes lista, és a mentett másolat is ebből íródik).
 */
export function maintenanceStateOf(
  tab: MaintenanceTab,
): "progress" | "done" | undefined {
  return tab === "all" ? undefined : tab;
}

export interface MaintenanceCounts {
  progress: number;
  done: number;
}

/** A fül teljes száma a szerver számlálójából; `null`, ha nincs számláló (régi szerver, mentett másolat): kitalált szám nem kerül a felirat mellé. */
export function maintenanceTabTotal(
  counts: MaintenanceCounts | undefined,
  tab: MaintenanceTab,
): number | null {
  if (!counts) return null;
  if (tab === "progress") return counts.progress;
  if (tab === "done") return counts.done;
  return counts.progress + counts.done;
}

export function maintenanceTabLabel(
  label: string,
  tab: MaintenanceTab,
  counts: MaintenanceCounts | undefined,
): string {
  const total = maintenanceTabTotal(counts, tab);
  return total === null ? label : `${label} (${total})`;
}

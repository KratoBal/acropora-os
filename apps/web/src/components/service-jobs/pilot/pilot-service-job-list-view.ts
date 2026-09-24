import type {
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobStatusValue,
} from "@acropora/types";

/**
 * A PILOT LISTA NÉGY FÜLE -- TISZTA FÜGGVÉNYEK, hogy a fülek viselkedése
 * mérhető legyen az oldal felrajzolása nélkül. Lásd a
 * `pilot-service-job-list-page.tsx` fejlécét, miért NEM ugyanaz a
 * bontás, mint a mai (`service-job-list-view.ts`) listáé: ott a "Nyitott"
 * fül a várakozó jegyeket IS tartalmazza, a Figma-terv "Nyitott hibajegy"
 * füle viszont KIZÁRJA őket -- két különböző csoportosítás, ugyanazon a
 * nyolc állapoton.
 */
export const TRULY_OPEN: ServiceJobStatusValue[] = [
  "NEW",
  "TRIAGED",
  "SCHEDULED",
  "IN_PROGRESS",
];
export const WAITING: ServiceJobStatusValue[] = [
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
];
export const CLOSED: ServiceJobStatusValue[] = ["COMPLETED", "CANCELLED"];

/**
 * AZ ÁLLAPOT-JELVÉNY SZÍNE HÁROM TÓNUSRA EGYSZERŰSÖDIK.
 *
 * A valódi rendszer nyolc belső állapotot ismer, a Figma-terv és a
 * repóban létező pilot-tokenek viszont csak hármat adnak
 * (`pilot-aqua`/`pilot-amber`/`pilot-grey` -- lásd `figma-theme.css`
 * fejlécét: "Use ONLY those tokens"). A CÍMKE SZÖVEGE a nyolc valódi név
 * marad (`serviceJobStatusLabel`), csak a szín egyszerűsödik.
 */
export const STATUS_BADGE_VARIANT: Record<
  ServiceJobStatusValue,
  "teal" | "amber" | "grey"
> = {
  NEW: "teal",
  TRIAGED: "teal",
  SCHEDULED: "teal",
  IN_PROGRESS: "teal",
  WAITING_FOR_PARTS: "amber",
  WAITING_FOR_CUSTOMER: "amber",
  COMPLETED: "grey",
  CANCELLED: "grey",
};

export type PilotTab = "all" | "open" | "waiting" | "closed";

export interface PilotTabDef {
  id: PilotTab;
  label: string;
  /** Amit a szervertől kérünk -- ugyanaz a két érték, mint a mai listán. */
  scope: "open" | "all";
  /** A betöltött lapon belüli szűrés, vagy `null` a teljes válaszra. */
  statuses: ServiceJobStatusValue[] | null;
}

export const PILOT_TABS: PilotTabDef[] = [
  { id: "all", label: "Összes", scope: "all", statuses: null },
  {
    id: "open",
    label: "Nyitott hibajegy",
    scope: "open",
    statuses: TRULY_OPEN,
  },
  {
    id: "waiting",
    label: "Válaszra vagy alkatrészre vár",
    scope: "open",
    statuses: WAITING,
  },
  { id: "closed", label: "Lezárt ügy", scope: "all", statuses: CLOSED },
];

export function pilotTabDef(tab: PilotTab): PilotTabDef {
  const found = PILOT_TABS.find((entry) => entry.id === tab);
  if (!found) throw new Error(`Ismeretlen fül: ${tab}`);
  return found;
}

export function pilotItemsForTab(
  items: readonly ServiceJobListItem[],
  tab: PilotTab,
): ServiceJobListItem[] {
  const { statuses } = pilotTabDef(tab);
  if (!statuses) return [...items];
  return items.filter((item) => statuses.includes(item.status));
}

/**
 * A NÉGY CSEMPE SZÁMA -- A TELJES LÁTHATÓ HALMAZBÓL (`counts`), NEM A
 * BETÖLTÖTT LAPBÓL. Ugyanaz az érv, mint a mai listán: a `counts` minden
 * állapot darabszámát hozza, a 200-as határtól függetlenül.
 */
export function pilotTabCounts(
  counts: ServiceJobListResponse["counts"],
): Record<PilotTab, number> {
  const sum = (statuses: ServiceJobStatusValue[]) =>
    statuses.reduce((total, status) => total + counts[status], 0);
  return {
    all: sum(TRULY_OPEN) + sum(WAITING) + sum(CLOSED),
    open: sum(TRULY_OPEN),
    waiting: sum(WAITING),
    closed: sum(CLOSED),
  };
}

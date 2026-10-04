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
  "teal" | "amber" | "grey" | "blue"
> = {
  /*
    THE REDESIGN'S FIVE TONES (Figma 423:15 "Service / Status Badge": Blue,
    Purple, Amber, Green, Neutral) are a visual reference, not new states
    (brief, point 8). The not-yet-started statuses read blue, the running
    ones teal, the waiting ones amber, and a finished job (completed or
    cancelled) neutral, as before. The design's green "Lezárva" is not used:
    the pilot green has no dark-mode pair, and adding one would change other
    pages' dark mode. Purple has no pilot token and no status needs it.
  */
  NEW: "blue",
  TRIAGED: "blue",
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

/**
 * THE FOUR TABS, IN THE ORDER AND WORDING OF THE SERVICE REDESIGN (Figma
 * 423:20, 2026-10-04): Nyitott, Összes, Várakozik, Lezárt. Only the labels
 * and the order moved; what each tab holds is unchanged.
 */
export const PILOT_TABS: PilotTabDef[] = [
  {
    id: "open",
    label: "Nyitott",
    scope: "open",
    statuses: TRULY_OPEN,
  },
  { id: "all", label: "Összes", scope: "all", statuses: null },
  {
    id: "waiting",
    label: "Várakozik",
    scope: "open",
    statuses: WAITING,
  },
  { id: "closed", label: "Lezárt", scope: "all", statuses: CLOSED },
];

/** The noun for the footer's "4 / 7 nyitott hibajegy" count, per tab. */
export const PILOT_TAB_NOUN: Record<PilotTab, string> = {
  open: "nyitott hibajegy",
  all: "hibajegy",
  waiting: "várakozó hibajegy",
  closed: "lezárt hibajegy",
};

/**
 * THE "FELELŐS" CELL: the delegated colleagues by name, or "Nincs kiosztva".
 *
 * Text, not avatars (the redesign brief: "Ádám, Péter"). An empty list is
 * a fact on the internal list, which always carries the field, so it reads
 * as "Nincs kiosztva"; there is no "unknown" case on the web.
 */
export const NO_ASSIGNEE = "Nincs kiosztva";

export function assigneeNames(
  assignees: readonly { name: string }[],
): string | null {
  return assignees.length > 0
    ? assignees.map((assignee) => assignee.name).join(", ")
    : null;
}

/**
 * THE THREE STAT TILES (Figma 423:20), from the server's `counts` only.
 *
 * - Nyitott: the four open statuses, with how many of them are new.
 * - Várakozik: the two waiting statuses, split by what they wait for.
 * - Lezárt: all closed jobs. The design's "ebben a hónapban" and "2 sürgős"
 *   are left out (decisions E1, E2): there is no monthly count and no
 *   priority field, and a tile does not invent one.
 */
export interface PilotStatTile {
  key: "open" | "waiting" | "closed";
  label: string;
  value: number;
  detail: string | null;
  tone: "default" | "amber" | "teal";
}

export function pilotStatTiles(
  counts: ServiceJobListResponse["counts"],
): PilotStatTile[] {
  const tabs = pilotTabCounts(counts);
  const waitingDetail: string[] = [];
  if (counts.WAITING_FOR_PARTS > 0)
    waitingDetail.push(`${counts.WAITING_FOR_PARTS} alkatrészre`);
  if (counts.WAITING_FOR_CUSTOMER > 0)
    waitingDetail.push(`${counts.WAITING_FOR_CUSTOMER} ügyfélre`);
  return [
    {
      key: "open",
      label: "Nyitott hibajegy",
      value: tabs.open,
      detail: counts.NEW > 0 ? `${counts.NEW} új` : null,
      tone: "default",
    },
    {
      key: "waiting",
      label: "Várakozik",
      value: tabs.waiting,
      detail: waitingDetail.length > 0 ? waitingDetail.join(" · ") : null,
      tone: "amber",
    },
    {
      key: "closed",
      label: "Lezárt ügy",
      value: tabs.closed,
      detail: null,
      tone: "teal",
    },
  ];
}

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

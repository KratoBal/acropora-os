import {
  COMMON_SERVICE_STATUSES,
  type CommonServiceStatus,
  type ServiceJobListResponse,
} from "@acropora/types";

/**
 * A HIBAJEGY-LISTA NÉGY FÜLE A KÖZÖS ÖT ÁLLAPOTON (kártya 7f23785c, 3. szelet;
 * picasso felületi átnézése, 4. pont): Nyitott, Vár valamire, Lezárt, Összes.
 *
 * A fül a szervertől a KÖZÖS állapotokat kéri (`commonStatuses`), nem a tárolt
 * nyolcat: a levezetett Elkészült csak a szerveren szűrhető ugyanazzal a
 * feltétellel, mint a számlálója és a sor felirata (terv 8/c). Az Elkészült a
 * Nyitottba esik, mert még teendő van vele (aláírás, átadás, lezárás); a
 * csempe alcíme külön kimondja, hány ilyen van, hogy ne vesszen el.
 *
 * A fül-azonosítók (`open`, `waiting`, `closed`, `all`) a régiek: a mentett
 * hivatkozások (`?tab=waiting`) ugyanarra a fülre visznek.
 */
export const OPEN_COMMON: CommonServiceStatus[] = [
  "NEW",
  "IN_PROGRESS",
  "DONE",
];

export type PilotTab = "all" | "open" | "waiting" | "closed";

export interface PilotTabDef {
  id: PilotTab;
  label: string;
  /** Amit a szervertől kérünk -- ugyanaz a két érték, mint a mai listán. */
  scope: "open" | "all";
  /** A közös állapot-szűrő a szervernek, vagy `null` a teljes halmazra. */
  commonStatuses: CommonServiceStatus[] | null;
}

export const PILOT_TABS: PilotTabDef[] = [
  { id: "open", label: "Nyitott", scope: "open", commonStatuses: OPEN_COMMON },
  {
    id: "waiting",
    label: "Vár valamire",
    scope: "open",
    commonStatuses: ["WAITING"],
  },
  { id: "closed", label: "Lezárt", scope: "all", commonStatuses: ["CLOSED"] },
  { id: "all", label: "Összes", scope: "all", commonStatuses: null },
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
 * THE THREE STAT TILES (Figma 423:20), from the server's counts only.
 *
 * - Nyitott: Új, Folyamatban and Elkészült, with how many are new and how many
 *   are done but not closed yet (picasso, point 4).
 * - Vár valamire: split by what they wait for. The stored `counts` split it:
 *   the common Vár valamire is exactly the two stored waiting statuses.
 * - Lezárt: all closed jobs, with how many of them were cancelled (the same
 *   identity: Lezárt is exactly the stored COMPLETED and CANCELLED).
 * The design's "ebben a hónapban" and "2 sürgős" are left out (decisions E1,
 * E2): there is no monthly count and no priority field, and a tile does not
 * invent one.
 */
export interface PilotStatTile {
  key: "open" | "waiting" | "closed";
  label: string;
  value: number;
  detail: string | null;
  tone: "default" | "amber" | "teal";
}

type CommonCounts = Record<CommonServiceStatus, number>;

function joined(parts: (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null);
  return present.length > 0 ? present.join(" · ") : null;
}

const countOf = (value: number, noun: string): string | null =>
  value > 0 ? `${value} ${noun}` : null;

export function pilotStatTiles(
  counts: ServiceJobListResponse["counts"],
  commonCounts: CommonCounts,
): PilotStatTile[] {
  const tabs = pilotTabCounts(commonCounts);
  return [
    {
      key: "open",
      label: "Nyitott hibajegy",
      value: tabs.open,
      detail: joined([
        countOf(commonCounts.NEW, "új"),
        countOf(commonCounts.DONE, "elkészült"),
      ]),
      tone: "default",
    },
    {
      key: "waiting",
      label: "Vár valamire",
      value: tabs.waiting,
      detail: joined([
        countOf(counts.WAITING_FOR_PARTS, "alkatrészre"),
        countOf(counts.WAITING_FOR_CUSTOMER, "ügyfélre"),
      ]),
      tone: "amber",
    },
    {
      key: "closed",
      label: "Lezárt ügy",
      value: tabs.closed,
      detail: countOf(counts.CANCELLED, "meghiúsult"),
      tone: "teal",
    },
  ];
}

export function pilotTabDef(tab: PilotTab): PilotTabDef {
  const found = PILOT_TABS.find((entry) => entry.id === tab);
  if (!found) throw new Error(`Ismeretlen fül: ${tab}`);
  return found;
}

/**
 * A FÜLEK SZÁMA A SZERVER KÖZÖS SZÁMLÁLÓJÁBÓL (`commonCounts`), NEM A BETÖLTÖTT
 * LAPBÓL: ugyanaz a szűrő számolja, amelyik a fül sorait adja, tehát a fül
 * száma és a lábléc találatszáma egyezik. A csempék ugyanezt hívják (egy
 * függvény, két megjelenítés).
 */
export function pilotTabCounts(
  commonCounts: CommonCounts,
): Record<PilotTab, number> {
  const sum = (statuses: readonly CommonServiceStatus[]) =>
    statuses.reduce((total, status) => total + commonCounts[status], 0);
  return {
    all: sum(COMMON_SERVICE_STATUSES),
    open: sum(OPEN_COMMON),
    waiting: commonCounts.WAITING,
    closed: commonCounts.CLOSED,
  };
}

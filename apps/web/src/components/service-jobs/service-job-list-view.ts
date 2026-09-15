import type {
  ServiceJobListItem,
  ServiceJobStatusCounts,
  ServiceJobStatusValue,
} from "@acropora/types";

/**
 * A LISTA NÉGY FÜLE, ÉS AMI MÖGÖTTÜK VAN.
 *
 * TISZTA FÜGGVÉNYEK, hogy a fülek viselkedése mérhető legyen az oldal
 * felrajzolása nélkül - ugyanaz a megfontolás, mint a naplósor szövegénél és a
 * megjegyzés-mező leírásánál.
 *
 * A LÉNYEG, AMI MIATT EZ NEM PUSZTA SZŰRÉS: két fül a szervertől MÁS HALMAZT
 * kér, kettő pedig a már betöltöttből válogat. A kettő nem ugyanaz, és a
 * különbség csendes - egy kliensoldali szűrő azt ígéri, hogy az egész
 * halmazban keres, holott csak a betöltött lapon. Ezért a `szurendo` mező
 * KIMONDJA, melyik fül melyik.
 */
export type ServiceJobTab = "all" | "open" | "waiting" | "closed";

const WAITING: ServiceJobStatusValue[] = [
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
];

/** A két végállapot. A szerver `scope=open` szűrője pontosan ezt a kettőt hagyja ki. */
const FINISHED: ServiceJobStatusValue[] = ["COMPLETED", "CANCELLED"];

export interface ServiceJobTabDefinition {
  id: ServiceJobTab;
  label: string;
  /** Amit a szervertől kérünk. A `waiting` a nyitottakból válogat, tehát `open`. */
  scope: "open" | "all";
  /** A betöltött lapon belüli szűrés, vagy `null`, ha a fül a teljes választ mutatja. */
  statuses: ServiceJobStatusValue[] | null;
}

export const SERVICE_JOB_TABS: ServiceJobTabDefinition[] = [
  { id: "all", label: "Összes", scope: "all", statuses: null },
  { id: "open", label: "Nyitott", scope: "open", statuses: null },
  { id: "waiting", label: "Várakozik", scope: "open", statuses: WAITING },
  { id: "closed", label: "Lezárt", scope: "all", statuses: FINISHED },
];

export function tabDefinition(tab: ServiceJobTab): ServiceJobTabDefinition {
  const found = SERVICE_JOB_TABS.find((entry) => entry.id === tab);
  if (!found) throw new Error(`Ismeretlen fül: ${tab}`);
  return found;
}

export function itemsForTab(
  items: readonly ServiceJobListItem[],
  tab: ServiceJobTab,
): ServiceJobListItem[] {
  const { statuses } = tabDefinition(tab);
  if (!statuses) return [...items];
  return items.filter((item) => statuses.includes(item.status));
}

/**
 * A HÁROM SZÁM A LISTA FÖLÖTT.
 *
 * A TELJES halmazból számol, nem a betöltött lapból: a `counts` minden állapot
 * darabszámát hozza, a kétszázas határtól függetlenül. Ezért marad igaz akkor
 * is, amikor a lista már nem fér ki egy lapra - és ezért nem a `items.length`
 * a forrása.
 */
export function listSummary(counts: ServiceJobStatusCounts) {
  const finished = FINISHED.reduce((sum, status) => sum + counts[status], 0);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    open: total - finished,
    waiting: WAITING.reduce((sum, status) => sum + counts[status], 0),
    closed: finished,
  };
}

/**
 * A LISTA ALJÁN ÁLLÓ MONDAT: HÁNY SOR LÁTSZIK, ÉS VAN-E TÖBB.
 *
 * A HATÁR SZÁMÁT NEM ÍRJA KI, ÉS EZ SZÁNDÉKOS: a kétszáz a szerver
 * lekérdezésében áll, és ha itt is állna, egyszer elcsúszna. A szerver a
 * `truncated` mezővel MEGMONDJA, hogy van több; a kliens dolga csak annyi,
 * hogy ezt ne hallgassa el.
 *
 * A SZŰRT FÜLEKNÉL KÜLÖN MONDAT JÁR. Ott a szám a betöltött lapon belüli
 * válogatás eredménye, tehát egy vágott listán a "hét találat" azt jelentené,
 * hogy összesen hét ilyen van - és az nem igaz. A fenti három szám ilyenkor is
 * pontos, mert azok a teljes halmazból jönnek.
 */
export function listFooterLine(input: {
  shown: number;
  truncated: boolean;
  filtered: boolean;
}): string {
  const count = `${input.shown} találat`;
  if (!input.truncated) return `${count} · a lista végére értél`;
  if (input.filtered)
    return `${count} a betöltött legfrissebbek közül · a teljes számot a fenti dobozok mondják meg`;
  return `${count} · a legfrissebbek látszanak, és van több`;
}

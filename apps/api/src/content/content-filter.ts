import type { ContentState } from "./content-state.js";

/**
 * A LISTA ALAPÉRTELMEZETT SZŰRŐJE: „ami RÁM vár".
 *
 * Balázs szavai szerint: „minden felkerül ami rank var". Ez a függvény fordítja
 * le azt a mondatot állapotokra, és tiszta függvényként, hogy mérhető legyen --
 * a szűrő helyessége nem az adatbázison múlik.
 *
 * A SZEREP DÖNTI EL, MI VÁR RÁM, nem a felhasználó azonosítója önmagában:
 * ugyanaz az ember lehet szerző az egyik tételen és jóváhagyó a másikon. Ezért
 * a bemenet mindkettő.
 */
export type ContentViewerRole = "author" | "reviewer" | "approver" | "sender";

export interface WaitingForMeFilter {
  states: ContentState[];
  /** Ha igaz, csak a saját tételek (szerző vagy lektor szerint). */
  ownOnly: boolean;
}

const STATES_BY_ROLE: Record<ContentViewerRole, ContentState[]> = {
  author: ["DRAFTING", "AWAITING_REVISION"],
  reviewer: ["AWAITING_REVIEW"],
  approver: ["AWAITING_APPROVAL"],
  sender: ["READY_TO_SEND"],
};

/**
 * MI VÁR EGY ADOTT SZEREPRE.
 *
 * A `sender` és az `approver` NEM szűkül saját tételekre: az a két szerep
 * nevesített embereké (Balázs és Luca), és nekik minden rájuk váró tétel
 * látszik, akárki írta. A `author` és a `reviewer` viszont igen -- egy szerző
 * listája ne teljen meg mások vázlataival.
 */
export function waitingFor(role: ContentViewerRole): WaitingForMeFilter {
  return {
    states: STATES_BY_ROLE[role],
    ownOnly: role === "author" || role === "reviewer",
  };
}

/**
 * MI VÁR RÁM, SZEREP-VÁLASZTÁS NÉLKÜL.
 *
 * A PANASZ, AMIBŐL EZ KÉSZÜL: a szerep-választóval ma NÉGY nézetet kell
 * végignézni ahhoz, hogy valaki lássa, mi vár rá. Aki egyszerre szerző és
 * jóváhagyó, két helyen keres -- Balázs mondata pedig épp az volt, hogy nem
 * látja, mi vár rá.
 *
 * A HÁROM RÉSZ KÜLÖN SZŰKÜL, ÉS EZÉRT NEM EGY ÁLLAPOTLISTA: a szerzőnek és a
 * lektornak a SAJÁT tételei várnak, a jóváhagyónak MINDEN jóváhagyásra váró,
 * akárki írta. Egy közös állapot-halmaz ezt a különbséget elveszítené, és vagy
 * mások vázlataival töltené meg a szerző listáját, vagy elrejtené a jóváhagyó
 * elől azt, amit nem ő indított.
 */
export interface ContentViewerCapabilities {
  userId: string;
  /** Van-e `content.approve` joga. A jogot a hívó olvassa ki, nem ez a modul. */
  canApprove: boolean;
}

export interface WaitingOnMeShard {
  states: ContentState[];
  /** Kire szűkül: a saját szerzőségre, a saját lektorságra, vagy senkire. */
  scope: "own-author" | "own-reviewer" | "everyone";
}

export function waitingOnMe(
  viewer: ContentViewerCapabilities,
): WaitingOnMeShard[] {
  const shards: WaitingOnMeShard[] = [
    { states: STATES_BY_ROLE.author, scope: "own-author" },
    { states: STATES_BY_ROLE.reviewer, scope: "own-reviewer" },
  ];
  // A JÓVÁHAGYÓI RÉSZ CSAK AKKOR KERÜL BE, HA VAN HOZZÁ JOG. Enélkül minden
  // felhasználó listájában ott állna az összes jóváhagyásra váró tétel -- olyan
  // sor, amivel nem tud mit kezdeni, és ami elfedné azt, ami tényleg rá vár.
  if (viewer.canApprove)
    shards.push({ states: STATES_BY_ROLE.approver, scope: "everyone" });
  return shards;
}

/**
 * AMIT EZ A NÉZET NEM TUD LEFEDNI, ÉS AMIÉRT KI KELL MONDANI.
 *
 * A `sender` szerep MA SEMMIBŐL NEM VEZETHETŐ LE: nincs sender mező a sémán, és
 * nincs külön jog rá. A szerep-választóban létező név, nem a rendszer állapota.
 *
 * EZÉRT NEM EGYSZERŰEN KIMARAD, HANEM MEG VAN NEVEZVE. Egy nézet, ami „mi vár
 * rám" néven fut és közben egy negyedét kihagyja, pontosan azt a hamis
 * megnyugvást adja, amit a hibás listáknál kerülni akarunk: aki nem tudja, hogy
 * hiányzik valami, a hiányzót nem létezőnek hiszi.
 *
 * A negyedik negyed sorsa külön döntés (kártya: c057b4db), és akkor esedékes,
 * amikor a kiküldés ténylegesen működni fog -- nem egy nézet kedvéért.
 */
export const ROLES_THIS_VIEW_CANNOT_COVER: {
  role: ContentViewerRole;
  reason: string;
}[] = [
  {
    role: "sender",
    reason:
      "A kiküldésre kész tételek nem szerepelnek ebben a nézetben: ma nincs olyan mező vagy jog, amiből kiderülne, ki a kiküldő. Ezt a szerep-választóval lehet megnézni.",
  },
];

/**
 * AMI SENKIRE NEM VÁR, DE MÉGSEM KÉSZ: a képre váró tételek.
 *
 * Ez KÜLÖN lekérdezés, és nem az állapotszűrő része, mert a kép független a
 * szövegtől. Ma NÉGY kész szövegű poszt áll pontosan itt (lásd a
 * `content-state.ts` fejlécét), és a mai három
 * nyilvántartásban egyikben sem látszik így.
 *
 * A `SENT` és a `DISCARDED` kimarad: egy kiküldött poszt képe már nem hiányzik,
 * akkor sem, ha a mező üresen maradt.
 */
export const STATES_THAT_CAN_WAIT_FOR_IMAGE: ContentState[] = [
  "IDEA",
  "DRAFTING",
  "AWAITING_REVIEW",
  "AWAITING_REVISION",
  "AWAITING_APPROVAL",
  "READY_TO_SEND",
  "SCHEDULED",
];

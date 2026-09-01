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

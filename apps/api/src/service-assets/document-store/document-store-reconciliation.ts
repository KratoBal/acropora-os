import type { DocumentKey } from "./document-store.js";
import { storageKeyFor } from "./document-storage-key.js";

/**
 * A TÁBLA ÉS A TÁROLÓ ÖSSZEVETÉSE.
 *
 * MIÉRT KÉT KÜLÖN FAJTA, ÉS MIÉRT NEM EGY „ELTÉRÉS" SZÁM: a két irány MÁS
 * teendőt kíván, és egy közös szám mindkettőt elrejtené.
 *
 * - ELÁRVULT FÁJL (van fájl, nincs sor): helyet foglal, de senki nem hivatkozik
 *   rá. Nem adatvesztés, hanem szemét. A törlése biztonságos, ha tényleg nincs
 *   sora -- de épp ezt kell előbb bizonyítani.
 * - ELVESZETT SOR (van sor, nincs fájl): a felhasználó LÁTJA a dokumentumot a
 *   listában, és a letöltésnél kap hibát. Ez a súlyosabb, mert kifelé látszik,
 *   és mentésből kell visszahozni, nem takarítással.
 *
 * TISZTA FÜGGVÉNY: a hívó adja be a két halmazt (a táblából a `storageKey`-es
 * sorokat, a tárolóból a `list()` eredményét), ez pedig csak összeveti. Így a
 * szabály mérhető azelőtt, hogy éles tároló egyáltalán létezne.
 *
 * A `content`-es SOROK NEM TARTOZNAK IDE, és ez fontos: nekik nincs is fájljuk,
 * tehát ha beleszámolnának, MINDEN mai sor „elveszett sornak" látszana. A hívó
 * dolga, hogy csak a `storageKey`-es sorokat adja be, és ezt a típus is
 * kimondja.
 */
export interface ReconciliationInput {
  /** A táblában álló, TÁROLÓRA hivatkozó sorok. A `content`-esek nem. */
  rowsWithStorageKey: readonly DocumentKey[];
  /** Amit a tároló `list()` metódusa talált. */
  filesInStore: readonly DocumentKey[];
}

export interface ReconciliationReport {
  /** Van fájl, nincs sor: helyet foglal, de senki nem hivatkozik rá. */
  orphanedFiles: DocumentKey[];
  /** Van sor, nincs fájl: a felhasználó látja, és a letöltésnél kap hibát. */
  missingFiles: DocumentKey[];
  /** Ahány sor és fájl párba állt. */
  matched: number;
}

export function reconcileDocumentStore(
  input: ReconciliationInput,
): ReconciliationReport {
  const rowKeys = new Map(
    input.rowsWithStorageKey.map((key) => [storageKeyFor(key), key]),
  );
  const fileKeys = new Map(
    input.filesInStore.map((key) => [storageKeyFor(key), key]),
  );

  const orphanedFiles: DocumentKey[] = [];
  for (const [serialised, key] of fileKeys) {
    if (!rowKeys.has(serialised)) orphanedFiles.push(key);
  }

  const missingFiles: DocumentKey[] = [];
  for (const [serialised, key] of rowKeys) {
    if (!fileKeys.has(serialised)) missingFiles.push(key);
  }

  return {
    orphanedFiles,
    missingFiles,
    matched: rowKeys.size - missingFiles.length,
  };
}

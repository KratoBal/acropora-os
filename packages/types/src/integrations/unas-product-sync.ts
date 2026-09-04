import type { UnasProductSyncAction } from "./unas-api.js";

export interface UnasProductSyncSummary {
  runId: string;
  status: "APPLIED";
  productsSeen: number;
  counts: Record<UnasProductSyncAction, number>;
  missingCount: number;
  /**
   * Hány terméket hagyott ki a szinkron, mert a törzsadatát nem ő gondozza.
   *
   * Számként is látszik, nem csak a naplóban: egy kihagyás, amit senki nem
   * lát, pontosan úgy néz ki, mintha a termék nem is lett volna a listában.
   */
  skippedCount: number;
  /**
   * A kihagyottak közül ahánynál a forrás is változott ugyanabban a futásban.
   *
   * A `skippedCount` állandó: ugyanazokat a termékeket számolja minden futásnál.
   * Ez viszont esemény, és a legtöbb futáson nulla.
   */
  skippedSourceChangedCount: number;
  /**
   * A HASONLO TERMEKEK KAPCSOLATAINAK NEGY SZAMA -- ES A VESZTES CSAK AZ EGYIK.
   *
   * A negy szamlalo ereje az, hogy szetvalaszt: az `unresolved` ADATVESZTES (a
   * celpont nincs a katalogusunkban), az onhivatkozas es a duplikatum viszont
   * szandekos kihagyas. Egyetlen "kihagyva" szam mindharmat osszemosna, es a
   * jelentes olvasoja a legnagyobbat nezne vesztesnek.
   *
   * A `similarRelationsWritten` az UJONNAN letrehozott sorok szama. NEM a
   * kapcsolatok teljes szama: az iras torol es ujrair, tehat egy valtozatlan
   * kapcsolat is beleszamit -- viszont egy termek, amit ez a futas nem irt, nem.
   */
  similarRelationsWritten: number;
  similarReferencesUnresolved: number;
  similarReferencesSelf: number;
  similarReferencesDuplicate: number;
  windowStart: string | null;
  windowEnd: string;
}

export type UnasProductSyncKind = "FULL" | "INCREMENTAL";
export type UnasProductSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface UnasProductSyncRun {
  id: string;
  kind: UnasProductSyncKind;
  status: UnasProductSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  productsSeen: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  missingCount: number;
  /** Ahány terméket a futás kihagyott, mert a törzsadatát nem a UNAS gondozza. */
  skippedCount: number;
  /**
   * A kihagyottak közül ahánynál a FORRÁS IS VÁLTOZOTT ugyanabban a futásban.
   *
   * Ez a szám a jelzés, nem a `skippedCount`. A kihagyás maga állandó: minden
   * futás ugyanazokat a termékeket hagyja ki, tehát a számuk nem mozdul, és egy
   * szám, ami sosem változik, nem jelzés, hanem alapzaj. Ez viszont esemény: egy
   * átvett termék szövege megváltozott a boltban, és nem jött át.
   */
  skippedSourceChangedCount: number;
  errorCode: string | null;
}

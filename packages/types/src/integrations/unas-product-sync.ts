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

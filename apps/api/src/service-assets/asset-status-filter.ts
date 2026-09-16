import type { Prisma } from "@acropora/database";

/**
 * AZ ESZKOZ-LISTA ALLAPOT-SZUROJE.
 *
 * HAROM FAJTA ERTEK, es a harmadik uj (Balazs kerese, 2026-09-16, Discord,
 * Acropora OS szal): "ide szeretnek egy Beepitett opciot meg amiben minden
 * benne van kiveve a kivezetett eszkozok".
 *
 *   `ALL`          minden, a kivezetettekkel egyutt
 *   `IN_PLACE`     minden, KIVEVE a kivezetetteket      <- ez az uj
 *   egy allapot    pontosan az az egy
 *
 * A KULCS NEVE `IN_PLACE`, A FELIRAT "Beepitett". A ketto szandekosan nem
 * ugyanaz a szo: a felirat Balazse, es azt jelenti, amit o ert alatta, a kulcs
 * viszont azt mondja meg, MIT CSINAL a szuro. Egy `INSTALLED` nevu kulcs azt
 * sugallna, hogy van egy ilyen ALLAPOT az eszkozon -- nincs, es a kovetkezo
 * olvaso azt keresne a semaban.
 *
 * ES AMIT A "BEEPITETT" TENYLEGESEN JELENT: nem azt, hogy MUKODIK. Egy nem
 * uzemelo vagy epp javitas alatt allo eszkoz is ott van a helyen, tehat
 * beleszamit; egyedul a kivezetett esik ki, mert az mar fizikailag sincs ott.
 * A szures ezert TAGADAS, nem felsorolas -- ha felsorolnank a harom allapotot,
 * egy kesobb felvett negyedik CSENDBEN kimaradna belole.
 */
export const ASSET_LIST_STATUS_FILTERS = ["ALL", "IN_PLACE"] as const;
export type AssetListStatusFilter = (typeof ASSET_LIST_STATUS_FILTERS)[number];

export function assetStatusWhere(status: string): Prisma.AssetWhereInput {
  if (status === "ALL") return {};
  /**
   * TAGADAS, NEM FELSOROLAS -- lasd a fenti indokot. A `not` egyetlen ertekre
   * szol, tehat egy uj allapot felvetele MAGATOL bekerul a halmazba, es nem
   * kell ezt a sort utana megkeresni.
   */
  if (status === "IN_PLACE") return { status: { not: "RETIRED" } };
  return { status: status as Prisma.AssetWhereInput["status"] };
}

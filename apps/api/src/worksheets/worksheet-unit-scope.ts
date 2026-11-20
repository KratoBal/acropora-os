import type { Prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * A MUNKALAP EGYSÉG-HATÓKÖRE, EGY SZABÁLY (kártya 5f4af2aa; acrobot 57080, barracuda 57077).
 *
 * Balázs, 2026-09-22 07:46:59 UTC: egy partner-felhasználó CSAK a hozzá rendelt helyszínek dolgait lássa. A lista eddig
 * is így szűrt, a részletes nézet, a lap PDF-je és a többes letöltés (zip, nyomtatás) viszont csak a vevőt nézte: egy
 * egységre korlátozott partner azonosító alapján a vevő MÁS egységének lapját is megkapta. Most a lista (`where`) és a
 * sor (`allowed`) ugyanazt a szabályt olvassa:
 *
 *   belsős, szállító   nem szűkül (a szállítónál ma nincs ilyen fiók, ugyanaz a döntés, mint az eszközöknél)
 *   vevő               csak a hozzá rendelt egységek lapjai; az ÜRES halmaz "semmit" jelent, nem "nem szűrünk"
 *
 * A tiltott lap a részletes útvonalakon 404, ugyanúgy, mint a vevőn kívüli: a létezése se látsszon.
 */
export function worksheetUnitWhere(
  scope: PartnerScope,
  assignedUnitIds: readonly string[],
): Prisma.WorksheetWhereInput {
  return scope.kind === "customer"
    ? { departmentId: { in: [...assignedUnitIds] } }
    : {};
}

export function worksheetUnitAllowed(
  departmentId: string,
  scope: PartnerScope,
  assignedUnitIds: readonly string[],
): boolean {
  return scope.kind !== "customer" || assignedUnitIds.includes(departmentId);
}

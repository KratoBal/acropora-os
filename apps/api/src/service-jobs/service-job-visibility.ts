import type { Prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * KI MELYIK HIBAJEGYET LATJA -- A KET TENGELY EGY SZUROBEN.
 *
 * Balazs modellje (2026-08-26 es 2026-08-31, acrobot atadasaban) KET feltetelt
 * mond, es a ketto EGYUTT ervenyes:
 *
 *   (1) amit O NYITOTT, az az ove
 *   (2) plusz a hozza RENDELT egysegek reszfaja
 *
 * ES A KETTO NEM ATFEDO KENYELEM, HANEM KET KULON LEFEDETTSEG. Merve
 * (2026-09-03): a `ServiceJob.customerId` NULLAZHATO, es a felvitel DTO-jaban
 * `@IsOptional()`. Egy vevo nelkuli jegyhez az EGYSEG-tengelyen NEM LEHET
 * eljutni, mert az uton a vevo all (`ServiceJob.customer ->
 * worksheetDepartments`). Az ilyen jegyet KIZAROLAG a nyito-tengely eri el.
 *
 * Ha tehat a szures csak az egyseg-tengelyre epulne, a vevo nelkuli jegyek
 * SENKINEK nem latszananak -- meg annak sem, aki nyitotta oket.
 *
 * === AMIERT A NYITO A NAPLOBOL JON, ES NEM A JEGYROL ===
 *
 * A `ServiceJob` modellen NINCS `createdById` vagy `openedById` mezo (merve a
 * fo agon). A nyito egyetlen forrasa a keletkezes esemenye a naplotablaban.
 *
 * ES AZ AZONOSITASA BIZONYITHATO, nem heurisztika: az atmenet-tabla
 * (`service-job-transitions.ts`) szerint a `NEW` allapotba EGYETLEN atmenet sem
 * vezet -- csak forraskent szerepel. Tehat `toStatus: "NEW"` kizarolag a
 * keletkezes soran allhat.
 *
 * === HAROM HATAR, AMIT EZ A FUGGVENY NEM OLD MEG ===
 *
 * 1. A naplo aktora `SetNull` a felhasznalo torlesekor (a sema kimondja: "egy
 *    torolt felhasznalo nem viheti magaval a naplot"). Egy torolt felhasznalo
 *    jegyei tehat KIESNEK a nyito-tengelybol -- es ha a jegy ezen felul vevo
 *    nelkuli is, akkor SENKINEK nem latszik tobbe.
 * 2. A `ServiceJobEvent` egyetlen indexe `[serviceJobId, createdAt]`. Az
 *    `actorUserId`-n NINCS index, holott ket rokon naplotabla (`AuditLog`,
 *    `DomainEvent`) mindegyike visel `[actorUserId, ...]` indexet. A
 *    nyito-tengely tehat ma indexeletlen oszlopon szur.
 * 3. Az aktor azt mondja meg, KI IRTA BE az elso sort, nem azt, KIE a jegy. Ma
 *    a ketto egybeesik, mert egyetlen uton keletkezik jegy. Egy masodik
 *    keletkezesi ut (import, portal, agens) eseten szetvalnak, es a lathatosag
 *    CSENDBEN mozdulna el.
 */
export function serviceJobVisibilityWhere(input: {
  scope: PartnerScope;
  userId: string;
  /**
   * A felhasznalohoz rendelt egysegek reszfaja, mar kibontva.
   *
   * URES IS LEHET, es akkor a helyes viselkedes NEM az, hogy mindent enged,
   * hanem hogy CSAK a nyito-tengely marad. Ez a fuggveny legfontosabb agya: egy
   * ures halmazra adott `{}` a teljes jegylistat engedne at.
   */
  unitIds: readonly string[];
}): Prisma.ServiceJobWhereInput {
  // A BELSOS MINDENT LAT, es ez nem kivetel, hanem a szabaly resze: a belsos
  // valasztok teljes halmazt kell lassanak.
  if (input.scope.kind === "internal") return {};

  const nyitoTengely: Prisma.ServiceJobWhereInput = {
    events: { some: { toStatus: "NEW", actorUserId: input.userId } },
  };

  if (input.unitIds.length === 0) return nyitoTengely;

  const egysegTengely: Prisma.ServiceJobWhereInput = {
    customer: {
      worksheetDepartments: { some: { id: { in: [...input.unitIds] } } },
    },
  };

  return { OR: [nyitoTengely, egysegTengely] };
}

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
 * === A NYITO A JEGYEN ALL -- ES EZ A BEKEZDES KORABBAN AZ ELLENKEZOJET ALLITOTTA ===
 *
 * A `ServiceJob` modellen VAN `openedById` mezo (`schema.prisma`, `String?`,
 * sajat indexszel), es EZ A FAJL IRJA is: a `nyitoTengely` where-zaradeka
 * `openedById: input.userId` alakban all, a 60-as sorok korul.
 *
 * ITT KORABBAN AZ ALLT, hogy a modellen NINCS ilyen mezo, "merve a fo agon",
 * es hogy a nyito egyetlen forrasa a naplotabla keletkezes-esemenye. AZ
 * ALLITAS IGAZ VOLT, AMIKOR MEGIRTAK: a nyito tenyleg a naplobol jott. Aztan a
 * mezo bekerult, a lekerdezes atallt ra -- a fejlec viszont nem.
 *
 * MIERT NEM CSAK PONTATLANSAG: ez a bekezdes EGY FAJLON BELUL mondott ellent a
 * sajat kodjanak, negyven sor tavolsagbol. Aki a fejlecet olvassa, a naplotabla
 * fele indul el egy olyan mezoert, ami a jegyen all -- es a kereses, amit
 * inditana, NULLA talalatot adna a helyes nevre.
 *
 * A VALTAS INDOKA valtozatlanul a mezo folott all a semaban; roviden: a naplo
 * aktora `SetNull` a felhasznalo torlesekor, indexeletlen oszlopon szurtunk
 * volna, es az aktor azt mondja meg, ki IRTA BE az elso sort, nem azt, kie a
 * jegy.
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

  // A NYITO MOSTANTOL A JEGYEN ALL, nem a naplobol jon. A valtas indoka a mezo
  // folott all a semaban; roviden: a naplo aktora `SetNull` a felhasznalo
  // torlesekor, indexeletlen oszlopon szurtunk volna, es az aktor azt mondja
  // meg, ki IRTA BE az elso sort, nem azt, kie a jegy.
  /**
   * A NYITO-TENGELY MARAD, ES EZ KULON DONTES (acrobot, 2026-09-22, c654a5d4).
   *
   * Balazs aznap azt valaszolta a hozzarendeles nelkuli portal-felhasznalorol,
   * hogy "akkor semmit se lasson". A KERDES viszont binaris volt: semmit, vagy
   * az ugyfele mindenet -- es a nyito-tengely abban nem szerepelt.
   *
   * Ezert a valaszt NEM terjesztettuk ki ra. Ha elvennenk, egy ember bekuldene
   * egy hibajegyet, es utana nem latna a SAJATJAT: az nem szigoritas, hanem
   * hiba. "Amit te magad kuldtel be, azt latod" a lap alapmukodese.
   *
   * Aki ezt egyszer el akarja venni, lassa, hogy nem elmaradt ag, hanem
   * megnevezett dontes -- es hogy a gazda szava egy MASIK kerdesre szolt.
   */
  const nyitoTengely: Prisma.ServiceJobWhereInput = {
    openedById: input.userId,
  };

  if (input.unitIds.length === 0)
    return input.scope.kind === "customer"
      ? { AND: [{ customerId: input.scope.customerId }, nyitoTengely] }
      : nyitoTengely;

  /**
   * AZ EGYSEG-TENGELY A SORON ALL, NEM A PARTNEREN -- ES EZ EGY ELES HIBA
   * JAVITASA (2026-09-22, c654a5d4).
   *
   * Az elso alak a JEGY UGYFELET szurte arra, hogy birtokol-e olyan egyseget,
   * ami a keronek ki van osztva:
   *
   *     customer: { worksheetDepartments: { some: { id: { in: unitIds } } } }
   *
   * Ez az ugyfel MINDEN jegyere igaz, fuggetlenul attol, melyik egyseghez
   * tartozik a jegy -- tehat a feltetel csendben osszeomlott arra, hogy
   * `customerId = X`. Elesben egy negy helyszinhez rendelt portal-felhasznalo
   * az ugyfel OSSZES jegyet latta.
   *
   * A `ServiceJob` visel sajat `departmentId` mezot, tehat van mire szurni.
   *
   * ES AMIERT A REGI ALAK NEM LATSZOTT HIBASNAK: relacios szuroben a `some`
   * helyes es gyakori alak -- csak nem ezen az oldalon. A kerdes nem az, hogy
   * a partnernek VAN-E ilyen egysege, hanem hogy EZ A SOR abban all-e.
   */
  const egysegTengely: Prisma.ServiceJobWhereInput = {
    departmentId: { in: [...input.unitIds] },
  };

  const visibleThroughUserOrUnit = { OR: [nyitoTengely, egysegTengely] };
  return input.scope.kind === "customer"
    ? {
        AND: [{ customerId: input.scope.customerId }, visibleThroughUserOrUnit],
      }
    : visibleThroughUserOrUnit;
}

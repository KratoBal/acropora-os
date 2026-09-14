import type { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { serviceJobVisibilityWhere } from "./service-job-visibility.js";

/**
 * A HIVO HATOKORE, LEKERDEZHETO ALAKBAN -- EGY FUGGVENYBEN.
 *
 * === MIERT KULON FAJL, HOLOTT A SZOLGALTATASBAN MAR ALL UGYANEZ ===
 *
 * A `ServiceJobsService` PRIVAT `visibilityFor` metodusa beture ezt csinalja.
 * Attol, hogy privat, egy MASIK vegpont (itt: a jegy csatolmanyai) nem eri el
 * -- es ha lemasolja, a szabaly KET helyen all. Egy dokumentum-vegpont, ami
 * tagabb, mint a jegy sajat lathatosaga, nem hibazik: csendben kiszivarogtatja,
 * hogy a jegy LETEZIK.
 *
 * === AMIT EZ MA NEM OLD MEG, ES EZT KIMONDOM ===
 *
 * A `ServiceJobsService` MA MEG a sajat masolatat hasznalja, nem ezt a
 * fuggvenyt. Nem azert, mert ket igazsagot akarunk: az a fajl 2026-09-14-en
 * nyitott munka alatt all (#639), es egy negy soros atvezetes ott felesleges
 * utkozest szulne.
 *
 * AMIG A KETTO KULON ALL, EGY ORZO TARTJA OSSZE OKET:
 * `service-job-documents.visibility-parity.spec.ts` ugyanarra a ket hivora
 * (belsos es partner) lemeri, hogy a szolgaltatas ALTAL A TAROLONAK ATADOTT
 * szuro es az itteni fuggveny eredmenye AZONOS. Ha barmelyik elmozdul, az az
 * allitas pirosra valt.
 *
 * Az orzo NEM ugyanaz, mint a kozos forras -- kevesebb: csak akkor szol, ha
 * valaki lefuttatja. De tobb a semminel, es a kovetkezo olvaso ebbol tudja meg,
 * hogy a ket hely szandekosan all kulon, es meddig.
 *
 * === A HOZZARENDELT EGYSEGEK LEKERDEZESE PARAMETER ===
 *
 * Nem a `ServiceJobsRepository` tipusat kerjuk, hanem egy fuggvenyt: igy az
 * orzo es a tesztek egy hat soros alakot tudnak atadni, es nem kell egy teljes
 * repository-t eloallitani ahhoz, hogy a szurot merni lehessen.
 */
export async function serviceJobVisibilityFor(
  user: AuthenticatedUser,
  assignedUnitIds: (userId: string) => Promise<string[]>,
): Promise<Prisma.ServiceJobWhereInput> {
  const scope = partnerScopeOf(user);
  // A BELSOS HIVONAL A MASODIK LEKERDEZEST EL SEM INDITJUK: a szuro ures, tehat
  // a hozzarendelt egysegek nem szamitanak.
  if (scope.kind === "internal") return {};
  return serviceJobVisibilityWhere({
    scope,
    userId: user.id,
    unitIds: await assignedUnitIds(user.id),
  });
}

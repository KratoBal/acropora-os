import { ForbiddenException } from "@nestjs/common";
import {
  partnerScopeOf,
  type PartnerScope,
} from "../auth/partner-scope.util.js";
import type { AuthenticatedUser } from "@acropora/types";

/**
 * BELSOS IRASI LEPES: A KERO HATOKORE, ES ELUTASITAS, HA NEM BELSOS.
 *
 * === A MERT RES (2026-09-21, a mai fo agon) ===
 *
 * Ot kod-megjegyzes allitotta, hogy "a vegpont SERVICE_MANAGE jog alatt all,
 * amit partner-oldali felhasznalo nem kap meg". A masodik fele HAMIS, es a lanc
 * minden szeme merve:
 *
 *   1. `PARTNER_SERVICE` VISELI a `SERVICE_MANAGE` jogot (auth.ts)
 *   2. a `PermissionGuard` NEM nez hatokort, csak jogot
 *   3. a harom iro vegpont KIZAROLAG a jog alatt allt, hatokor nelkul
 *   4. a szolgaltatas BEEGETETT `{ kind: "internal" }` hatokorrel hivott
 *   5. es `rowBelongsToScope` internal eseten FELTETEL NELKUL igazat ad
 *
 * KONTROLL, hogy az ut nem elmeleti: ugyanezen a kontrolleren a `detail`, az
 * `entries` es a `signers` MAR partner-hatokorrel megy -- vagyis partner-kerok
 * bizonyitottan eljutnak ide.
 *
 * === MIERT ELUTASITAS, ES NEM SZUKITES (acrobot dontese, 2026-09-21) ===
 *
 * A szukites (a partner a SAJAT lapjat szerkesztheti) UJ kepesseget adna, amit
 * senki nem kert -- es egy biztonsagi javitas kozben hoznank meg, tehat senki
 * nem venne eszre, hogy dontottunk. Az elutasitas ma SEMMIT nem vesz el: a harom
 * vegpontnak nincs partner-oldali felulete.
 *
 * ES A KET IRANY ARA NEM SZIMMETRIKUS: az elutasitas kesobb barmikor TAGITHATO,
 * sajat dontessel. A szukites viszont ma eldontene a kerdest, es utana mar csak
 * elvenni lehetne -- valamit, amit addigra hasznalhatnak.
 *
 * === AMIT EZ A FUGGVENY NEM OLD MEG ===
 *
 * Csak ott ved, ahol MEGHIVJAK. A fa tobbi reszen tovabbi beegetett
 * `{ kind: "internal" }` hivasok allnak; azok kulon meres targyai, es ez a
 * fuggveny nem tud roluk.
 */
export function requireInternalWriter(
  actor: AuthenticatedUser,
  /** MIT nem lehet partnerkent: a mondat elejere kerul. */
  muvelet: string,
): PartnerScope {
  const scope = partnerScopeOf(actor);
  if (scope.kind !== "internal")
    throw new ForbiddenException(
      `${muvelet} belsős lépés: partnerként nem végezhető el.`,
    );
  return scope;
}

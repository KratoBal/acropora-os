import type { Prisma } from "@acropora/database";
import {
  hasPermission,
  INTERNAL_ROLES,
  PERMISSIONS,
  type UserRole,
} from "@acropora/types";

/**
 * Kit lehet szerviz-munkára kiosztani: munkalap FELELŐSNEK vagy hibajegyre
 * DELEGÁLTNAK.
 *
 * A szabály nem a szerepkörök felsorolása, hanem a jogosultságból számolt
 * következmény: kiosztható az, aki a szerviz-munkát kezelni is tudja. Egy
 * felsorolt lista némán elavulna, amint egy szerepkör megkapja vagy elveszíti
 * a `service.manage` jogot -- a kiosztás pedig attól még megtörténne, és a
 * kolléga a lapot vagy a jegyet megnyitva nem tudna vele mit kezdeni.
 *
 * A `service.view` szándékosan kevés lenne: a VIEWER LÁTJA a munkát, de nem ír
 * rá, tehát kiosztva néma zsákutcába kerülne.
 *
 * === MIÉRT A KÖZÖS MAPPÁBAN ÁLL, ÉS NEM KÉTSZER ===
 *
 * Ez a szabály 2026-09-14-ig a `worksheets/worksheet-assignment.ts` fájlban
 * élt, munkalap-néven. A hibajegy-delegálás UGYANEZT a kérdést teszi fel,
 * ugyanabból az okból, és a két modul közt ma nincs import.
 *
 * Két rossz út volt, és mind a kettő csendben romlik el:
 *
 *   a szabály MÁSOLÁSA        a két másolat elcsúszik, amint az egyik oldal
 *                             feltétele változik -- és a különbség nem hibázik,
 *                             csak mást enged
 *   a hibajegy IMPORTÁLNÁ     a jegy a munkalap belső szabályától függene,
 *   a munkalap fájljából      holott a kettő egyenrangú
 *
 * Ezért a szabály ide költözött, a `worksheet-under-ticket.ts` mellé, ami már
 * ma is azért áll itt, mert mindkét oldal olvassa. A munkalap-oldali NÉV
 * (`WORKSHEET_ASSIGNABLE_ROLES`) megmaradt, ugyanarra az értékre mutatva, hogy
 * a meglévő hívók és az őrzőjük változatlanul álljanak.
 */
/**
 * === ES AMIERT A JOG ONMAGABAN KEVES (2026-09-17) ===
 *
 * A lista 2026-09-17-ig CSAK a jogbol szamolt, es a `PARTNER_SERVICE` szerep
 * megkapja a `service.manage` jogot -- a sajat hatokoreben joggal. Vagyis a
 * partner-fiok megjelent a felelos-valasztoban, ES ki is lehetett osztani ra a
 * lapot, mert az IRO ut ugyanebbol a listabol ellenorzott.
 *
 * A SZABALY NEM TEVEDETT, HANEM MASRA KERDEZETT: a "ki KAPHAT munkalapot"
 * kerdesre a "kinek van JOGA munkalapot irni" valasz ment. A ketto addig esett
 * egybe, amig minden `service.manage` jogu felhasznalo a sajat kollegank volt;
 * a `PARTNER_SERVICE` bevezetesevel szetvalt, es a szabaly a sajat
 * megfogalmazasaban IGAZ maradt -- csak mar nem azt jelentette.
 *
 * KET FELTETEL ALL RAJTA, es ez nem ovatoskodas: az egyik a SZEREPROL szol
 * (belsos-e), a masik a JOGROL (tud-e vele dolgozni). Egyik sem helyettesiti a
 * masikat -- a VIEWER belsos, de nem ir; a partner ir, de nem a mi emberunk.
 */
export const SERVICE_ASSIGNABLE_ROLES: readonly UserRole[] =
  INTERNAL_ROLES.filter((role) =>
    hasPermission(role, PERMISSIONS.SERVICE_MANAGE),
  );

/**
 * A KIOSZTHATO FELHASZNALO TELJES FELTETELE, EGY HELYEN.
 *
 * MIERT NEM ELEG A SZEREP-LISTA, ES MIERT EGY `where` DARAB: a kioszthatosag
 * KET tengelyen all. A szerep TIPUS-szintu teny (belsos-e, tud-e irni); a
 * PARTNER-KOTES viszont a SOR tulajdonsaga (`customerId`, `supplierId`). A
 * ketto ma egybeesik -- egy kotott fiok kotelezoen `PARTNER_SERVICE`, es
 * kotes nelkul ez a szerep nem is letezhet (`users.service.ts`, 2026-09-17) --,
 * de KET KULON mechanizmus tartja igy. Ha az egyik valaha enged, a masik
 * meg all.
 *
 * EGY FUGGVENY, ES NEM HAROM MASOLAT: ma harom lekerdezes hasznalja (a
 * valaszto listaja, a munkalap-mentes ellenorzese, es a hibajegy-delegalas). Ha
 * a feltetel harom helyen allna, egy negyedik hivo a szerep-szurot orokolne, a
 * kotes-szurot nem -- es az elteres NEM hibazna, csak tobbet engedne.
 */
export function assignableUserWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    role: { in: [...SERVICE_ASSIGNABLE_ROLES] },
    customerId: null,
    supplierId: null,
  };
}

/**
 * A beküldött kiosztás-lista rendbetétele: üres elemek el, ismétlődés
 * összevonva.
 *
 * Az ismétlődés nem elméleti: a felületen egy nevet kétszer kiválasztva a
 * kapcsolótábla egyedi kulcsa hibát dobna, pedig a szándék egyértelmű, és az
 * eredmény ugyanaz a lap vagy jegy.
 */
export function normalizeAssigneeIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
}

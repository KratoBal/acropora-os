import type { Prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * KI MELYIK AKVÁRIUMOT LÁTJA -- A HELYSZÍN-TENGELY, A HIBAJEGY MINTÁJA
 * SZERINT.
 *
 * Balázs döntése (2026-09-25, Partner Portál Akváriumok terv, emlék 1839):
 * a `PARTNER_SERVICE` a SAJÁT ügyfelének akváriumait látja, a hozzá
 * RENDELT helyszínek részfája szerint -- ugyanaz a két feltétel, mint a
 * `ServiceJob` "egység-tengelye" (`service-job-visibility.ts`), csak
 * EGYETLEN tengellyel: az akváriumnak nincs "nyitója", tehát a nyitó-
 * tengely itt nem értelmezhető, és nem is kell.
 *
 * A FELTÉTEL A SORON ÁLL (`Aquarium.departmentId`), NEM AZ ÜGYFÉL
 * RELÁCIÓJÁN ÁT -- ugyanaz a hiba, amit a `service-job-visibility.ts`
 * fejléce ír le, ugyanígy elkerülve: egy `customer: { worksheetDepartments:
 * { some: { id: { in: unitIds } } } }` alak az ÜGYFÉL MINDEN akváriumára
 * igaz lenne, függetlenül attól, melyik helyszínhez tartozik a SOR.
 *
 * ÜRES `unitIds`-nél NEM `{}` (az a teljes listát engedné), hanem explicit
 * üres eredmény -- Balázs szava máshol, ugyanerre az esetre: "akkor semmit
 * se lásson".
 *
 * A HELYSZÍN NÉLKÜLI AKVÁRIUM (departmentId === null) egy hozzárendeléssel
 * rendelkező partner-fióknak NEM LÁTSZIK -- ez KÖVETKEZIK a `departmentId:
 * { in: unitIds } }` alakból (a `null` sosem eleme egy `in` listának), és
 * ez szándékos: a meglévő, helyszín nélkül maradt akváriumok (lásd az
 * `Aquarium.departmentId` séma-fejlécét) nem válnak láthatóvá csak azért,
 * mert valakinek van kiosztott helyszíne.
 */
export function aquariumVisibilityWhere(input: {
  scope: PartnerScope;
  unitIds: readonly string[];
}): Prisma.AquariumWhereInput {
  if (input.scope.kind === "internal") return {};
  // A SZÁLLÍTÓ-HATÓKÖR itt nem értelmezett: az akvárium ügyfélhez tartozik,
  // szállítóhoz soha. Ugyanaz az explicit-üres válasz, mint a hozzárendelés
  // nélküli vevő-hatókörnél.
  if (input.scope.kind === "supplier") return { id: { in: [] } };
  if (input.unitIds.length === 0) return { id: { in: [] } };
  return {
    AND: [
      { customerId: input.scope.customerId },
      { departmentId: { in: [...input.unitIds] } },
    ],
  };
}

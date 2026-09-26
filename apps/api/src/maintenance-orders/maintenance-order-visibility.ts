import { prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * KI MELYIK MEGRENDELŐLAPOT LÁTJA -- A SZABÁLY, AMIT ACROBOT ADOTT (msg_id
 * 23868, 2026-09-25 22:17 UTC), A SAJÁT TERV-JAVASLATOM HELYETT.
 *
 * === MIÉRT NEM EGYSZERŰ `Prisma.MaintenanceOrderWhereInput` ===
 *
 * Az `Aquarium`/`ServiceJob` láthatósága egy soron álló `departmentId`
 * mezőt szűr -- egy relációs `where`-ágból ez közvetlenül kifejezhető. A
 * `MaintenanceOrder`-nek NINCS saját `departmentId`-je: a helyszín
 * TÉTELENKÉNT, a `MaintenanceOrderItem.contractItem.departmentId`-n át
 * jön, és a szabály "MINDEN tétel a hatókörben legyen" -- ez egy "minden
 * kapcsolódó sorra igaz" (`every`) feltétel, PLUSZ egy külön ág arra az
 * esetre, ha egy tételnek egyáltalán nincs helyszíne. A `null`-departmentId
 * ág (lásd lent) nem fejezhető ki relációs `where`-ként, mert azt kérdezi,
 * hogy a HÍVÓ hatóköre lefedi-e az ÜGYFÉL TELJES helyszín-fáját -- ez egy
 * halmaz-összehasonlítás, nem egy soron álló mező vizsgálata. Ezért a
 * szűrés KÉT LÉPÉSBEN megy: a `contract.customerId` DB-szinten szűr (ez
 * relációs feltétel), a "minden tétel hatókörben van" alkalmazás-szinten,
 * a már betöltött tételeken.
 *
 * === A SZABÁLY ===
 *
 *   - a rendelés LÁTHATÓ, ha MINDEN tételének helyszíne
 *     (`MaintenanceOrderItem.contractItem.departmentId`) a hívó
 *     hatókörében (`unitIds`) van;
 *   - egy helyszín NÉLKÜLI tétel VEVŐ-SZINTŰNEK számít: egy ilyen tételt
 *     hordozó rendelést csak az lát, akinek a hatóköre a TELJES ügyfelet
 *     lefedi (`customerFullyCoveredByUnits`);
 *   - ez a szigorúbb irány: ha a több-helyszínes kérdés (Balázs, 2026-09-25
 *     05:31, emlék 1833) később eldől, a szabály legfeljebb BŐVÜL, nem
 *     szűkül.
 *
 * === MIÉRT NEM TUDOK MA POZITÍV PÉLDÁT MUTATNI A "TÖBB HELYSZÍN" ÁGRA ===
 *
 * A `MaintenanceOrdersService.issue()` `ensureSingleDepartment()`-je MA
 * elutasít minden kiállítást, aminek a tételei egynél több különböző
 * helyszínre mutatnának -- ÉS ugyanezt az ellenőrzést `uploadSignedDocument()`
 * is megismétli, az aláírás visszaérkezésekor. A helyszín nélküli tételt is
 * kizárja a kiállítás (`helyszinNelkul` ellenőrzés). Vagyis a MAI
 * konstrukció szerint egy `MaintenanceOrder` MINDIG pontosan egy,
 * NEM NULL helyszínre mutat -- a "több helyszín" és a "helyszín nélküli
 * tétel" ág ma bizonyíthatóan LEHETETLEN, nem csak valószínűtlen. A szabály
 * ennek ellenére a TELJES, általános alakban készült, mert acrobot
 * kifejezetten ezt kérte, és mert a jövőben (ha a nyitott kérdés eldől)
 * ennek nem szabad újra megíródnia.
 */
export interface MaintenanceOrderLocationView {
  /** A rendelés tételeinek EGYEDI, NEM NULL helyszín-azonosítói. */
  readonly departmentIds: readonly string[];
  /** Igaz, ha VAN legalább egy helyszín nélküli tétel a rendelésen. */
  readonly hasCustomerWideItem: boolean;
}

export function maintenanceOrderLocationView(
  items: readonly { contractItem: { departmentId: string | null } }[],
): MaintenanceOrderLocationView {
  const departmentIds = [
    ...new Set(
      items
        .map((item) => item.contractItem.departmentId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const hasCustomerWideItem = items.some(
    (item) => item.contractItem.departmentId === null,
  );
  return { departmentIds, hasCustomerWideItem };
}

/**
 * IGAZ, HA A PORTÁL HÍVÓ LÁTHATJA EZT A RENDELÉST -- A FENTI SZABÁLY,
 * KIÉRTÉKELVE.
 *
 * A BELSŐS HÍVÓRA EZT NEM HÍVJUK MEG (a hívó oldal `scope.kind === "internal"`
 * ágon nem szűr) -- ugyanaz a minta, mint a többi láthatósági függvénynél.
 */
export function maintenanceOrderVisibleToScope(
  location: MaintenanceOrderLocationView,
  input: {
    readonly unitIds: readonly string[];
    readonly customerCovered: boolean;
  },
): boolean {
  if (location.hasCustomerWideItem) return input.customerCovered;
  if (location.departmentIds.length === 0) return false;
  const unitSet = new Set(input.unitIds);
  return location.departmentIds.every((id) => unitSet.has(id));
}

/**
 * IGAZ, HA `unitIds` LEFEDI AZ ÜGYFÉL TELJES HELYSZÍN-FÁJÁT.
 *
 * Csak a "helyszín nélküli tétel" ágnál kell -- lásd a fájl fejlécét.
 * Üres `unitIds` sosem fedi le (egy hozzárendelés nélküli hívó nem lát
 * semmit, ugyanaz a szabály, mint a testvér láthatósági függvényeknél).
 */
export async function customerFullyCoveredByUnits(
  customerId: string,
  unitIds: readonly string[],
): Promise<boolean> {
  if (unitIds.length === 0) return false;
  const all = await prisma.worksheetDepartment.findMany({
    where: { customerId },
    select: { id: true },
  });
  if (all.length === 0) return false;
  const unitSet = new Set(unitIds);
  return all.every((row) => unitSet.has(row.id));
}

/** Csak a `contract.customerId`-re szűrő DB-ág -- lásd a fájl fejlécét, miért csak ennyi. */
export function maintenanceOrderCustomerWhere(scope: PartnerScope) {
  if (scope.kind === "internal") return {};
  if (scope.kind === "supplier")
    return { contract: { id: { in: [] as string[] } } };
  return { contract: { customerId: scope.customerId } };
}

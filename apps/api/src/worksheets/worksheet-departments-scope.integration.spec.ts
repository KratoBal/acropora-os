import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { WorksheetsRepository } from "./worksheets.repository.js";

/**
 * A HELYSZIN-LISTA A KIOSZTOTT HELYSZINEKRE SZUKUL.
 *
 * Balazs dontese, 2026-09-22: "idegen helyszinre nem is tud jegyet nyitni".
 * A lista a valaszto forrasa, tehat a szukites ITT kezdodik.
 *
 * MIERT INTEGRACIOS. A `WorksheetsRepository` konstruktora nem vesz at
 * adatbazist (`constructor()`), tehat duplaval nem peldanyosithato -- a szukites
 * csak valodi lekerdezesen merheto. Ugyanaz az alak, mint a tobbi
 * `*.integration.spec.ts` a fajlban: az ELSO futasa a CI.
 *
 * A HARMADIK ALLITAS A LENYEG: a BELSOS hatokor NEM szukul. A belsos fiokok
 * nulla hozzarendelessel dolgoznak, tehat egy hatokor nelkuli szukites a sajat
 * szerelonknek URES valasztot adna -- a rendszer nalunk allna meg.
 */

const gate = integrationDatabaseGate(process.env);
const PREFIX = "ITDEPTSCOPE";

const BELSOS: PartnerScope = { kind: "internal" };

let ugyfelId = "";
let kroId = "";
let akvId = "";
const repository = new WorksheetsRepository();

async function takarit() {
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

/**
 * A kod harom karakter -- ez itt csak a fixture rovidsege, nem hatar: a
 * `WorksheetDepartment.code` tipusa 2026-09-23 ota `@db.VarChar(5)`.
 */
async function egyseg(kod: string, nev: string) {
  const row = await prisma.worksheetDepartment.create({
    data: { customerId: ugyfelId, code: kod, name: nev, parentId: null },
    select: { id: true },
  });
  return row.id;
}

describe("a helyszín-lista hatóköre", { skip: gate.mode === "skip" }, () => {
  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await takarit();
    const ugyfel = await prisma.customer.create({
      data: {
        customerNumber: `${PREFIX}001`,
        type: "COMPANY",
        displayName: `${PREFIX} Teszt Ugyfel`,
      },
      select: { id: true },
    });
    ugyfelId = ugyfel.id;
    kroId = await egyseg("KRO", "Krokodilház");
    akvId = await egyseg("AKV", "Akvárium");
  });

  after(takarit);

  it("a vevő-hatókör CSAK a kiosztott helyszínt kapja", async () => {
    const vevo: PartnerScope = { kind: "customer", customerId: ugyfelId };

    const eredmeny = await repository.departments(ugyfelId, vevo, [kroId]);

    assert.deepEqual(
      eredmeny.items.map((sor) => sor.code),
      ["KRO"],
    );
  });

  /**
   * KONTROLL: a MASIK helyszinre szukitve a MASIK jon. Enelkul a fenti
   * allitas egy olyan megvalositason is zold lenne, ami MINDIG az elso sort
   * adja vissza.
   */
  it("KONTROLL: másik kiosztásra másik helyszín jön", async () => {
    const vevo: PartnerScope = { kind: "customer", customerId: ugyfelId };

    const eredmeny = await repository.departments(ugyfelId, vevo, [akvId]);

    assert.deepEqual(
      eredmeny.items.map((sor) => sor.code),
      ["AKV"],
    );
  });

  it("ÜRES kiosztásnál üres a lista", async () => {
    const vevo: PartnerScope = { kind: "customer", customerId: ugyfelId };

    const eredmeny = await repository.departments(ugyfelId, vevo, []);

    assert.deepEqual(eredmeny.items, []);
  });

  /**
   * ES A MASIK IRANY, AMI A RENDSZERT NALUNK ALLITANA MEG.
   */
  it("a BELSŐS hatókör MINDET látja, nulla kiosztással is", async () => {
    const eredmeny = await repository.departments(ugyfelId, BELSOS, []);

    assert.deepEqual(eredmeny.items.map((sor) => sor.code).sort(), [
      "AKV",
      "KRO",
    ]);
  });
});

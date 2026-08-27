import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  assertPartnerCodeFree,
  assertPartnerCodeFreeForCustomer,
} from "./suppliers.repository.js";

/**
 * AMIT EZ A SUITE ŐRIZ, ÉS AMIÉRT NEM MAKETTEL: a makett azt állítja, mit KÉR a
 * mi kódunk; ez azt, hogy az adatbázis mit CSINÁL vele. 2026-08-27-én épp azt
 * mértük meg, hogy a kettő eltérhet, és hogy a HIEDELMÜNK volt hibás, nem a
 * kódunk -- vagyis pontosan az a réteg törékeny, amit a makett nem fed.
 *
 * A tárgy a NULL viselkedése a tagadó szűrőkben, két alakban, amelyek a hívás
 * helyén megkülönböztethetetlenek:
 *
 *   RELÁCIÓ: `partner: { isNot: { id } }`  ->  a Prisma hozzáteszi az IS NULL
 *            ágat, tehát a kapcsolat NÉLKÜLI sor BENNE van a találatban.
 *   SKALÁR:  `NOT: { customerId }`         ->  nincs IS NULL ág, tehát a
 *            `customerId IS NULL` sor KIMARAD.
 *
 * Az első a mi kódunk helyességének FELTÉTELE, de nem a mi döntésünk: a Prisma
 * megvalósításán múlik. Ha egy jövőbeli verzió elhagyja azt az ágat, az
 * `assertPartnerCodeFree` CSENDBEN romlik el -- egy létező sor nem jön vissza,
 * hibaüzenet nincs, a lekérdezés helyesnek látszik. Ez a suite az, ami akkor
 * megszólal.
 *
 * A második azért áll itt, mert ez az indoka annak, hogy a vevő-oldali
 * ellenőrzés JavaScriptben hasonlít, nem a `where` feltételben. Aki azt
 * fölösleges körnek látja, itt találja meg, miért nem az.
 *
 * A suite sorokat hoz létre és töröl, ezért csak tesztelésre megnevezett
 * adatbázison fut; lásd integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "NULLSEM-";

describe(
  "the NULL behaviour the partner code checks rely on",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    // A kód-oszlop a szállító oldalon `VarChar(4)`, tehát a próbakód HÁROM
    // jegynél nem lehet hosszabb. A hosszabb `suffix` a nevekbe és a
    // számokba megy, ahol nincs ilyen korlát.
    const short = (suffix % 1000).toString().padStart(3, "0");
    const plainCustomerCode = `P${short}`;
    const mirrorlessCode = `M${short}`;
    let mirrorlessSupplierId: string;
    let plainCustomerId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      // Egy SIMA vevő: kódja van, szállító NEM mutat rá. Ez az a sor, amit a
      // reláció-tagadás elejtene, ha a Prisma nem tenné hozzá az IS NULL ágat.
      const plainCustomer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}VEVO-${suffix}`,
          type: "COMPANY",
          displayName: `${PREFIX}Sima Vevő Kft.`,
          worksheetPartnerCode: plainCustomerCode,
        },
      });
      plainCustomerId = plainCustomer.id;

      // Egy TÜKÖR NÉLKÜLI szállító: kódja van, `customerId` NULL. Ez az a sor,
      // amit a skalár-tagadás elejt.
      const supplier = await prisma.supplier.create({
        data: {
          code: `${PREFIX}SZALL-${suffix}`,
          name: `${PREFIX}Tükör Nélküli Kft.`,
          isSupplier: true,
          isService: false,
          worksheetPartnerCode: mirrorlessCode,
        },
      });
      mirrorlessSupplierId = supplier.id;
    });

    after(removeLeftovers);

    /**
     * A MI KÓDUNK, valódi adatbázison. Az `assertPartnerCodeFree` a vevő-oldalt
     * `partner: { isNot: { id } }` szűrővel nézi. Ha ez a sima vevőt elejtené,
     * a mentés átmenne, és két külön táblában ülne ugyanaz a kód.
     *
     * NEGATÍV KONTROLL: írd át a szűrőt olyan alakra, ami nem kezeli a NULL
     * esetet (például `partner: { id: { not: supplierId } }`), és ennek a
     * tesztnek pirosra kell váltania.
     */
    it("refuses a code held by a customer that has no partner row", async () => {
      await assert.rejects(
        () =>
          prisma.$transaction((tx) =>
            assertPartnerCodeFree(tx, plainCustomerCode, mirrorlessSupplierId),
          ),
        new RegExp(`PARTNER_CODE_TAKEN:${PREFIX}Sima Vevő Kft\\.`),
      );
    });

    /**
     * A VEVŐ-OLDALI ELLENŐRZÉS, ugyanezen az adaton. Ez az az eset, amiért az
     * összehasonlítás JavaScriptben van: a kódot egy TÜKÖR NÉLKÜLI szállító
     * viseli, tehát `customerId IS NULL`, és a vevő-oldali egyedi index sem
     * fogja meg, mert vevő-soron az a kód nem szerepel.
     *
     * NEGATÍV KONTROLL, és pont ez a lényege: vidd vissza az összehasonlítást a
     * `where` feltételbe (`NOT: { customerId }`), és ennek a tesztnek pirosra
     * kell váltania -- a skalár-tagadás elejti a NULL sort, tehát az ellenőrzés
     * ÁTENGEDNÉ a kódot. Ha nem vált pirosra, a spec nem azt méri, amit hiszünk
     * róla.
     */
    it("refuses a code a mirrorless supplier holds, from the customer side", async () => {
      await assert.rejects(
        () =>
          prisma.$transaction((tx) =>
            assertPartnerCodeFreeForCustomer(
              tx,
              mirrorlessCode,
              plainCustomerId,
            ),
          ),
        new RegExp(
          `PARTNER_CODE_TAKEN_BY_SUPPLIER:${PREFIX}Tükör Nélküli Kft\\.`,
        ),
      );
    });

    /**
     * A KÖNYVTÁR VISELKEDÉSE, kimondva. Nem a mi döntésünk, tehát a mi
     * tesztünk nélkül bármikor visszavonható anélkül, hogy tudnánk róla.
     *
     * Ez a kettő EGYÜTT állítja azt, amiért az egész suite van: a két tagadó
     * alak MÁSKÉPP bánik a NULL értékkel. Ha valaha egyformán bánnának, az
     * egyik állítás pirosra vált, és akkor a vevő-oldali JavaScript
     * összehasonlítás indokát újra kell gondolni.
     */
    it("keeps a null relation in a negated RELATION filter", async () => {
      const found = await prisma.customer.findFirst({
        where: {
          worksheetPartnerCode: plainCustomerCode,
          partner: { isNot: { id: mirrorlessSupplierId } },
        },
        select: { displayName: true },
      });

      assert.equal(found?.displayName, `${PREFIX}Sima Vevő Kft.`);
    });

    it("drops a null column from a negated SCALAR filter", async () => {
      const withoutFilter = await prisma.supplier.findFirst({
        where: { worksheetPartnerCode: mirrorlessCode },
        select: { name: true, customerId: true },
      });
      // Kontroll: a sor létezik, és a `customerId` tényleg NULL. Enélkül az
      // alatta lévő `null` eredmény azt is jelenthetné, hogy nincs is ilyen sor.
      assert.equal(withoutFilter?.name, `${PREFIX}Tükör Nélküli Kft.`);
      assert.equal(withoutFilter?.customerId, null);

      const withNegation = await prisma.supplier.findFirst({
        where: {
          worksheetPartnerCode: mirrorlessCode,
          NOT: { customerId: "customer-that-does-not-exist" },
        },
        select: { name: true },
      });

      assert.equal(withNegation, null);
    });
  },
);

async function removeLeftovers() {
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

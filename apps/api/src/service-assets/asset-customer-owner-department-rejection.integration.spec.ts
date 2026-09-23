import "reflect-metadata";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * A `CUSTOMER_OWNER` ELUTASÍTÁS -- MÁR A #1013 (`cb3b562f`) IS BEKÖTÖTTE, ÉS EZ A
 * SPEC EZT MÉRI, NEM EGY ÚJ JAVÍTÁST.
 *
 * A kártya (61c5fef7) ugyanazt a holt-kód mintát nevezte meg, mint a NOT_FOUND /
 * OTHER_PARTNER / INACTIVE ágaknál: a `create()`/`update()` sosem adta át a
 * `departmentId`-t a `validateReferences()`-nek, tehát a `requested` mindig
 * `false` volt, és a `CUSTOMER_OWNER` sem sülhetett el.
 *
 * A #1013 EZT A NÉGYET EGYSZERRE OLDOTTA MEG: a `departmentId: input.departmentId`
 * sor MINDKÉT hívásban FELTÉTEL NÉLKÜL kerül be (nem `ownerType === "SUPPLIER"`-hez
 * kötve, ahogy a `customerAddressId`/`aquariumId` van), tehát egy CUSTOMER-tulajdonú
 * kérésen is eljut a `departmentId` a szabályig -- és az `assetDepartmentRefusal()`
 * a `CUSTOMER_OWNER` ágat MÉG A `NOT_FOUND` ELLENŐRZÉSE ELŐTT kiértékeli.
 *
 * EZÉRT EZ A SPEC NEM ÚJ BEKÖTÉS, HANEM MÉRÉS: bizonyítja, hogy az ág MA MÁR
 * elsül a valós HTTP úton, mielőtt bárki újra "megjavítaná" ugyanazt a sort.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "CUSTOWN";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a CUSTOMER_OWNER elutasítás a felvitel/módosítás valós útján",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );

    let customerId = "";
    let departmentId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      internalUser = {
        id: user.id,
        email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
        displayName: `${PREFIX} aktor`,
        role: "OWNER",
        customerId: null,
        supplierId: null,
      } as AuthenticatedUser;

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-1`,
          type: "COMPANY",
          displayName: `${PREFIX} vevő`,
        },
        select: { id: true },
      });
      customerId = customer.id;

      /*
        A DEPARTMENT VALÓS ÉS AKTÍV -- SZÁNDÉKOSAN. A cél annak mérése, hogy a
        CUSTOMER_OWNER a NOT_FOUND/OTHER_PARTNER/INACTIVE ELŐTT dől el: ha egy
        teljesen érvényes, ugyanahhoz a vevőhöz tartozó alegységgel is elutasít,
        az bizonyítja, hogy a tulajdonos TÍPUSA önmagában elég az elutasításhoz,
        nem csak a hiányzó/idegen/inaktív alegység.
      */
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId,
          code: "SAJ",
          name: `${PREFIX} saját alegység`,
        },
        select: { id: true },
      });
      departmentId = department.id;
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite eszközei bent maradtak a takarítás után",
          darab: await prisma.asset.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite vevője bent maradt a takarítás után",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite aktora bent maradt a takarítás után",
          darab: await prisma.user.count({
            where: { email: { startsWith: PREFIX.toLowerCase() } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("create(): vevő-tulajdonú eszközön a departmentId elutasítja a felvitelt", async () => {
      const name = `${PREFIX} create teszt`;
      await assert.rejects(
        () =>
          assets.create(
            {
              ownerType: "CUSTOMER",
              ownerId: customerId,
              kind: "EQUIPMENT",
              name,
              departmentId,
            } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /Alegység csak szerviz partner eszközéhez rendelhető/,
          );
          return true;
        },
      );
      assert.equal(await prisma.asset.count({ where: { name } }), 0);
    });

    it("KONTROLL: departmentId nélkül a vevő-tulajdonú felvitel változatlanul átmegy", async () => {
      /*
        ENÉLKÜL A FENTI TESZT NEM BIZONYÍTANA SEMMIT: ha a CUSTOMER-tulajdonú
        felvitel MAGÁTÓL is elutasítana bármi miatt, a fenti "elutasítja" teszt
        hamis bizonyítékot adna. Ez a kontroll azt méri, hogy a KÉT ÁLLÁS
        (departmentId van kontra nincs) TÉNYLEG más eredményt ad.
      */
      const name = `${PREFIX} kontroll teszt`;
      const created = await assets.create(
        {
          ownerType: "CUSTOMER",
          ownerId: customerId,
          kind: "EQUIPMENT",
          name,
        } as never,
        internalUser,
      );
      assert.ok((created as { id: string }).id);
      assert.equal(await prisma.asset.count({ where: { name } }), 1);
    });

    it("update(): vevő-tulajdonú eszközön a departmentId hozzáadása elutasítja a módosítást", async () => {
      const name = `${PREFIX} update teszt`;
      const created = await assets.create(
        {
          ownerType: "CUSTOMER",
          ownerId: customerId,
          kind: "EQUIPMENT",
          name,
        } as never,
        internalUser,
      );
      const assetId = (created as { id: string }).id;

      await assert.rejects(
        () => assets.update(assetId, { departmentId } as never, internalUser),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /Alegység csak szerviz partner eszközéhez rendelhető/,
          );
          return true;
        },
      );

      // ÉS A MEGLÉVŐ SOR VÁLTOZATLAN MARADT: az elutasítás nem írt félbe semmit.
      const stored = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { departmentId: true },
      });
      assert.equal(stored?.departmentId, null);
    });
  },
);

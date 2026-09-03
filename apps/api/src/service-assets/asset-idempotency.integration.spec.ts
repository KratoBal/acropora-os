import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import type { CreateAssetDto } from "./dto/asset.dto.js";

/**
 * A HELYSZÍNI RÖGZÍTÉS IDEMPOTENCIÁJA, ADATBÁZISON.
 *
 * MIÉRT NEM ELÉG AZ EGYSÉGTESZT. Amit itt mérünk, azt részben a TÁBLA őrzi: az
 * egyedi index az, ami két PÁRHUZAMOS kérést elvág, miután mindkettő átment a
 * kód előzetes keresésén. Egy mockolt tárolóval ez a rés láthatatlan marad --
 * a kód mindkét ágon "helyesen" viselkedne.
 *
 * ÉS AMIT UGYANITT MÉRÜNK MÁSIK IRÁNYBAN: hogy a KULCS NÉLKÜLI felvitel
 * továbbra is létrehoz. A webes űrlap nem küld kulcsot, és ma működik -- egy
 * javítás, ami csendben kötelezővé teszi a mezőt, azt állítaná le.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITIDEM";
const repository = new ServiceAssetsRepository();

const KULCS = "asset-create:Z9101:2026-09-03T10:00:00.000Z";
const MASIK_KULCS = "asset-create:Z9102:2026-09-03T10:00:00.000Z";

let customerId = "";
let actorUserId = "";

function createInput(over: Partial<CreateAssetDto> = {}): CreateAssetDto {
  return {
    ownerType: "CUSTOMER",
    ownerId: customerId,
    kind: "EQUIPMENT",
    name: `${PREFIX} teszteszköz`,
    ...over,
  } as CreateAssetDto;
}

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { clientOperationId: { in: [KULCS, MASIK_KULCS] } },
  });
  await prisma.asset.deleteMany({
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
  "az eszköz-felvitel idempotenciája",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      // A "refuse" ág NEM ugyanaz, mint a "skip": ott a hívó KÉRTE az
      // integrációs futást, és hiányzik hozzá valami.
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-1`,
          displayName: `${PREFIX} vevő`,
          type: "COMPANY",
        },
        select: { id: true },
      });
      customerId = customer.id;
      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      actorUserId = user.id;
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    it("UGYANAZ a kulcs kétszer EGY eszközt ad", async () => {
      /*
        EZ AZ ALLITAS A MEZO LETEZESENEK OKA. A sor a halozati hibat
        SZANDEKOSAN ujraprobalja, mert offline az a normalis allapot -- es
        pontosan ott lehet, hogy a szerver mar letrehozta az eszkozt, es csak a
        valasz veszett el.

        MI PIROSIT: a kulcsra kereses elhagyasa a letrehozas elol.
      */
      const elso = await repository.create(
        createInput({ clientOperationId: KULCS }),
        actorUserId,
      );
      const masodik = await repository.create(
        createInput({ clientOperationId: KULCS }),
        actorUserId,
      );

      assert.equal(masodik.id, elso.id);
      // ES A TABLABAN IS EGY SOR ALL: a valasz egyezese onmagaban meg jöhetne
      // ket rekordbol is, ha a masodik olvasas a masik sort talalna el.
      const darab = await prisma.asset.count({
        where: { clientOperationId: KULCS },
      });
      assert.equal(darab, 1);
    });

    it("MÁSIK kulcs MÁSIK eszközt ad", async () => {
      // TESTVER-KONTROLL: e nelkul egy valtozat, ami MINDIG az elso eszkozt
      // adja vissza, atmenne a fenti allitason.
      const masik = await repository.create(
        createInput({ clientOperationId: MASIK_KULCS }),
        actorUserId,
      );
      const elso = await prisma.asset.findUnique({
        where: { clientOperationId: KULCS },
        select: { id: true },
      });
      assert.notEqual(masik.id, elso?.id);
    });

    it("KULCS NÉLKÜL továbbra is minden hívás LÉTREHOZ", async () => {
      /*
        A MASIK IRANY, ES EZ VEDI A WEBES URLAPOT. A webes felvitel nem kuld
        kulcsot; ha a javitas csendben kotelezove tenne a mezot, vagy a
        kulcs nelkuli hivasokat osszevonna, az az urlap MUKODESET allitana le.

        A NULL nem egyenlo onmagaval, tehat az egyedi index sem akadalyozza a
        kulcs nelkuli sorokat.
      */
      const egyik = await repository.create(createInput(), actorUserId);
      const masik = await repository.create(createInput(), actorUserId);
      assert.notEqual(masik.id, egyik.id);
    });
  },
);

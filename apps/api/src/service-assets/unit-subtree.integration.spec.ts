// A lista-DTO `@Type()` dekoratort hasznal (class-transformer), ami a
// `Reflect.getMetadata` fuggvenyt keresi. A modul-import SORRENDJE szamit: ennek
// a sornak a DTO behuzasa ELOTT kell allnia, kulonben a fajl betoltesekor dob.
import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { AssetListQueryDto } from "./dto/asset.dto.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";

/**
 * BELSOS HATOKOR, KIIRVA. A `list()` kotelezo `scope` parametert kapott (a
 * partner-hatokoru hozzaferes miatt), es epp ezert kellett minden hivasi
 * helynek MEGMONDANIA, kinek a neveben kerdez -- a fordito sorolta fel oket, ez
 * a spec is koztuk volt. Itt a valasz belsos: a suite az alegyseg-szurot meri,
 * nem a jogosultsagot, es egy szukitett hatokor elfedne a mert viselkedest. A
 * partner-oldalt kulon suite meri
 * (`auth/partner-scope-endpoint.integration.spec.ts`).
 */
const INTERNAL: PartnerScope = { kind: "internal" };

/**
 * AZ ALEGYSÉG SZERINTI SZŰRÉS, ADATBÁZISON.
 *
 * MIÉRT KELL, HA A BEJÁRÁSNAK MÁR VAN EGYSÉGTESZTJE. A `unit-subtree.spec.ts` a
 * tiszta függvényt méri: sorokat kap, azonosítókat ad. Két dolgot NEM tud
 * megmérni, és pont azok a kockázatosak:
 *
 * 1. A REPOSITORY „nincs ilyen alegység" ÁGÁT. Ott a szűrő a saját, nem létező
 *    azonosítójára szűkül, tehát üres az eredmény. A csábító alternatíva --
 *    nincs szűrő -- egy ELGÉPELT azonosítóra a TELJES eszközlistát adná vissza,
 *    hibaüzenet nélkül. Ezt az ágat a PR 270 kifejezetten lefedetlenként adta
 *    le; ez a fájl pótolja.
 * 2. Hogy a bejárás eredménye tényleg a `where` záradékba kerül-e. Egy helyes
 *    függvény és egy rossz bekötés együtt is zöld egységtesztet ad.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITSUB";
const repository = new ServiceAssetsRepository();

let customerId = "";
let rootId = "";
let childId = "";
let grandChildId = "";
let siblingId = "";

function query(over: Partial<AssetListQueryDto>): AssetListQueryDto {
  // A DTO-ból jöjjenek az alapértékek (page, pageSize, status), ne az
  // emlékezetből: validációs pipe itt nem fut.
  return Object.assign(new AssetListQueryDto(), over);
}

/**
 * A TAKARÍTÁS LEVÉLRŐL GYÖKÉR FELÉ HALAD, és ez nem stílus: a `parentId`
 * kapcsolaton `Restrict` áll (docs/DECISIONS.md, „ADR-010 – A szervizpartner
 * helyszínei fát alkotnak"), tehát egyetlen `deleteMany` a fa fölött a törlési
 * sorrendtől függően elhasal. Az eszközök még előbb mennek: az
 * `Asset.departmentId` szintén `Restrict`.
 */
async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  const units = await prisma.worksheetDepartment.findMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
    select: { id: true, parentId: true },
  });
  // Levelektől felfelé: minden körben azokat töröljük, amiknek nincs élő
  // gyerekük a maradék halmazban.
  let remaining = units;
  while (remaining.length > 0) {
    const parents = new Set(
      remaining.map((unit) => unit.parentId).filter(Boolean),
    );
    const leaves = remaining.filter((unit) => !parents.has(unit.id));
    if (leaves.length === 0) break;
    await prisma.worksheetDepartment.deleteMany({
      where: { id: { in: leaves.map((leaf) => leaf.id) } },
    });
    remaining = remaining.filter((unit) => !leaves.includes(unit));
  }
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

async function unit(name: string, code: string, parentId: string | null) {
  const row = await prisma.worksheetDepartment.create({
    data: { customerId, code, name, parentId },
    select: { id: true },
  });
  return row.id;
}

async function asset(suffix: string, departmentId: string | null) {
  await prisma.asset.create({
    data: {
      assetNumber: `${PREFIX}-${suffix}`,
      name: `${PREFIX} ${suffix}`,
      customerId,
      departmentId,
    },
  });
}

describe(
  "asset list filtered by unit, against a database",
  {
    skip: gate.mode === "skip",
  },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}001`,
          type: "COMPANY",
          displayName: `${PREFIX} Teszt Partner`,
        },
        select: { id: true },
      });
      customerId = customer.id;

      rootId = await unit("Fánk", "FAN", null);
      childId = await unit("Biodóm", "BIO", rootId);
      grandChildId = await unit("Nagy főkamedence", "FNM", childId);
      siblingId = await unit("Bolt", "BOL", rootId);

      await asset("ROOT", rootId);
      await asset("CHILD", childId);
      await asset("GRAND", grandChildId);
      await asset("SIB", siblingId);
      await asset("NONE", null);
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    it("returns the unit's own assets and every level beneath it", async () => {
      const result = await repository.list(
        query({ departmentId: childId }),
        INTERNAL,
      );
      assert.deepEqual(result.items.map((item) => item.assetNumber).sort(), [
        `${PREFIX}-CHILD`,
        `${PREFIX}-GRAND`,
      ]);
    });

    it("does not reach into a sibling branch", async () => {
      const result = await repository.list(
        query({ departmentId: siblingId }),
        INTERNAL,
      );
      assert.deepEqual(
        result.items.map((item) => item.assetNumber),
        [`${PREFIX}-SIB`],
      );
    });

    it("takes the whole tree from the root, but not the unplaced asset", async () => {
      const result = await repository.list(
        query({ departmentId: rootId }),
        INTERNAL,
      );
      assert.deepEqual(result.items.map((item) => item.assetNumber).sort(), [
        `${PREFIX}-CHILD`,
        `${PREFIX}-GRAND`,
        `${PREFIX}-ROOT`,
        `${PREFIX}-SIB`,
      ]);
    });

    /**
     * A LEFEDETLEN ÁG, AMIÉRT EZ A FÁJL MEGSZÜLETETT.
     *
     * Egy nem létező alegység-azonosító ÜRES eredményt ad. Ha a repository ilyenkor
     * elhagyná a szűrőt, ez a hívás a teljes eszközlistát adná vissza -- és a válasz
     * attól még szabályos listának látszana. Az állítás ezért nemcsak azt nézi, hogy
     * nulla, hanem azt is, hogy a fixtúra sorai LÉTEZNEK: enélkül egy üres adatbázis
     * ugyanezt a nullát adná.
     */
    it("filters to nothing for a unit id that does not exist", async () => {
      const missing = await repository.list(
        query({ departmentId: "00000000-0000-4000-8000-000000000000" }),
        INTERNAL,
      );
      assert.equal(missing.items.length, 0);
      assert.equal(missing.pagination.totalItems, 0);

      const control = await repository.list(
        query({ departmentId: rootId }),
        INTERNAL,
      );
      assert.equal(control.items.length, 4);
    });
  },
);

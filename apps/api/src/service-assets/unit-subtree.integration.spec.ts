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
let otherCustomerId = "";
let otherRootId = "";

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

async function unit(
  name: string,
  code: string,
  parentId: string | null,
  owner = customerId,
) {
  const row = await prisma.worksheetDepartment.create({
    data: { customerId: owner, code, name, parentId },
    select: { id: true },
  });
  return row.id;
}

async function asset(
  suffix: string,
  departmentId: string | null,
  owner = customerId,
) {
  await prisma.asset.create({
    data: {
      assetNumber: `${PREFIX}-${suffix}`,
      name: `${PREFIX} ${suffix}`,
      customerId: owner,
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

      // MÁSODIK PARTNER: az uniónak partnereken ÁT is helyesen kell működnie.
      const other = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}002`,
          type: "COMPANY",
          displayName: `${PREFIX} Másik Partner`,
        },
        select: { id: true },
      });
      otherCustomerId = other.id;
      otherRootId = await unit("Korallszirt", "KOR", null, otherCustomerId);
      const otherChildId = await unit(
        "Biodóm",
        "BIO",
        otherRootId,
        otherCustomerId,
      );
      await asset("OTHER", otherChildId, otherCustomerId);
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

    /**
     * KÉT KÜLÖNBÖZŐ PARTNER EGY-EGY ALEGYSÉGE, EGY KÉRÉSBEN.
     *
     * EZ A HATÁRESET AZ EGYÉRTÉKŰ ALAKNÁL NEM TUDOTT ELŐÁLLNI, a többes hozza
     * be: a bejárás korábban EGY partner sorait töltötte be, tehát egy másik
     * partner részfája hiányosan állt volna elő. És a hiba NEM üres listaként
     * jelentkezne, hanem KEVESEBB SORKÉNT, ami sokkal kevésbé feltűnő.
     */
    it("takes the union across two different partners", async () => {
      const result = await repository.list(
        query({ departmentIds: [childId, otherRootId] }),
        INTERNAL,
      );
      assert.deepEqual(result.items.map((item) => item.assetNumber).sort(), [
        `${PREFIX}-CHILD`,
        `${PREFIX}-GRAND`,
        `${PREFIX}-OTHER`,
      ]);
    });

    /**
     * EGY NEM LÉTEZŐ AZONOSÍTÓ NEM RONTJA EL A TÖBBIT, ÉS NEM IS TŰNIK EL.
     *
     * A nem létező ág a saját azonosítójára szűkül, tehát nulla sort hoz; az
     * unió a többit adja. A KONTROLL a második állítás: ugyanaz a hívás a nem
     * létező azonosító NÉLKÜL ugyanezt adja. Enélkül a teszt akkor is zöld
     * lenne, ha a nem létező ág csendben az EGÉSZ szűrőt kikapcsolná.
     */
    it("lets an unknown id contribute nothing without spoiling the others", async () => {
      const withUnknown = await repository.list(
        query({
          departmentIds: [
            siblingId,
            "00000000-0000-4000-8000-0000000000ff",
            otherRootId,
          ],
        }),
        INTERNAL,
      );
      assert.deepEqual(
        withUnknown.items.map((item) => item.assetNumber).sort(),
        [`${PREFIX}-OTHER`, `${PREFIX}-SIB`],
      );

      const withoutUnknown = await repository.list(
        query({ departmentIds: [siblingId, otherRootId] }),
        INTERNAL,
      );
      assert.deepEqual(
        withUnknown.items.map((item) => item.assetNumber).sort(),
        withoutUnknown.items.map((item) => item.assetNumber).sort(),
      );
    });

    /**
     * ÁTFEDŐ RÉSZFÁK: az egyik azonosító részfája RÉSZE a másikénak.
     *
     * A várt eredmény a BŐVEBB részfa, változatlanul: a szűrő nem szűkülhet
     * (metszetté), és a bővebb ág sorai sem eshetnek ki. A gyökér és a saját
     * gyereke együtt megadva ugyanazt kell adja, mint a gyökér egyedül.
     *
     * A DUPLÁZÓDÁS EZEN A SZINTEN NEM MÉRHETŐ, és ezt ki kell mondani: az
     * átfedő részfák ugyanazt az azonosítót kétszer is beírhatnák a szűrőbe, de
     * egy `IN` lista ismételt eleme nem ad kétszer sort. A válasz tehát a
     * duplázódásról semmit nem árul el -- amit ez a teszt véd, az a SZŰKÜLÉS.
     */
    it("keeps the wider subtree when one id is inside another", async () => {
      const both = await repository.list(
        query({ departmentIds: [rootId, childId] }),
        INTERNAL,
      );
      const rootOnly = await repository.list(
        query({ departmentIds: [rootId] }),
        INTERNAL,
      );

      assert.deepEqual(both.items.map((item) => item.assetNumber).sort(), [
        `${PREFIX}-CHILD`,
        `${PREFIX}-GRAND`,
        `${PREFIX}-ROOT`,
        `${PREFIX}-SIB`,
      ]);
      assert.deepEqual(
        both.items.map((item) => item.assetNumber).sort(),
        rootOnly.items.map((item) => item.assetNumber).sort(),
      );
    });

    /** A két mező EGYÜTT is megadható, és a szűrő az uniójuk. */
    it("unions the singular field with the plural one", async () => {
      const result = await repository.list(
        query({ departmentId: siblingId, departmentIds: [otherRootId] }),
        INTERNAL,
      );
      assert.deepEqual(result.items.map((item) => item.assetNumber).sort(), [
        `${PREFIX}-OTHER`,
        `${PREFIX}-SIB`,
      ]);
    });
  },
);

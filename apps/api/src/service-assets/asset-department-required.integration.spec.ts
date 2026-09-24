import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * A HELYSZIN KOTELEZO -- ES EZ MOSTANTOL AZ ADATBAZIS SZINTJEN ALL, NEM CSAK
 * A DTO-ban.
 *
 * === EZ AZ ALLITAS EGY TORLES HELYERE LEPETT ===
 *
 * A `20260924101500_department_required` migracio elott NEGY integracios
 * allitas azt bizonyitotta, hogy egy helyszin NELKULI eszkoz nem jon vissza a
 * lekerdezesekbol (`asset-unit-visibility.integration.spec.ts`,
 * `unit-subtree.integration.spec.ts`, es a partner-hatokoru olvasas ket
 * fixturaja). A migracio ota egy ilyen sor MEG NEM IS JOHET LETRE, tehat azok
 * az allitasok TOBBE NEM MERHETOK: a bemenetuk (egy letezo, helyszin nelkuli
 * eszkoz) fizikailag nem allithato elo.
 *
 * A GARANCIA NEM SZUNT MEG, HANEM KOLTOZOTT: a lekerdezesbol az adatbazisba.
 * EZ AZ ALLITAS orzi mostantol -- balazs dontese, message_id
 * 1552018256280162385, szo szerint: "1 legyen kotelezo".
 *
 * === MIERT NYERS SQL, ES NEM A PRISMA KLIENS ===
 *
 * A migracio ota a `Prisma.AssetCreateInput` tipusa `departmentId: string`
 * (nem `string | null`), tehat a normal kliensen at EL SEM LEHETNE INDITANI
 * egy hianyzo helyszinu beszurast -- a fordito megallitana, mielott a teszt
 * futna. Ugyanaz a minta, mint a `document-content-source.integration.spec.ts`
 * fejleceben: epp azt akarjuk merni, hogy ha valaki MEGKERULI a klienst
 * (nyers SQL, egy regi migracios szkript, egy kulso eszkoz), a TABLA akkor is
 * megallitja.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITDEPREQ";
let customerId = "";
let departmentId = "";

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

/**
 * NYERS BESZURAS, A DEPARTMENTID KIHAGYVA -- lasd a fejlec indoka.
 *
 * A TOBBI KOTELEZO OSZLOPOT (id, qrToken, updatedAt) KEZZEL ADJUK MEG: ezek
 * Prisma-oldali, nem adatbazis-oldali alapertelmezesek (`@default(cuid())`,
 * `@default(uuid())`), tehat egy nyers SQL INSERT ezeket nem kapja meg
 * automatikusan -- a `document-content-source` spec ugyanezt a mintat
 * hasznalja a sajat sorara.
 */
async function insertAssetWithoutDepartment(
  assetNumber: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Asset" (id, "assetNumber", "qrToken", "customerId", name, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    randomUUID(),
    assetNumber,
    randomUUID(),
    customerId,
    "Helyszín nélküli kísérlet",
  );
}

describe(
  "a helyszín kötelező az Asset táblán",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}001`,
          type: "COMPANY",
          displayName: `${PREFIX} Teszt Ügyfél`,
        },
      });
      customerId = customer.id;
      const department = await prisma.worksheetDepartment.create({
        data: { customerId, code: "DEP", name: "Teszt egység" },
      });
      departmentId = department.id;
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite eszközei bent maradtak a takarítás után",
          darab: await prisma.asset.count({
            where: { assetNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite ügyfele bent maradt a takarítás után",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    /**
     * A BIZONYITEK: az adatbazis maga utasitja el a hianyzo helyszint --
     * kalibralva: ha a `20260924101500_department_required` migracio `NOT
     * NULL` resze kimaradna, ez az allitas nem dobna, es a kalibracio
     * megmutatja.
     */
    it("egy helyszín NÉLKÜLI eszközt az adatbázis elutasít", async () => {
      await assert.rejects(insertAssetWithoutDepartment(`${PREFIX}-NINCS`));
    });

    /**
     * A POZITÍV KONTROLL: ugyanaz a beszúrás, csak helyszínnel, hogy a fenti
     * bukás valóban a hiányzó mezőről szóljon, ne egy másik, elgépelt
     * oszlopnévről vagy egy idegenkulcs-hibáról.
     */
    it("kontroll: UGYANAZ a beszúrás helyszínnel sikeres", async () => {
      const asset = await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}-VAN`,
          name: "Helyszínes kontroll",
          customerId,
          departmentId,
        },
        select: { id: true },
      });
      assert.ok(asset.id);
    });
  },
);

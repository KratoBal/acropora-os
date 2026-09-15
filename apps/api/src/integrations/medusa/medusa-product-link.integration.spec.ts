import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { nincsMaradek } from "../../common/takaritas-leltar.js";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import {
  MedusaProductLinkConflictError,
  MedusaProductLinkRepository,
} from "./medusa-product-link.repository.js";

// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * Az azonosság HELYE, valódi adatbázison.
 *
 * Ezt nem lehet hamisított Prismával mérni, mert amit bizonyítani kell, az nem
 * a kód elágazása, hanem az, hogy a KÉT EGYEDI KULCS tényleg ott van és
 * tényleg fog. Egy hamisított kliens akkor is „megvédené" a leképezést, ha a
 * migráció sosem futott volna le.
 */

const PREFIX = `medusa-link-${Date.now()}`;

/**
 * AMIT A SUITE LETREHOZOTT -- ES NEM AZ, AMIT A TAKARITAS MEGTALAL.
 *
 * A ket lista NEM ugyanaz, es epp a kulonbsegukben lakik a hiba, amit a
 * szamlalo keresne: a takaritas nev-elotagra kerdez, tehat ha az a szuro
 * elcsuszik, a sajat merceje is vele csuszik el. Ez a lista a LETREHOZASKOR
 * keletkezik, egy helyrol, es a takaritas semelyik agatol nem fugg.
 */
const LETREHOZOTT: string[] = [];

async function makeProduct(suffix: string) {
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX} ${suffix}`,
      type: "PHYSICAL",
      origin: "LOCAL",
      catalogAuthority: "ACROPORA",
    },
  });
  LETREHOZOTT.push(product.id);
  return product;
}

/** Csak a saját sorait takarítja, névelőtag szerint. */
async function cleanup() {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = products.map((product) => product.id);
  if (!ids.length) return;
  await prisma.externalReference.deleteMany({
    where: { system: "MEDUSA", entityType: "Product", entityId: { in: ids } },
  });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

describe(
  "Medusa product identity integration",
  { skip: !runIntegration },
  () => {
    const links = new MedusaProductLinkRepository();
    const syncedAt = new Date("2026-08-24T22:00:00.000Z");

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await cleanup();
    });

    after(async () => {
      await cleanup();
      /**
       * ES A TERMEKEKET NEV SZERINT, mert a `cleanup` a lista URESSEGEKOR
       * koran visszater -- az a kihagyas csendes, es pontosan ugy nez ki, mint
       * egy tiszta futas.
       */
      nincsMaradek([
        {
          nev: "a suite termekei bent maradtak a takaritas utan",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        /**
         * A LEKEPEZES-SOR A TABLAK KOZUL AZ EGYETLEN, AMI CSENDBEN TULELHETI A
         * TAKARITAST: az `ExternalReference.entityId` sima szoveg, nem idegen
         * kulcs, tehat a termek torlese NEM viszi el a hozza tartozo sort.
         *
         * EZ A SZAMLALO KORABBAN A `cleanup()` TORZSEBEN ALLT, es 2026-09-15-en
         * meressel derult ki, hogy NEM TUD MEGSZOLALNI. Ket okbol: a fuggveny
         * `if (!ids.length) return` agan a vezerles elmegy mellette, es a
         * szamlalt halmazt ugyanabbol a listabol vette, amibol a torles
         * dolgozott -- tehat egy elcsuszott nev-szuro a sajat mercejet is
         * elvitte volna. A visszaolvaso korben az 56 nevbol epp ez az egy NEM
         * jelent meg a naploban.
         *
         * Most a `LETREHOZOTT` lista ellen szamol, ami a letrehozaskor
         * keletkezik: fuggetlen a takaritas barmelyik agatol, es akkor is
         * megszolal, ha a takaritas el sem indult.
         */
        {
          nev: "a suite lekepezes-sorai bent maradtak a takaritas utan",
          darab: await prisma.externalReference.count({
            where: {
              system: "MEDUSA",
              entityType: "Product",
              entityId: { in: LETREHOZOTT },
            },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("has nowhere to point before anything is linked", async () => {
      const product = await makeProduct("még-nincs");

      assert.equal(await links.findByProductId(product.id), null);
      assert.equal(await links.findByMedusaProductId("prod_soha"), null);
    });

    /**
     * A leképezés MINDKÉT irányban kereshető, mert a vetítésnek mindkettőre
     * szüksége van: „mi ez a termék odaát" és „kihez tartozik ez a Medusa-sor".
     */
    it("answers in both directions once a pair is recorded", async () => {
      const product = await makeProduct("mindket-irany");

      await links.link(product.id, "prod_mindket_irany", syncedAt);

      const byProduct = await links.findByProductId(product.id);
      assert.equal(byProduct?.medusaProductId, "prod_mindket_irany");
      const byMedusa = await links.findByMedusaProductId("prod_mindket_irany");
      assert.equal(byMedusa?.productId, product.id);
    });

    /**
     * Ugyanaz a pár kétszer nem hiba: a vetítés minden sikeres futás után ezt
     * hívja, és egy „már rögzítve" hiba ott zaj lenne. Ami frissül, az a
     * legutóbbi szinkron ideje.
     */
    it("records the same pair twice without complaining", async () => {
      const product = await makeProduct("ketszer");

      await links.link(product.id, "prod_ketszer", syncedAt);
      const later = new Date("2026-08-25T09:00:00.000Z");
      const second = await links.link(product.id, "prod_ketszer", later);

      assert.equal(second.medusaProductId, "prod_ketszer");
      assert.equal(second.lastSyncedAt?.toISOString(), later.toISOString());

      const rows = await prisma.externalReference.count({
        where: {
          system: "MEDUSA",
          entityType: "Product",
          entityId: product.id,
        },
      });
      assert.equal(rows, 1, "egy termékhez egyetlen leképezés-sor tartozhat");
    });

    /**
     * A két ütköző eset, és MIND A KETTŐ kell.
     *
     * Csak az elsőt mérve egy olyan megvalósítás is átmenne, ami a
     * Medusa-azonosítót engedi több termékhez kötni; csak a másodikat mérve
     * pedig az, ami egy termékhez enged több Medusa-azonosítót. A kettő
     * külön-külön is elég ahhoz, hogy egy Medusa-termék árván maradjon.
     */
    it("refuses a second Medusa id for the same product", async () => {
      const product = await makeProduct("masik-medusa");
      await links.link(product.id, "prod_elso", syncedAt);

      await assert.rejects(
        links.link(product.id, "prod_masodik", syncedAt),
        (error: unknown) => error instanceof MedusaProductLinkConflictError,
      );

      const kept = await links.findByProductId(product.id);
      assert.equal(
        kept?.medusaProductId,
        "prod_elso",
        "a meglévő nem íródik felül",
      );
    });

    it("refuses the same Medusa id for a second product", async () => {
      const first = await makeProduct("elso-termek");
      const second = await makeProduct("masodik-termek");
      await links.link(first.id, "prod_kozos", syncedAt);

      await assert.rejects(
        links.link(second.id, "prod_kozos", syncedAt),
        (error: unknown) => error instanceof MedusaProductLinkConflictError,
      );

      const kept = await links.findByMedusaProductId("prod_kozos");
      assert.equal(kept?.productId, first.id);
      assert.equal(await links.findByProductId(second.id), null);
    });

    /**
     * És a garancia, ami nem a kódban van: az adatbázis akkor is megállítja a
     * második sort, ha valaki a szolgáltatás megkerülésével írna. Ez a
     * különbség aközött, hogy egy szabály MÉRHETŐEN igaz, és aközött, hogy
     * TARTVA van.
     */
    it("is held by the database, not only by the service", async () => {
      const product = await makeProduct("adatbazis-tartja");
      await links.link(product.id, "prod_adatbazis", syncedAt);

      await assert.rejects(
        prisma.externalReference.create({
          data: {
            system: "MEDUSA",
            entityType: "Product",
            entityId: product.id,
            externalId: "prod_masik_azonosito",
          },
        }),
      );
    });
  },
);

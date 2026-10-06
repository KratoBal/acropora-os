import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * AZ ELHULLÁSI NAPLÓ HÁROM ADATBÁZIS-MEGKÖTÉSE (kártya 115c9740, migráció
 * `20261006200000_mortality_log`), VALÓDI POSTGRESEN.
 *
 * A szolgáltatás ugyanezt a három szabályt érthető üzenettel adja vissza; ez a
 * teszt azt méri, hogy a szolgáltatást megkerülő írás (egy szkript, egy jövőbeli
 * végpont) sem tud ilyen sort létrehozni. Mockkal ez nem mérhető: a CHECK csak
 * az adatbázisban létezik (barracuda átvételi listája, 2026-10-06).
 *
 * MINDEN TILTOTT ESETNEK VAN ÉRVÉNYES PÁRJA: ha a fixtúra maga lenne hibás
 * (hiányzó kötelező mező, rossz idegen kulcs), a tiltott eset ugyanúgy
 * elbukna, és a teszt zöld maradna a CHECK nélkül is.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "ELH-INT-";
const EMAIL_DOMAIN = "mortality-integration.invalid";

describe(
  "MortalityRecord adatbázis-megkötései",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const ids = { product: "", aquarium: "", supplier: "", user: "" };
    let counter = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ids.product = (
        await prisma.product.create({
          data: { name: `${PREFIX}hal-${suffix}` },
        })
      ).id;
      ids.aquarium = (
        await prisma.aquarium.create({
          data: {
            aquariumNumber: `${PREFIX}AKV-${suffix}`,
            name: `${PREFIX}akvarium-${suffix}`,
            ownershipType: "OWN",
          },
        })
      ).id;
      ids.supplier = (
        await prisma.supplier.create({
          data: { code: `${PREFIX}SUP-${suffix}`, name: `${PREFIX}beszallito` },
        })
      ).id;
      ids.user = (
        await prisma.user.create({
          data: {
            email: `rogzito-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Elhullás Rögzítő",
            role: "SERVICE",
            isActive: true,
          },
        })
      ).id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.mortalityRecord.deleteMany({
        where: { recordNumber: { startsWith: PREFIX } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
    }

    function record(
      over: Partial<{
        quantity: number;
        sourceType:
          "SUPPLIER" | "LOCAL_BREEDER" | "TRADE" | "OWN_BREEDING" | "OTHER";
        supplierId: string | null;
        sourceNote: string | null;
      }>,
    ) {
      counter += 1;
      return prisma.mortalityRecord.create({
        data: {
          recordNumber: `${PREFIX}${suffix}-${counter}`,
          productId: ids.product,
          aquariumId: ids.aquarium,
          recordedById: ids.user,
          quantity: 1,
          sourceType: "TRADE",
          supplierId: null,
          sourceNote: null,
          ...over,
        },
      });
    }

    /** A Prisma a CHECK-sértést `P2010`/nyers hibaként adja; a név a lényeg. */
    async function rejectedBy(constraint: string, write: Promise<unknown>) {
      await assert.rejects(write, (error: Error) => {
        assert.match(String(error.message), new RegExp(constraint));
        return true;
      });
    }

    it("a példányszám legalább 1", async () => {
      await record({ quantity: 1 });
      await rejectedBy(
        "MortalityRecord_quantity_check",
        record({ quantity: 0 }),
      );
    });

    it("beszállítói forráshoz kötelező a beszállító, máshoz tilos", async () => {
      await record({ sourceType: "SUPPLIER", supplierId: ids.supplier });
      await rejectedBy(
        "MortalityRecord_supplier_check",
        record({ sourceType: "SUPPLIER", supplierId: null }),
      );
      await rejectedBy(
        "MortalityRecord_supplier_check",
        record({ sourceType: "TRADE", supplierId: ids.supplier }),
      );
    });

    it("az „Egyéb” forráshoz kötelező a megnevezés, a szóköz nem az", async () => {
      await record({ sourceType: "OTHER", sourceNote: "Pista" });
      await rejectedBy(
        "MortalityRecord_other_note_check",
        record({ sourceType: "OTHER", sourceNote: null }),
      );
      await rejectedBy(
        "MortalityRecord_other_note_check",
        record({ sourceType: "OTHER", sourceNote: "   " }),
      );
    });
  },
);

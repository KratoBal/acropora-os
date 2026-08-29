import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * A BRUTTÓ ELADÁSI ÁR KÉT ŐRZŐJE, AZ ADATBÁZISON MÉRVE.
 *
 * Miért integrációs teszt, és miért nem egységteszt: a két feltétel `CHECK`
 * megszorítás, tehát a PostgreSQL tartja őket, nem a mi kódunk. Egy
 * egységteszt csak azt tudná megmérni, amit MI ellenőrzünk - és pont az a
 * lényeg, hogy ne csak azon az egy úton legyen védve. Az ár több úton
 * bekerülhet (import, javító szkript, kézi javítás), és egy alkalmazás-oldali
 * ellenőrzés csak a sajátját őrzi.
 *
 * A KÉT KONTROLL-ESET NEM DÍSZ. Egy olyan tábla, amibe egyáltalán nem lehet
 * írni, mind a négy tiltó esetet „megfogná", és a teszt zöld lenne. Az érvényes
 * pár és az üres pár beírása zárja ki, hogy a bukásokat valami más okozza.
 */

const PREFIX = `selling-price-${Date.now()}`;

/** Amit a `CHECK` megszorítás sértése esetén a Prisma dob. */
const CHECK_VIOLATION = "P2010";

async function insertVariant(
  suffix: string,
  price: string | null,
  currency: string | null,
) {
  return prisma.productVariant.create({
    data: {
      product: { connect: { id: `${PREFIX}-product` } },
      sku: `${PREFIX}-${suffix}`,
      unit: "db",
      isActive: true,
      sellingGrossPrice: price === null ? null : new Prisma.Decimal(price),
      sellingPriceCurrency: currency,
    },
  });
}

/** Igaz, ha a hívás a KÉT megszorítás valamelyikén bukott, és nem máson. */
async function rejectedByCheck(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("ProductVariant_selling_price_pair") ||
      message.includes("ProductVariant_selling_price_not_negative") ||
      message.includes(CHECK_VIOLATION)
    );
  }
}

describe(
  "ProductVariant eladási ár, adatbázis-szintű őrzők",
  { skip: !runIntegration },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.product.create({
        data: {
          id: `${PREFIX}-product`,
          name: `${PREFIX} termék`,
          isActive: true,
        },
      });
    });

    after(async () => {
      await prisma.productVariant.deleteMany({
        where: { productId: `${PREFIX}-product` },
      });
      await prisma.product.deleteMany({ where: { id: `${PREFIX}-product` } });
      await prisma.$disconnect();
    });

    it("rejects an amount without a currency", async () => {
      assert.equal(
        await rejectedByCheck(insertVariant("a", "111", null)),
        true,
      );
    });

    it("rejects a currency without an amount", async () => {
      assert.equal(
        await rejectedByCheck(insertVariant("b", null, "HUF")),
        true,
      );
    });

    it("rejects a negative amount", async () => {
      assert.equal(
        await rejectedByCheck(insertVariant("c", "-1", "HUF")),
        true,
      );
    });

    /**
     * KONTROLL: enélkül a fenti három bukás bármitől jöhetne.
     */
    it("accepts a valid pair", async () => {
      const variant = await insertVariant("d", "12990", "HUF");
      assert.equal(variant.sellingGrossPrice?.toString(), "12990");
      assert.equal(variant.sellingPriceCurrency, "HUF");
    });

    /** KONTROLL: az ár nélküli termék a TÖBBSÉG, nem kivétel. */
    it("accepts a variant with no price at all", async () => {
      const variant = await insertVariant("e", null, null);
      assert.equal(variant.sellingGrossPrice, null);
      assert.equal(variant.sellingPriceCurrency, null);
    });

    /**
     * A NULLA MEGENGEDETT, ÉS EZ ÁLLÍTÁS, NEM MULASZTÁS.
     *
     * Hogy egy nulla forintos termék üzletileg mit jelent, az NYITOTT kérdés (a
     * brief 8. pontja szerint is döntést igényel). A tárolást ezért nem tiltjuk
     * le - a vetítés dolga lesz, hogy ne tegyen belőle csendben ingyenes
     * terméket.
     */
    it("accepts zero, because zero is an open business question, not a data error", async () => {
      const variant = await insertVariant("f", "0", "HUF");
      assert.equal(variant.sellingGrossPrice?.toString(), "0");
    });
  },
);

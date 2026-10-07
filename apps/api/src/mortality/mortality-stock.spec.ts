import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  deductedByVariant,
  mortalityCorrections,
  mortalityStockEffect,
  planMortalityStock,
  type MortalityLedgerLine,
  type MortalityStockProduct,
} from "./mortality-stock.js";

/**
 * AZ ELHULLÁS KÉSZLETHATÁSA (Balázs 2026-10-07). MI PIROSÍT: ha szabad
 * szövegnél, szolgáltatásnál, csomagnál vagy több változatnál levonnánk; ha a
 * UNAS-gazdájú termék nem menne a UNAS-kimenetre; ha egy módosítás nem
 * pontosan a különbséget könyvelné; ha a napló előjelét elnéznénk.
 */
const d = (n: number) => new Prisma.Decimal(n);

const LIVE: MortalityStockProduct = {
  type: "PHYSICAL",
  catalogAuthority: "UNAS",
  variants: [{ id: "v1", sku: "HAL-1", unit: "db" }],
  isPackageProduct: false,
};

const line = (
  type: string,
  quantity: number,
  variantId = "v1",
): MortalityLedgerLine => ({
  type,
  variantId,
  quantity: d(quantity),
  sku: variantId === "v1" ? "HAL-1" : "HAL-2",
  unit: "db",
  syncToUnas: true,
});

describe("planMortalityStock", () => {
  it("rendszerbeli, egy változatú élőlény: a teljes példányszám levonandó", () => {
    const { target, reason } = planMortalityStock(LIVE, 3);
    assert.equal(reason, null);
    assert.equal(target?.variantId, "v1");
    assert.ok(target?.quantity.equals(3));
  });

  it("UNAS-gazdájú termék a UNAS-kimenetre megy, a helyi nem", () => {
    assert.equal(planMortalityStock(LIVE, 1).target?.syncToUnas, true);
    assert.equal(
      planMortalityStock({ ...LIVE, catalogAuthority: "ACROPORA" }, 1).target
        ?.syncToUnas,
      false,
    );
  });

  it("amikor nem mozog, megmondja, miért", () => {
    assert.equal(planMortalityStock(null, 1).reason, "FREE_TEXT");
    assert.equal(
      planMortalityStock({ ...LIVE, type: "SERVICE" }, 1).reason,
      "NOT_STOCKED",
    );
    assert.equal(
      planMortalityStock({ ...LIVE, isPackageProduct: true }, 1).reason,
      "PACKAGE",
    );
    assert.equal(
      planMortalityStock({ ...LIVE, variants: [] }, 1).reason,
      "NO_VARIANT",
    );
    assert.equal(
      planMortalityStock(
        {
          ...LIVE,
          variants: [...LIVE.variants, { id: "v2", sku: "HAL-2", unit: "db" }],
        },
        1,
      ).reason,
      "VARIANT_NOT_CHOSEN",
    );
    for (const product of [null, { ...LIVE, type: "SERVICE" }])
      assert.equal(planMortalityStock(product, 1).target, null);
  });
});

describe("deductedByVariant", () => {
  it("a SCRAP levonás, a RETURN_IN visszaírás, más típus nem számít", () => {
    const net = deductedByVariant([
      line("SCRAP", 5),
      line("RETURN_IN", 2),
      line("SALE", 7),
    ]);
    assert.ok(net.get("v1")?.quantity.equals(3));
  });
});

describe("mortalityCorrections: pontosan a különbség", () => {
  const plan = (quantity: number) => planMortalityStock(LIVE, quantity).target;

  it("első rögzítés: a teljes példányszám levonás", () => {
    const { deduct, giveBack } = mortalityCorrections(new Map(), plan(3));
    assert.deepEqual(
      deduct.map((l) => [l.variantId, l.quantityDelta.toNumber()]),
      [["v1", -3]],
    );
    assert.equal(giveBack.length, 0);
  });

  it("ugyanaz még egyszer: semmi (nem von le kétszer)", () => {
    const { deduct, giveBack } = mortalityCorrections(
      deductedByVariant([line("SCRAP", 3)]),
      plan(3),
    );
    assert.equal(deduct.length + giveBack.length, 0);
  });

  it("több példány: a különbség levonás; kevesebb: a különbség visszaírás", () => {
    const already = deductedByVariant([line("SCRAP", 3)]);
    assert.deepEqual(
      mortalityCorrections(already, plan(5)).deduct.map((l) =>
        l.quantityDelta.toNumber(),
      ),
      [-2],
    );
    assert.deepEqual(
      mortalityCorrections(already, plan(1)).giveBack.map((l) =>
        l.quantityDelta.toNumber(),
      ),
      [2],
    );
  });

  it("szabad szövegre váltás: minden visszaíródik", () => {
    const { deduct, giveBack } = mortalityCorrections(
      deductedByVariant([line("SCRAP", 3)]),
      null,
    );
    assert.equal(deduct.length, 0);
    assert.deepEqual(
      giveBack.map((l) => [l.variantId, l.quantityDelta.toNumber(), l.sku]),
      [["v1", 3, "HAL-1"]],
    );
  });

  it("másik élőlényre váltás: a régi vissza, az új le", () => {
    const other = planMortalityStock(
      { ...LIVE, variants: [{ id: "v2", sku: "HAL-2", unit: "db" }] },
      2,
    ).target;
    const { deduct, giveBack } = mortalityCorrections(
      deductedByVariant([line("SCRAP", 3)]),
      other,
    );
    assert.deepEqual(
      giveBack.map((l) => [l.variantId, l.quantityDelta.toNumber()]),
      [["v1", 3]],
    );
    assert.deepEqual(
      deduct.map((l) => [l.variantId, l.quantityDelta.toNumber()]),
      [["v2", -2]],
    );
  });
});

describe("mortalityStockEffect", () => {
  it("a napló nettóját mutatja, és az okot, ha nem mozgott", () => {
    assert.deepEqual(
      mortalityStockEffect(
        deductedByVariant([line("SCRAP", 3), line("RETURN_IN", 1)]),
        null,
      ),
      { deducted: 2, sku: "HAL-1", reason: null },
    );
    assert.deepEqual(mortalityStockEffect(new Map(), "FREE_TEXT"), {
      deducted: 0,
      sku: null,
      reason: "FREE_TEXT",
    });
  });
});

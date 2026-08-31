import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type {
  MedusaAdminClient,
  MedusaPriceInput,
  MedusaPriceRow,
  MedusaVariantPriceRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import { MedusaPricingProjectionService } from "./medusa-pricing-projection.service.js";

/**
 * AZ ÁR-VETÍTÉS, ÁLLAPOTOS HAMIS BOLTON.
 *
 * A hamis bolt a mért Medusa-viselkedést utánozza, nem egy kényelmes
 * változatot: az ár-frissítés TELJES CSERE. Az `id` nélkül érkező sor ÚJ
 * azonosítót kap, a listából hiányzó meglévő sor pedig TÖRLŐDIK. Enélkül a
 * legfontosabb állítás (a második futás ugyanazt a sort módosítja) nem lenne
 * mérhető: egy hozzáfűző hamis bolt mellett minden alak zöld maradna.
 */

const OS_PRODUCT = "prod-os-1";
const SKU = "STAGEPROOF0002";
const MEDUSA_PRODUCT = "prod_medusa_1";
const VARIANT = "variant_1";

function priced(amount: string | null, currency: string | null = "HUF") {
  return {
    osProductId: OS_PRODUCT,
    sku: SKU,
    price: {
      sellingGrossPrice: amount === null ? null : new Prisma.Decimal(amount),
      sellingPriceCurrency: currency,
    },
  };
}

interface FakeOptions {
  link?: boolean;
  taxInclusive?: boolean;
  prices?: MedusaPriceRow[] | undefined;
  variantSku?: string | null;
  deletedAt?: string | null;
  /** Igazra állítva az írás LEFUT, de nem változtat semmit (üres price set). */
  writeSilentlyDoesNothing?: boolean;
}

function fakes(options: FakeOptions = {}) {
  const {
    link = true,
    taxInclusive = true,
    variantSku = SKU,
    deletedAt = null,
    writeSilentlyDoesNothing = false,
  } = options;

  let rows: MedusaPriceRow[] | undefined =
    "prices" in options ? options.prices : [];
  const writes: MedusaPriceInput[][] = [];
  let created = 0;

  const links = {
    findByProductId: async () =>
      link
        ? {
            productId: OS_PRODUCT,
            medusaProductId: MEDUSA_PRODUCT,
            lastSyncedAt: null,
          }
        : null,
  } as unknown as MedusaProductLinkRepository;

  const variantRow = (): MedusaVariantPriceRow => ({
    id: VARIANT,
    sku: variantSku,
    deleted_at: deletedAt,
    ...(rows === undefined ? {} : { prices: rows }),
  });

  const medusa = {
    listPricePreferences: async () => [
      {
        id: "prpref_1",
        attribute: "currency_code",
        value: "huf",
        is_tax_inclusive: taxInclusive,
      },
      {
        id: "prpref_2",
        attribute: "currency_code",
        value: "eur",
        is_tax_inclusive: false,
      },
    ],
    listVariantPrices: async () => ({ rows: [variantRow()], truncated: false }),
    setVariantPrices: async (
      _productId: string,
      _variantId: string,
      prices: MedusaPriceInput[],
    ) => {
      writes.push(prices);
      if (writeSilentlyDoesNothing) return;
      /**
       * A MÉRT SZEMANTIKA: az `id` nélküli sor ÚJ azonosítót kap, a meglévő
       * `id` a helyén marad, és ami nincs a listában, az eltűnik.
       */
      rows = prices.map((price) => {
        if (price.id) return { ...price, id: price.id } as MedusaPriceRow;
        created += 1;
        return {
          id: `price_uj_${created}`,
          currency_code: price.currency_code,
          amount: price.amount,
        };
      });
    },
  } as unknown as MedusaAdminClient;

  return {
    writes,
    currentRows: () => rows,
    service: new MedusaPricingProjectionService(links, medusa),
  };
}

describe("MedusaPricingProjectionService", () => {
  it("creates the price when the variant has none", async () => {
    const { service, writes } = fakes({ prices: [] });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.result, "created");
    assert.equal(outcome.report.medusaAmount, 12990);
    assert.equal(outcome.report.sourceAmount, "12990");
    assert.ok(outcome.report.priceId.length > 0);
    /** Az első küldés `id` nélkül megy: ilyenkor tényleg új sor kell. */
    assert.equal(writes[0]![0]!.id, undefined);
  });

  /**
   * EZ A KÖR LEGFONTOSABB TESZTJE.
   *
   * Nem azt méri, hogy egyetlen ár áll a végén - azt egy hibás megvalósítás is
   * teljesítené, mert a teljes csere törli a régit és létrehozza az újat. Azt
   * méri, hogy UGYANAZ a sor áll ott, ugyanazzal az azonosítóval.
   */
  it("keeps the same price id when the amount changes", async () => {
    const { service, writes } = fakes({ prices: [] });

    const first = await service.project(priced("12990"));
    const second = await service.project(priced("14990"));

    assert.equal(first.action, "projected");
    assert.equal(second.action, "projected");
    if (first.action !== "projected" || second.action !== "projected") return;

    assert.equal(second.report.result, "updated");
    assert.equal(second.report.medusaAmount, 14990);
    assert.equal(second.report.priceId, first.report.priceId);
    /** A második küldés MÁR viszi az azonosítót. Enélkül újraépülne a sor. */
    assert.equal(writes[1]![0]!.id, first.report.priceId);
  });

  it("writes nothing at all when the amount already matches", async () => {
    const { service, writes } = fakes({
      prices: [{ id: "price_1", currency_code: "huf", amount: 12990 }],
    });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.result, "no-change");
    assert.equal(outcome.report.priceId, "price_1");
    assert.equal(writes.length, 0);
  });

  it("comes back to the same amount after going up and down", async () => {
    const { service } = fakes({ prices: [] });

    const first = await service.project(priced("1000"));
    await service.project(priced("1500"));
    const back = await service.project(priced("999"));

    assert.equal(back.action, "projected");
    if (back.action !== "projected" || first.action !== "projected") return;
    assert.equal(back.report.medusaAmount, 999);
    assert.equal(back.report.priceId, first.report.priceId);
  });

  /**
   * A CSENDES BUKÁS, AMIT KÜLÖN KELL ELKAPNI.
   *
   * A Medusa nem hibázik, ha a változathoz nincs price set: a hívás sikerrel
   * tér vissza, és nem történik semmi. Csak a visszaolvasás mondja meg.
   */
  it("stops when the write returns success but nothing changed", async () => {
    const { service } = fakes({ prices: [], writeSilentlyDoesNothing: true });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "write-not-visible");
  });

  /**
   * A KÖR CSENDES HIBÁJA A MÁSIK IRÁNYBÓL: ha a bolt nem adóval növeltnek
   * veszi a forintot, a bruttó árunk némán nettóvá minősül át.
   */
  it("stops when the shop does not treat HUF as tax inclusive", async () => {
    const { service, writes } = fakes({ taxInclusive: false, prices: [] });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "tax-inclusive-not-set");
    assert.equal(writes.length, 0);
  });

  it("stops instead of deleting a price in another currency", async () => {
    const { service, writes } = fakes({
      prices: [
        { id: "price_huf", currency_code: "huf", amount: 12990 },
        { id: "price_eur", currency_code: "eur", amount: 33 },
      ],
    });

    const outcome = await service.project(priced("14990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "foreign-currency-price-present");
    assert.equal(writes.length, 0);
  });

  it("stops when two forint prices sit on the same variant", async () => {
    const { service } = fakes({
      prices: [
        { id: "price_a", currency_code: "huf", amount: 12990 },
        { id: "price_b", currency_code: "huf", amount: 11990 },
      ],
    });

    const outcome = await service.project(priced("14990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "ambiguous-price");
  });

  it("tells a missing prices field from an empty one", async () => {
    const { service } = fakes({ prices: undefined });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "prices-not-returned");
  });

  it("stops when the product has no Medusa link", async () => {
    const { service, writes } = fakes({ link: false, prices: [] });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "no-product-link");
    assert.equal(writes.length, 0);
  });

  it("stops when the SKU only sits on a soft-deleted variant", async () => {
    const { service } = fakes({
      prices: [],
      deletedAt: "2026-08-01T00:00:00.000Z",
    });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "variant-identity-chain-broken");
  });

  /**
   * A DÖNTÉSI MODUL ELUTASÍTÁSA ELJUT A HÍVÓIG, és a hálózatot MEG SEM
   * ÉRINTJÜK. Enélkül egy hiányzó ár is elindítana egy kört a bolt felé.
   */
  it("refuses a missing price before touching the shop", async () => {
    const { service, writes } = fakes({ prices: [] });

    const outcome = await service.project(priced(null, null));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "price-missing");
    assert.equal(writes.length, 0);
  });
});

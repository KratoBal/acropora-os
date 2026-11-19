import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaPriceInput,
  MedusaPriceRow,
  MedusaVariantPriceRow,
} from "./medusa-admin.client.js";
import {
  dedupeCounts,
  dedupeProducts,
  type DedupeDeps,
} from "./medusa-price-dedupe.js";

/*
  THE TWO-HUF-PRICE REPAIR (task t-20261116-ket-forint-ar, acrobot 53861 and 53863). WHAT TURNS RED: a plan writes; apply writes
  something other than the older row alone with its own id; a variant that is not the narrow case is touched (a non-plain, unknown
  shape, unequal amounts, three rows, a foreign currency row, a non-ULID id, an OS price that differs or is missing); a single or
  empty variant is written; a failed write or a read back that does not show exactly one row is reported as fixed; a second run
  writes again; the read is not fresh per variant; an unreadable product is decided anyway.
*/
const A = "price_01M1YGHW2HKVJRCD487WHCSAX1"; // the older
const B = "price_01M1YGHW2N7D1C4AZ37NAC487P"; // the newer

const plain = (
  id: string,
  amount: number,
  extra: Partial<MedusaPriceRow> = {},
): MedusaPriceRow => ({
  id,
  currency_code: "huf",
  amount,
  price_list_id: null,
  rules_count: 0,
  min_quantity: null,
  max_quantity: null,
  ...extra,
});

interface Shop {
  /** variant id -> its price rows, as Medusa would return them */
  variants: Map<string, { sku: string; prices: MedusaPriceRow[] }>;
  writes: {
    productId: string;
    variantId: string;
    prices: MedusaPriceInput[];
  }[];
  reads: number;
}

/** A shop whose write behaves like Medusa's: the sent list is the whole wanted content (rows with an id keep it). */
function fake(
  variants: Record<string, { sku: string; prices: MedusaPriceRow[] }>,
  options: {
    osAmount?: number | null;
    noOpWrite?: boolean;
    /** the write lands, but with another amount or another row id than asked */
    writeAs?: "amount" | "id" | "extra-row";
    throwOnWrite?: boolean;
    throwOnRead?: boolean;
    truncated?: boolean;
    link?: string | null;
  } = {},
) {
  const shop: Shop = {
    variants: new Map(Object.entries(variants)),
    writes: [],
    reads: 0,
  };
  const deps: DedupeDeps = {
    resolve: async (osProductId) => ({
      targets: [...shop.variants.values()].map((variant) => ({
        osProductId,
        sku: variant.sku,
        osAmount: options.osAmount === undefined ? 500 : options.osAmount,
      })),
      errors: [],
    }),
    findMedusaProductId: async () =>
      options.link === undefined ? "prod_1" : options.link,
    reader: {
      listVariantPrices: async () => {
        shop.reads += 1;
        if (options.throwOnRead) throw new TypeError("secret detail");
        return {
          truncated: options.truncated === true,
          rows: [...shop.variants.entries()].map(
            ([id, variant]): MedusaVariantPriceRow => ({
              id,
              sku: variant.sku,
              deleted_at: null,
              prices: variant.prices.map((price) => ({ ...price })),
            }),
          ),
        };
      },
    },
    matchVariant: (rows, sku) => {
      const found = rows.find((row) => row.sku === sku);
      return found ? { variant: found } : { error: `no variant for ${sku}` };
    },
    writer: {
      setVariantPrices: async (productId, variantId, prices) => {
        shop.writes.push({ productId, variantId, prices });
        if (options.throwOnWrite) throw new RangeError("secret detail");
        if (options.noOpWrite) return;
        const variant = shop.variants.get(variantId)!;
        if (options.writeAs === "extra-row") {
          const keptRow = variant.prices.find(
            (row) => row.id === prices[0]!.id,
          )!;
          variant.prices = [
            keptRow,
            ...variant.prices.filter((row) => row.id !== keptRow.id),
          ];
          return;
        }
        // a sale price list's rows survive the whole-list write (Medusa's `updatePriceSets_` touches only `price_list_id = null`)
        const listRows = variant.prices.filter((row) => row.price_list_id);
        variant.prices = prices.map((input) => {
          const previous = variant.prices.find((row) => row.id === input.id);
          if (options.writeAs === "id")
            return plain(`price_new_${variantId}`, input.amount);
          if (options.writeAs === "amount")
            return plain(input.id ?? "x", input.amount + 1);
          return previous
            ? { ...previous, amount: input.amount }
            : plain(`price_new_${variantId}`, input.amount);
        });
        variant.prices = [...listRows, ...variant.prices];
      },
    },
  };
  return { shop, deps };
}

// a function: the fake write mutates its shop, so every test needs its own copy
const twoEqual = () => ({
  variant_1: { sku: "SKU-1", prices: [plain(B, 500), plain(A, 500)] },
});

describe("a két forint ár javítása", () => {
  it("terv: nem ír, és a régebbi sort tartja meg", async () => {
    const { shop, deps } = fake(twoEqual());
    const entries = await dedupeProducts(["os_1"], deps, { apply: false });
    assert.equal(shop.writes.length, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.action, "planned");
    assert.equal(entries[0]!.keepId, A);
    assert.deepEqual(entries[0]!.deleteIds, [B]);
    assert.equal(entries[0]!.amount, 500);
  });

  it("apply: egyetlen írás, csak a régebbi sor a saját azonosítójával, és a visszaolvasás igazolja", async () => {
    const { shop, deps } = fake(twoEqual());
    const entries = await dedupeProducts(["os_1"], deps, { apply: true });
    assert.deepEqual(shop.writes, [
      {
        productId: "prod_1",
        variantId: "variant_1",
        prices: [{ id: A, currency_code: "huf", amount: 500 }],
      },
    ]);
    assert.equal(entries[0]!.action, "fixed");
    assert.deepEqual(
      shop.variants.get("variant_1")!.prices.map((row) => row.id),
      [A],
    );
  });

  /*
    AZ AKCIÓS ÁRLISTA SORA A JAVÍTÁSNÁL (kártya 54bb3779). MI PIROSÍT: az árlistás sor "nem egyszerű" sorként elutasítja a
    két alapár javítását; a javítás kiírásakor a lista sora törlődik vagy a megtartott sorok közé kerül; a visszaolvasás az
    árlista sorát második sorként számolja, és a jó javítást `read-back-mismatch`-nek mondja.
  */
  it("két egyenlő alapár mellett az árlistás sor marad, és a javítás fixed (a visszaolvasás csak az alapárat számolja)", async () => {
    const sale = plain("price_01M1YGHW2SALE0000000000001", 300, {
      price_list_id: "pl_sale",
    });
    const { shop, deps } = fake({
      variant_1: { sku: "SKU-1", prices: [plain(B, 500), plain(A, 500), sale] },
    });
    const entries = await dedupeProducts(["os_1"], deps, { apply: true });
    assert.equal(entries[0]!.action, "fixed");
    assert.deepEqual(shop.writes[0]!.prices, [
      { id: A, currency_code: "huf", amount: 500 },
    ]);
    assert.deepEqual(
      shop.variants
        .get("variant_1")!
        .prices.map((row) => row.id)
        .sort(),
      [A, sale.id].sort(),
    );
  });

  it("minden más alak elutasítva, és semmit nem ír", async () => {
    const cases: [
      string,
      Parameters<typeof fake>[0],
      Parameters<typeof fake>[1],
      string,
    ][] = [
      [
        "non-plain",
        {
          v: {
            sku: "S",
            prices: [plain(A, 500), plain(B, 500, { min_quantity: 5 })],
          },
        },
        {},
        "non-plain-row",
      ],
      [
        "unknown shape",
        {
          v: {
            sku: "S",
            prices: [
              { id: A, currency_code: "huf", amount: 500 },
              { id: B, currency_code: "huf", amount: 500 },
            ],
          },
        },
        {},
        "unknown-row-shape",
      ],
      [
        "unequal amounts",
        { v: { sku: "S", prices: [plain(A, 500), plain(B, 600)] } },
        {},
        "duplicates-pick-os",
      ],
      [
        "three rows",
        {
          v: {
            sku: "S",
            prices: [
              plain(A, 500),
              plain(B, 500),
              plain("price_01M1YGHW2ZZZZZZZZZZZZZZZZZ", 500),
            ],
          },
        },
        {},
        "rows-not-two",
      ],
      [
        "foreign currency",
        {
          v: {
            sku: "S",
            prices: [
              plain(A, 500),
              plain(B, 500),
              plain("price_eur", 5, { currency_code: "eur" }),
            ],
          },
        },
        {},
        "foreign-currency-row",
      ],
      [
        "id not ULID",
        {
          v: {
            sku: "S",
            prices: [
              plain("price_manual_1", 500),
              plain("price_manual_2", 500),
            ],
          },
        },
        {},
        "id-not-ulid",
      ],
      [
        "os differs",
        { v: { sku: "S", prices: [plain(A, 500), plain(B, 500)] } },
        { osAmount: 700 },
        "os-price-differs",
      ],
      [
        "os missing",
        { v: { sku: "S", prices: [plain(A, 500), plain(B, 500)] } },
        { osAmount: null },
        "os-price-differs",
      ],
    ];
    for (const [name, variants, options, reason] of cases) {
      const { shop, deps } = fake(variants, options);
      const entries = await dedupeProducts(["os_1"], deps, { apply: true });
      assert.equal(shop.writes.length, 0, name);
      assert.equal(entries[0]!.action, "refused", name);
      assert.equal(entries[0]!.detail, reason, name);
    }
  });

  it("egy sor vagy nulla sor: nincs mit tenni, és nem ír", async () => {
    const { shop, deps } = fake({
      v1: { sku: "S1", prices: [plain(A, 500)] },
      v2: { sku: "S2", prices: [] },
    });
    const entries = await dedupeProducts(["os_1"], deps, { apply: true });
    assert.equal(shop.writes.length, 0);
    assert.deepEqual(
      entries.map((entry) => [entry.action, entry.detail]),
      [
        ["nothing", "single"],
        ["nothing", "none"],
      ],
    );
  });

  it("a sikertelen írás és az eltérő visszaolvasás nem javított, és csak a hiba típusa kerül ki", async () => {
    const thrown = fake(twoEqual(), { throwOnWrite: true });
    const a = await dedupeProducts(["os_1"], thrown.deps, { apply: true });
    assert.equal(a[0]!.action, "failed");
    assert.equal(a[0]!.detail, "write-failed (RangeError)");
    assert.doesNotMatch(JSON.stringify(a), /secret detail/);

    const noOp = fake(twoEqual(), { noOpWrite: true });
    const b = await dedupeProducts(["os_1"], noOp.deps, { apply: true });
    assert.equal(b[0]!.action, "failed");
    assert.match(b[0]!.detail, /^read-back-mismatch/);

    for (const writeAs of ["amount", "id", "extra-row"] as const) {
      const wrong = fake(twoEqual(), { writeAs });
      const c = await dedupeProducts(["os_1"], wrong.deps, { apply: true });
      assert.equal(c[0]!.action, "failed", writeAs);
      assert.match(c[0]!.detail, /^read-back-mismatch/, writeAs);
    }
  });

  it("a második futás már nem ír (ismételhető)", async () => {
    const { shop, deps } = fake(twoEqual());
    await dedupeProducts(["os_1"], deps, { apply: true });
    const again = await dedupeProducts(["os_1"], deps, { apply: true });
    assert.equal(shop.writes.length, 1);
    assert.equal(again[0]!.action, "nothing");
  });

  it("minden változat előtt friss olvasás, és a két változat külön íródik", async () => {
    const { shop, deps } = fake({
      v1: { sku: "S1", prices: [plain(A, 500), plain(B, 500)] },
      v2: {
        sku: "S2",
        prices: [
          plain("price_01M1YGHW3AAAAAAAAAAAAAAAAA", 500),
          plain("price_01M1YGHW3BBBBBBBBBBBBBBBBB", 500),
        ],
      },
    });
    const entries = await dedupeProducts(["os_1"], deps, { apply: true });
    assert.deepEqual(
      shop.writes.map((write) => write.variantId),
      ["v1", "v2"],
    );
    assert.deepEqual(dedupeCounts(entries), { fixed: 2 });
    // per variant: one read for the plan and one for the read back
    assert.equal(shop.reads, 4);
  });

  it("az olvashatatlan termék nem dönt: nincs kötés, olvasási hiba, csonkolt lista, nincs egyező változat", async () => {
    const noLink = fake(twoEqual(), { link: null });
    const e1 = await dedupeProducts(["os_1"], noLink.deps, { apply: true });
    assert.deepEqual(
      [e1[0]!.action, e1[0]!.detail],
      ["unreadable", "no-medusa-link"],
    );

    const failing = fake(twoEqual(), { throwOnRead: true });
    const e2 = await dedupeProducts(["os_1"], failing.deps, { apply: true });
    assert.equal(e2[0]!.action, "unreadable");
    assert.equal(e2[0]!.detail, "read-failed (TypeError)");
    assert.doesNotMatch(JSON.stringify(e2), /secret detail/);

    const truncated = fake(twoEqual(), { truncated: true });
    const e3 = await dedupeProducts(["os_1"], truncated.deps, { apply: true });
    assert.equal(e3[0]!.detail, "variant-list-truncated");

    const { shop, deps } = fake(twoEqual());
    deps.matchVariant = () => ({ error: "no variant" });
    const e4 = await dedupeProducts(["os_1"], deps, { apply: true });
    assert.equal(e4[0]!.action, "unreadable");

    for (const w of [noLink, failing, truncated, { shop }])
      assert.equal(w.shop.writes.length, 0);
  });
});

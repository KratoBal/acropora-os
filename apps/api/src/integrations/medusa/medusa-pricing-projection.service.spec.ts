import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type {
  MedusaAdminClient,
  MedusaPriceInput,
  MedusaPriceListRow,
  MedusaPriceRow,
  MedusaVariantPriceRow,
} from "./medusa-admin.client.js";
import type { PriceOwner } from "./medusa-price-source.js";
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

function priced(
  amount: string | null,
  currency: string | null = "HUF",
  /*
    A FORRAS ALAPERTELMEZESE A SAJAT ARUNK, mert ezek a tesztek az OS-ben tarolt
    arrol szolnak. A tukor-ag SAJAT allitast kap lentebb: a mezot a szolgaltatas
    csak TOVABBVISZI, tehat itt egy alapertelmezes nem rejt el semmit.
  */
  source: PriceOwner = "own",
  /*
    A FELAR ALAPERTELMEZESE `null`, UGYANAZZAL AZ INDOKKAL, MINT A FORRASE: ez a
    szolgaltatas a mezot csak TOVABBVISZI a jelentesbe, nem szamol vele. Az
    OSSZEADAST a `medusa-price-source.ts` vegzi, es ott all rajta a ket
    nev szerinti allitas (hozzaadjuk a tukornel, NEM adjuk hozza a sajat arnal).
  */
  surcharge: Prisma.Decimal | null = null,
) {
  return {
    osProductId: OS_PRODUCT,
    sku: SKU,
    source,
    surcharge,
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
  /** a boltban már álló akciós árlisták (kártya 54bb3779) */
  lists?: MedusaPriceListRow[];
  /** az árlista-hívások hibái */
  listReadFails?: boolean;
  listWriteFails?: boolean;
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
  // the shop's sale price lists, and the order of EVERY write (base price and list calls) as it happened
  const lists: MedusaPriceListRow[] = (options.lists ?? []).map((row) => ({
    ...row,
    prices: (row.prices ?? []).map((price) => ({ ...price })),
  }));
  const order: string[] = [];
  let listsCreated = 0;

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
    // THE SHOP'S SALE PRICE LISTS. The variant's own prices do NOT show a list's row (measured on the test Medusa,
    // exchange/a4-arlista-proba/futas-3.log), so these live apart from `rows`.
    findSaleLists: async (key: string) => {
      order.push("list-find");
      if (options.listReadFails) throw new Error("price list read failed");
      return lists
        .filter((row) => row.description === key)
        .map((row) => ({ ...row, prices: row.prices?.map((p) => ({ ...p })) }));
    },
    createSaleList: async (input: {
      key: string;
      title: string;
      variantId: string;
      amount: number;
      currencyCode: string;
      startsAt: Date | null;
      endsAt: Date | null;
    }) => {
      order.push("list-create");
      if (options.listWriteFails) throw new Error("price list write failed");
      listsCreated += 1;
      const row: MedusaPriceListRow = {
        id: `plist_${listsCreated}`,
        title: input.title,
        description: input.key,
        status: "active",
        starts_at: input.startsAt?.toISOString() ?? null,
        ends_at: input.endsAt?.toISOString() ?? null,
        prices: [
          {
            id: `lprice_${listsCreated}`,
            variant_id: input.variantId,
            currency_code: input.currencyCode,
            amount: input.amount,
          },
        ],
      };
      lists.push(row);
      return row;
    },
    updateSaleList: async (
      listId: string,
      patch: {
        startsAt?: Date | null;
        endsAt?: Date | null;
        status?: "active";
      },
    ) => {
      order.push("list-update");
      if (options.listWriteFails) throw new Error("price list write failed");
      const row = lists.find((l) => l.id === listId)!;
      if (patch.startsAt !== undefined)
        row.starts_at = patch.startsAt?.toISOString() ?? null;
      if (patch.endsAt !== undefined)
        row.ends_at = patch.endsAt?.toISOString() ?? null;
      if (patch.status) row.status = patch.status;
    },
    batchSaleListPrices: async (
      listId: string,
      ops: {
        variantId: string;
        currencyCode: string;
        create: { amount: number }[];
        update: { id: string; amount: number }[];
        delete: string[];
      },
    ) => {
      order.push("list-prices");
      if (options.listWriteFails) throw new Error("price list write failed");
      const row = lists.find((l) => l.id === listId)!;
      row.prices = (row.prices ?? []).filter((p) => !ops.delete.includes(p.id));
      for (const u of ops.update) {
        const price = row.prices.find((p) => p.id === u.id)!;
        price.amount = u.amount;
      }
      for (const c of ops.create) {
        listsCreated += 1;
        row.prices.push({
          id: `lprice_${listsCreated}`,
          variant_id: ops.variantId,
          currency_code: ops.currencyCode,
          amount: c.amount,
        });
      }
    },
    deleteSaleList: async (listId: string) => {
      order.push("list-delete");
      if (options.listWriteFails) throw new Error("price list write failed");
      lists.splice(
        lists.findIndex((l) => l.id === listId),
        1,
      );
    },
    setVariantPrices: async (
      _productId: string,
      _variantId: string,
      prices: MedusaPriceInput[],
    ) => {
      order.push("base-write");
      writes.push(prices);
      if (writeSilentlyDoesNothing) return;
      /**
       * A MÉRT SZEMANTIKA: az `id` nélküli sor ÚJ azonosítót kap, a meglévő
       * `id` a helyén marad, és ami nincs a listában, az eltűnik.
       */
      /**
       * A SALE PRICE LIST'S ROWS SURVIVE (card 54bb3779): the whole-list write only touches the `price_list_id = null`
       * rows (`updatePriceSets_` lists exactly those as existing, @medusajs/pricing 2.22.4, read from the source, not run).
       */
      const listRows = (rows ?? []).filter((row) => row.price_list_id);
      rows = [
        ...listRows,
        ...prices.map((price) => {
          if (price.id) return { ...price, id: price.id } as MedusaPriceRow;
          created += 1;
          return {
            id: `price_uj_${created}`,
            currency_code: price.currency_code,
            amount: price.amount,
          };
        }),
      ];
    },
  } as unknown as MedusaAdminClient;

  return {
    writes,
    lists,
    order,
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
    // a jelek nélküli válasz alakja "unknown": ebből látszik, ha a `*prices` nem hozza őket
    assert.deepEqual(outcome.conflict, {
      rows: 2,
      priceList: 0,
      rules: 0,
      quantity: 0,
      plain: 0,
      unknown: 2,
    });
  });

  /*
    AZ ÜTKÖZŐ SOROK ALAKJA (550b80d1): csak mérés. MI PIROSIT: az árlistás vagy a szabályos sor máshová számít, vagy
    a mérés miatt megváltozik, melyik sor a miénk (itt: a vetítés ír, ahelyett hogy megállna).
  */
  /*
    A FUTÓ AKCIÓ ÁRLISTÁKÉNT (kártya 54bb3779). MI PIROSÍT: az akció az alapárba megy (a bolt nem tud áthúzni); az alapár
    az akciós ár marad egy régi vetítés után; az árlista az alapár UTÁN kerül fel (egy pillanatra a rendes ár látszana);
    a második futás újra ír; egy módosult akció új árlistát kap a meglévő helyett; a megszűnt akció listája megmarad
    (a nem-akciós ág nem takarít), vagy a takarítás a változatlan alapár miatt kimarad; két lista egy kulcs alatt
    találgatás; egy író hiba után az alapár már megváltozott; az akciós ár nem egész forint és mégis megy.
  */
  const START = new Date("2026-11-19T00:00:00.000Z");
  const END = new Date("2026-11-22T22:59:00.000Z");
  const withSale = (
    base: ReturnType<typeof priced>,
    regular: string,
    amount: string,
    over: { startsAt?: Date | null; endsAt?: Date | null } = {},
  ) => ({
    ...base,
    sale: {
      regular: {
        sellingGrossPrice: new Prisma.Decimal(regular),
        sellingPriceCurrency: "HUF",
      },
      amount: new Prisma.Decimal(amount),
      startsAt: over.startsAt === undefined ? START : over.startsAt,
      endsAt: over.endsAt === undefined ? END : over.endsAt,
    },
  });

  it("a futó akciót árlistaként küldi: az alapár a rendes ár, az akciós ár a listán, és a lista kerül fel ELŐSZÖR", async () => {
    const { service, writes, lists, order } = fakes({ prices: [] });

    const outcome = await service.project(
      withSale(priced("69600"), "87000", "69600"),
    );

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.saleList, "created");
    assert.equal(outcome.report.saleAmount, 69600);
    assert.equal(outcome.report.medusaAmount, 87000);
    assert.deepEqual(writes, [[{ currency_code: "huf", amount: 87000 }]]);
    assert.equal(lists.length, 1);
    assert.equal(lists[0]!.description, `os-sale:${VARIANT}`);
    assert.equal(lists[0]!.prices![0]!.amount, 69600);
    assert.equal(lists[0]!.starts_at, START.toISOString());
    assert.equal(lists[0]!.ends_at, END.toISOString());
    // the list before the base price: raising an old sale-as-base price over the list would show the regular price
    assert.deepEqual(order, ["list-find", "list-create", "base-write"]);
  });

  it("egy régi, akciós alapárat (a korábbi vetítés) a rendes árra állít, és a lista már áll előtte", async () => {
    const { service, lists, order, currentRows } = fakes({
      prices: [{ id: "price_old", currency_code: "huf", amount: 69600 }],
    });

    const outcome = await service.project(
      withSale(priced("69600"), "87000", "69600"),
    );

    assert.equal(outcome.action, "projected");
    assert.deepEqual(order, ["list-find", "list-create", "base-write"]);
    assert.equal(lists.length, 1);
    assert.deepEqual(
      currentRows()!.map((row) => [row.id, row.amount]),
      [["price_old", 87000]],
    );
  });

  it("a második futás változatlanul hagyja az árlistát és az alapárat", async () => {
    const { service, order } = fakes({ prices: [] });
    const variant = withSale(priced("69600"), "87000", "69600");
    await service.project(variant);
    order.length = 0;

    const second = await service.project(variant);

    assert.equal(second.action, "projected");
    if (second.action !== "projected") return;
    assert.equal(second.report.result, "no-change");
    assert.equal(second.report.saleList, "unchanged");
    assert.deepEqual(order, ["list-find"]);
  });

  it("egy módosult akciót a meglévő árlistán javít (azonos azonosító): az ár a köteggel, a határ a listával", async () => {
    const { service, lists, order } = fakes({ prices: [] });
    await service.project(withSale(priced("69600"), "87000", "69600"));
    const listId = lists[0]!.id;
    const priceId = lists[0]!.prices![0]!.id;
    order.length = 0;

    const outcome = await service.project(
      withSale(priced("59990"), "87000", "59990", {
        endsAt: new Date("2026-11-30T22:59:00.000Z"),
      }),
    );

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.saleList, "updated");
    assert.equal(lists.length, 1);
    assert.equal(lists[0]!.id, listId);
    assert.equal(lists[0]!.prices![0]!.id, priceId);
    assert.equal(lists[0]!.prices![0]!.amount, 59990);
    assert.equal(lists[0]!.ends_at, "2026-11-30T22:59:00.000Z");
    assert.deepEqual(order, ["list-find", "list-update", "list-prices"]);
  });

  it("nyitott határú akciót (nincs kezdet, nincs vég) null határral küld", async () => {
    const { service, lists } = fakes({ prices: [] });

    await service.project(
      withSale(priced("69600"), "87000", "69600", {
        startsAt: null,
        endsAt: null,
      }),
    );

    assert.equal(lists[0]!.starts_at, null);
    assert.equal(lists[0]!.ends_at, null);
  });

  it("ha az akció megszűnt, az alapár megy előre, és a megmaradt lista törlődik UTÁNA", async () => {
    const { service, lists, order } = fakes({ prices: [] });
    await service.project(withSale(priced("69600"), "87000", "69600"));
    order.length = 0;

    const outcome = await service.project(priced("87000"));

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.saleList, "removed");
    assert.equal(lists.length, 0);
    // the base is already the regular price: no write, and the list is still removed
    assert.deepEqual(order, ["list-find", "list-delete"]);
  });

  it("akció nélkül, lista nélkül egyetlen árlista-írás sincs, és a jelentés none", async () => {
    const { service, order } = fakes({ prices: [] });

    const outcome = await service.project(priced("87000"));

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.saleList, "none");
    assert.deepEqual(order, ["base-write", "list-find"]);
  });

  it("két lista egy kulcs alatt: megáll, és az alapárat sem írja, ha akció van", async () => {
    const twin = (id: string): MedusaPriceListRow => ({
      id,
      description: `os-sale:${VARIANT}`,
      status: "active",
      starts_at: null,
      ends_at: null,
      prices: [
        { id: `${id}_p`, variant_id: VARIANT, currency_code: "huf", amount: 1 },
      ],
    });
    const { service, writes } = fakes({
      prices: [],
      lists: [twin("plist_a"), twin("plist_b")],
    });

    const outcome = await service.project(
      withSale(priced("69600"), "87000", "69600"),
    );

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "sale-list-ambiguous");
    assert.equal(writes.length, 0);
  });

  it("az árlista olvasása vagy írása elhasal: megáll, az alapárhoz nem nyúl (akciónál), és a hiba nevét viszi", async () => {
    const read = fakes({ prices: [], listReadFails: true });
    const readOutcome = await read.service.project(
      withSale(priced("69600"), "87000", "69600"),
    );
    assert.equal(readOutcome.action, "stopped");
    if (readOutcome.action !== "stopped") return;
    assert.equal(readOutcome.reason, "medusa-read-failed");
    assert.equal(read.writes.length, 0);

    const write = fakes({ prices: [], listWriteFails: true });
    const writeOutcome = await write.service.project(
      withSale(priced("69600"), "87000", "69600"),
    );
    assert.equal(writeOutcome.action, "stopped");
    if (writeOutcome.action !== "stopped") return;
    assert.equal(writeOutcome.reason, "medusa-write-failed");
    assert.equal(write.writes.length, 0);
    assert.equal(write.lists.length, 0);
  });

  it("az akciós árra is az egész-forint szabály áll: tört akciós ár megáll, semmit nem ír", async () => {
    const { service, writes, order } = fakes({ prices: [] });

    const outcome = await service.project(
      withSale(priced("69600"), "87000", "69599.5"),
    );

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "price-not-whole-forint");
    assert.equal(writes.length, 0);
    assert.deepEqual(order, []);
  });

  it("egy kézzel létrehozott, hasonló nevű lista nem a miénk: a kulcs pontos egyezést kér", async () => {
    const { service, lists } = fakes({
      prices: [],
      lists: [
        {
          id: "plist_manual",
          description: `os-sale:${VARIANT} (kezi)`,
          status: "active",
          starts_at: null,
          ends_at: null,
          prices: [],
        },
      ],
    });

    const outcome = await service.project(
      withSale(priced("69600"), "87000", "69600"),
    );

    assert.equal(outcome.action, "projected");
    assert.equal(lists.length, 2);
    assert.ok(lists.some((row) => row.id === "plist_manual"));
  });

  it("a kétértelmű ár megállása az ütköző sorok alakját is viszi, és nem ír", async () => {
    const { service, writes } = fakes({
      prices: [
        {
          id: "price_a",
          currency_code: "huf",
          amount: 12990,
          price_list_id: null,
          rules_count: 0,
          min_quantity: null,
          max_quantity: null,
        },
        {
          id: "price_b",
          currency_code: "huf",
          amount: 11990,
          price_list_id: "plist_1",
          rules_count: 1,
          min_quantity: null,
          max_quantity: null,
        },
        {
          id: "price_c",
          currency_code: "huf",
          amount: 10990,
          price_list_id: null,
          rules_count: 0,
          min_quantity: 5,
          max_quantity: null,
        },
      ],
    });

    const outcome = await service.project(priced("14990"));

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "ambiguous-price");
    // the price list's row is not a conflicting row any more (card 54bb3779): the other two still are
    assert.deepEqual(outcome.conflict, {
      rows: 2,
      priceList: 0,
      rules: 0,
      quantity: 1,
      plain: 1,
      unknown: 0,
    });
    assert.equal(writes.length, 0);
  });

  /*
    A SALE PRICE LIST ON THE VARIANT (card 54bb3779). MI PIROSÍT: a vetítés megáll `ambiguous-price`-szal az első
    árlistás akciónál (két forint sort lát); az írás után a visszaolvasás két sort talál, és `write-not-visible`-lel
    áll meg; az alapár cseréje az árlista sorát is viszi vagy új azonosítót ad az alapárnak; az árlista idegen pénznemű
    sora `foreign-currency-price-present`-et okoz.
  */
  const listRow = (over: Partial<MedusaPriceRow> = {}): MedusaPriceRow => ({
    id: "price_sale",
    currency_code: "huf",
    amount: 9990,
    price_list_id: "plist_sale",
    rules_count: 0,
    min_quantity: null,
    max_quantity: null,
    ...over,
  });
  const baseRow = (over: Partial<MedusaPriceRow> = {}): MedusaPriceRow => ({
    id: "price_base",
    currency_code: "huf",
    amount: 12990,
    price_list_id: null,
    rules_count: 0,
    min_quantity: null,
    max_quantity: null,
    ...over,
  });

  it("projects the base price next to a sale price list row, keeps both ids and counts only the base row", async () => {
    const { service, writes, currentRows } = fakes({
      prices: [baseRow(), listRow()],
    });

    const outcome = await service.project(priced("14990"));

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.result, "updated");
    assert.equal(outcome.report.priceId, "price_base");
    // only the base row is sent, with its own id: the price list's row is not in the whole-list write
    assert.deepEqual(writes, [
      [{ id: "price_base", currency_code: "huf", amount: 14990 }],
    ]);
    const after = currentRows() ?? [];
    assert.deepEqual(
      after.map((row) => [row.id, row.amount, row.price_list_id ?? null]),
      [
        ["price_sale", 9990, "plist_sale"],
        ["price_base", 14990, null],
      ],
    );
  });

  it("creates the base price when the variant has only a price list row, and leaves that row", async () => {
    const { service, writes, currentRows } = fakes({ prices: [listRow()] });

    const outcome = await service.project(priced("12990"));

    assert.equal(outcome.action, "projected");
    if (outcome.action !== "projected") return;
    assert.equal(outcome.report.result, "created");
    assert.equal(writes[0]![0]!.id, undefined);
    assert.equal(
      (currentRows() ?? []).filter((r) => r.price_list_id).length,
      1,
    );
  });

  it("does not stop on a price list row in another currency, and still stops on two base rows", async () => {
    const eur = fakes({
      prices: [
        baseRow(),
        listRow({ id: "price_eur_sale", currency_code: "eur", amount: 30 }),
      ],
    });
    const ok = await eur.service.project(priced("14990"));
    assert.equal(ok.action, "projected");

    const dup = fakes({
      prices: [baseRow(), baseRow({ id: "price_base_2" }), listRow()],
    });
    const stopped = await dup.service.project(priced("14990"));
    assert.equal(stopped.action, "stopped");
    if (stopped.action !== "stopped") return;
    assert.equal(stopped.reason, "ambiguous-price");
    assert.equal(stopped.conflict?.rows, 2);
    assert.equal(dup.writes.length, 0);
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

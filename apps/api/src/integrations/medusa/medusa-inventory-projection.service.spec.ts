import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type {
  MedusaAdminClient,
  MedusaStockLocationRow,
  MedusaVariantRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaInventoryProjectionService,
  type ProjectableStock,
} from "./medusa-inventory-projection.service.js";

/**
 * A KÉSZLET-VETÍTÉS VISELKEDÉSE, hálózat nélkül.
 *
 * A hamis kliens NEM csak naplóz: az írásokat SAJÁT ÁLLAPOTÁBA vezeti át, és
 * utánozza a telepített 2.19.0 egyik mért viselkedését is - a hiányzó szintre
 * küldött frissítés HIBÁVAL tér vissza (`ensureInventoryLevels`), nem hoz
 * létre szintet. Enélkül az „ismételt vetítés nem driftel" és az „identity
 * stabil" tesztek olyan világot mérnének, ahol minden írás sikerül és semmi
 * nem marad meg - vagyis nem mérnének semmit.
 */

const decimal = (value: string) => new Prisma.Decimal(value);

const LOCATION: MedusaStockLocationRow = { id: "sloc_1", name: "Acropora" };
const MEDUSA_PRODUCT = "prod_medusa_1";
const CHANNEL = "sc_test";

const stock = (onHand: string, reserved = "0"): ProjectableStock => ({
  osProductId: "prod-os-1",
  sku: "teszt0001",
  onHand: decimal(onHand),
  reserved: decimal(reserved),
});

function variantWith(options: {
  allowBackorder?: boolean;
  manageInventory?: boolean;
  levels?: { location_id: string; stocked_quantity: number }[] | undefined;
  inventoryItems?: MedusaVariantRow["inventory_items"];
  sku?: string;
  /**
   * A `inventory_items` KULCS HIÁNYZIK a válaszból - nem üres, hanem nincs.
   *
   * Saját kapcsoló, és ez nem kényelmi kérdés. Az első változatomban ezt az
   * esetet az `inventoryItems: undefined` jelölte volna, csakhogy attól a
   * segédfüggvény a MÁSIK ágra ment, és a teszt egy MÁSIK őrzőn ment át
   * zölden. A rontás-próba mutatta meg: a lánc-hiány őrzőjét kivéve NULLA
   * teszt bukott. Egy teszt, ami nem azt a bemenetet állítja elő, amiről
   * beszél, pontosan úgy néz ki, mint egy jó teszt.
   */
  chainMissing?: boolean;
}): MedusaVariantRow {
  const base: MedusaVariantRow = {
    id: "variant_1",
    sku: options.sku ?? "teszt0001",
    allow_backorder: options.allowBackorder ?? false,
    manage_inventory: options.manageInventory ?? true,
  };
  if (options.chainMissing) return base;
  if (options.inventoryItems !== undefined)
    return { ...base, inventory_items: options.inventoryItems };
  return {
    ...base,
    inventory_items: [
      {
        inventory: {
          id: "iitem_1",
          ...(options.levels === undefined
            ? {}
            : { location_levels: options.levels }),
        },
      },
    ],
  };
}

function fakes(options: {
  link?: { productId: string; medusaProductId: string } | null;
  locations?: MedusaStockLocationRow[];
  variants?: MedusaVariantRow[];
  failOn?: "backorder" | "level";
}) {
  const calls: string[] = [];
  const variants = options.variants ?? [variantWith({ levels: [] })];
  const locations = options.locations ?? [LOCATION];

  const findVariant = (variantId: string) =>
    variants.find((row) => row.id === variantId);

  const medusa = {
    async listStockLocationsForSalesChannel(salesChannelId: string) {
      calls.push(`locations:${salesChannelId}`);
      return locations;
    },
    async listProductVariants(productId: string) {
      calls.push(`variants:${productId}`);
      return variants;
    },
    async updateVariantBackorder(
      productId: string,
      variantId: string,
      allowBackorder: boolean,
    ) {
      calls.push(`backorder:${variantId}:${allowBackorder}`);
      if (options.failOn === "backorder")
        throw new Error("MEDUSA_ADMIN_HTTP_400: nem sikerult");
      const variant = findVariant(variantId);
      if (variant) variant.allow_backorder = allowBackorder;
    },
    async createInventoryLevel(
      inventoryItemId: string,
      locationId: string,
      quantity: number,
    ) {
      calls.push(`create-level:${inventoryItemId}:${locationId}:${quantity}`);
      if (options.failOn === "level")
        throw new Error("MEDUSA_ADMIN_HTTP_400: nem sikerult");
      const inventory = variants[0]?.inventory_items?.[0]?.inventory;
      inventory?.location_levels?.push({
        location_id: locationId,
        stocked_quantity: quantity,
      });
    },
    async updateInventoryLevel(
      inventoryItemId: string,
      locationId: string,
      quantity: number,
    ) {
      calls.push(`update-level:${inventoryItemId}:${locationId}:${quantity}`);
      if (options.failOn === "level")
        throw new Error("MEDUSA_ADMIN_HTTP_400: nem sikerult");
      const level =
        variants[0]?.inventory_items?.[0]?.inventory?.location_levels?.find(
          (row) => row.location_id === locationId,
        );
      /**
       * A MÉRT viselkedés: a frissítés NEM hoz létre hiányzó szintet, hanem
       * `Item ... is not stocked at location ...` hibát dob.
       */
      if (!level)
        throw new Error(
          `MEDUSA_ADMIN_HTTP_404: Item ${inventoryItemId} is not stocked at location ${locationId}`,
        );
      level.stocked_quantity = quantity;
    },
    /**
     * A PUBLIKÁCIÓS ÚT. Nem azért van itt, mert kell, hanem hogy MÉRHETŐ
     * legyen, hogy a készlet-vetítés SOSEM hívja: a brief 14. és 15. tesztje
     * pontosan ezt kéri számon.
     */
    async update() {
      calls.push("product-update");
      throw new Error("a keszlet-vetites nem nyulhat a termekhez");
    },
    async create() {
      calls.push("product-create");
      throw new Error("a keszlet-vetites nem hozhat letre termeket");
    },
  } as unknown as MedusaAdminClient;

  const links = {
    async findByProductId(productId: string) {
      calls.push(`link:${productId}`);
      return options.link === undefined
        ? { productId, medusaProductId: MEDUSA_PRODUCT }
        : options.link;
    },
  } as unknown as MedusaProductLinkRepository;

  return {
    calls,
    variants,
    service: new MedusaInventoryProjectionService(links, medusa, CHANNEL),
  };
}

/** A szint mai állapota a hamis kliensben. */
const levelsOf = (variants: MedusaVariantRow[]) =>
  variants[0]?.inventory_items?.[0]?.inventory?.location_levels ?? [];

describe("Medusa készlet-vetítés", () => {
  it("első vetítés: létrehozza a szintet a csatorna helyén", async () => {
    const { service, calls, variants } = fakes({});
    const outcome = await service.project(stock("5", "2"));

    assert.ok(outcome.action !== "stopped");
    assert.equal(outcome.action, "created");
    assert.equal(outcome.report.medusaQuantity, 3);
    assert.equal(outcome.report.locationName, "Acropora");
    assert.deepEqual(levelsOf(variants), [
      { location_id: "sloc_1", stocked_quantity: 3 },
    ]);
    assert.ok(calls.includes("create-level:iitem_1:sloc_1:3"));
  });

  /**
   * A TIZENHATODIK TESZT, és ez a kör legfontosabb állítása.
   *
   * Balázs döntése szerint a nulla darabszámú termék „Rendelhető". A
   * mechanizmus az `allow_backorder`, és az ALAPÉRTELMEZÉSE `false`, vagyis a
   * döntés ELLENTÉTE. A teszt tehát nem azt méri, hogy leírtuk a szándékot,
   * hanem azt, hogy a vetítés VÉGRE IS HAJTJA - és akkor piros, ha a
   * mechanizmus hiányzik.
   */
  it("nulla készletnél BEÁLLÍTJA a rendelhetőséget (különben a bolt az ellenkezőjét csinálja)", async () => {
    const { service, calls, variants } = fakes({
      variants: [variantWith({ allowBackorder: false, levels: [] })],
    });
    const outcome = await service.project(stock("0"));

    assert.ok(outcome.action !== "stopped");
    assert.equal(outcome.report.medusaQuantity, 0);
    assert.ok(
      calls.includes("backorder:variant_1:true"),
      "az allow_backorder beállítása nem történt meg: egy nulla készletű termék " +
        "így NEM lenne megvásárolható, holott a döntés szerint rendelhető",
    );
    assert.equal(variants[0]!.allow_backorder, true);
    assert.equal(outcome.report.backorderResult, "set");
  });

  it("a rendelhetőség a MENNYISÉG ELŐTT áll be (a legkárosabb félállapot ellen)", async () => {
    const { service, calls } = fakes({
      variants: [variantWith({ allowBackorder: false, levels: [] })],
    });
    await service.project(stock("0"));

    const backorder = calls.indexOf("backorder:variant_1:true");
    const level = calls.findIndex((entry) => entry.startsWith("create-level:"));
    assert.ok(backorder >= 0 && level >= 0);
    assert.ok(
      backorder < level,
      "fordított sorrendben a megszakadt futás nulla készletnél MEGVÁSÁROLHATATLAN terméket hagyna",
    );
  });

  it("ha a rendelhetőség már igaz, nem írjuk újra", async () => {
    const { service, calls } = fakes({
      variants: [variantWith({ allowBackorder: true, levels: [] })],
    });
    const outcome = await service.project(stock("1"));

    assert.ok(outcome.action !== "stopped");
    assert.equal(outcome.report.backorderResult, "unchanged");
    assert.ok(!calls.some((entry) => entry.startsWith("backorder:")));
  });

  /** A brief 6. tesztje. */
  it("ismételt vetítés ugyanazzal az állapottal nem driftel", async () => {
    const { service, calls, variants } = fakes({});
    await service.project(stock("5", "2"));
    const second = await service.project(stock("5", "2"));

    assert.equal(second.action, "no-change");
    assert.deepEqual(levelsOf(variants), [
      { location_id: "sloc_1", stocked_quantity: 3 },
    ]);
    assert.equal(
      calls.filter((entry) => entry.startsWith("create-level:")).length,
      1,
      "a második futás nem hozhat létre újabb szintet",
    );
    assert.equal(
      calls.filter((entry) => entry.startsWith("update-level:")).length,
      0,
      "változatlan állapotnál nem írunk",
    );
  });

  /** A 7. teszt: csökkentés ABSZOLÚT, nem delta. */
  it("csökkentés: a kívánt állapotot küldjük, nem a különbséget", async () => {
    const { service, calls, variants } = fakes({});
    await service.project(stock("5"));
    const outcome = await service.project(stock("3"));

    assert.equal(outcome.action, "updated");
    assert.ok(
      calls.includes("update-level:iitem_1:sloc_1:3"),
      "delta esetén itt -2 menne, és a bolt készlete csendben elcsúszna",
    );
    assert.equal(levelsOf(variants)[0]?.stocked_quantity, 3);
  });

  /** A 8. teszt: növelés ugyanígy. */
  it("növelés: a kívánt állapotot küldjük, nem a különbséget", async () => {
    const { service, calls, variants } = fakes({});
    await service.project(stock("3"));
    await service.project(stock("5"));

    assert.ok(calls.includes("update-level:iitem_1:sloc_1:5"));
    assert.equal(levelsOf(variants)[0]?.stocked_quantity, 5);
  });

  it("3 -> 0 után nulla marad", async () => {
    const { service, variants } = fakes({});
    await service.project(stock("3"));
    await service.project(stock("0"));
    assert.equal(levelsOf(variants)[0]?.stocked_quantity, 0);
  });

  /** A 9. teszt. */
  it("az inventory item azonossága stabil a futások között", async () => {
    const { service } = fakes({});
    const first = await service.project(stock("5"));
    const second = await service.project(stock("4"));

    assert.ok(first.action !== "stopped" && second.action !== "stopped");
    assert.equal(first.report.inventoryItemId, second.report.inventoryItemId);
    assert.equal(first.report.variantId, second.report.variantId);
  });

  /** A 10. teszt. */
  it("a készletszint azonossága stabil: nem keletkezik második szint", async () => {
    const { service, variants } = fakes({});
    await service.project(stock("5"));
    await service.project(stock("4"));
    await service.project(stock("4"));

    assert.equal(levelsOf(variants).length, 1);
    assert.equal(levelsOf(variants)[0]?.location_id, "sloc_1");
  });

  /** A 11. teszt. */
  it("a Medusa hibája NEM sikeres futás", async () => {
    const { service } = fakes({ failOn: "level" });
    const outcome = await service.project(stock("5"));

    assert.equal(outcome.action, "stopped");
    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "medusa-write-failed");
  });

  /** A 12. teszt: részleges hiba, majd újrafuttatás - konvergál. */
  it("részleges hiba után az újrafuttatás ugyanoda konvergál", async () => {
    const variants = [variantWith({ allowBackorder: false, levels: [] })];
    const failing = fakes({ failOn: "level", variants });
    const first = await failing.service.project(stock("5"));

    assert.ok(first.action === "stopped");
    assert.equal(first.reason, "medusa-write-failed");
    assert.match(
      first.details,
      /rendelhetőség viszont MÁR BEÁLLT/,
      "a félállapotot MEG KELL NEVEZNI, nem elrejteni",
    );
    assert.equal(
      variants[0]!.allow_backorder,
      true,
      "a rendelhetőség beállt: ez a félállapot, és a jelentésnek erről kell szólnia",
    );
    assert.equal(levelsOf(variants).length, 0);

    /** Ugyanaz az állapot, működő hálózattal: a futás befejezi a munkát. */
    const retry = fakes({ variants });
    const second = await retry.service.project(stock("5"));
    assert.ok(second.action !== "stopped");
    assert.equal(levelsOf(variants)[0]?.stocked_quantity, 5);
  });

  /**
   * A 14. és 15. teszt EGYÜTT: a készlet-vetítés nem nyúl a publikációhoz.
   *
   * Nem állításként, hanem MÉRHETŐEN: a hamis kliens termék-írásai dobnak, és
   * a hívásnapló megmutatja, hogy meg sem próbáltuk.
   */
  it("nulla készlet NEM tesz drafttá terméket, és nem nyúl csatornához", async () => {
    const { service, calls } = fakes({});
    const outcome = await service.project(stock("0"));

    assert.ok(outcome.action !== "stopped");
    assert.equal(outcome.report.medusaQuantity, 0);
    assert.ok(!calls.includes("product-update"));
    assert.ok(!calls.includes("product-create"));
  });

  it("a publikációs állapot nem is bemenete a készletképletnek", async () => {
    /**
     * A `ProjectableStock` szerkezetében NINCS publikációs mező. Ez a teszt
     * ezt a szerkezeti tényt méri: ugyanaz a készlet ugyanazt a mennyiséget
     * adja, bármi is a termék publikációs állapota - mert az ide el sem jut.
     */
    const { service } = fakes({});
    const outcome = await service.project(stock("7", "2"));
    assert.ok(outcome.action !== "stopped");
    assert.equal(outcome.report.medusaQuantity, 5);
    assert.equal(Object.keys(stock("7", "2")).includes("publication"), false);
  });

  it("negatív készlet nullára vágva megy ki, és a jelentés jelzi", async () => {
    const { service, variants } = fakes({});
    const outcome = await service.project(stock("3", "5"));

    assert.ok(outcome.action !== "stopped");
    assert.equal(outcome.report.medusaQuantity, 0);
    assert.equal(outcome.report.clamped, true);
    assert.equal(outcome.report.availableToSell, "-2");
    assert.equal(levelsOf(variants)[0]?.stocked_quantity, 0);
  });
});

describe("Medusa készlet-vetítés: fail-closed kapuk", () => {
  it("csatorna nélkül meg sem indul", async () => {
    const calls: string[] = [];
    const medusa = {
      async listStockLocationsForSalesChannel() {
        calls.push("locations");
        return [];
      },
    } as unknown as MedusaAdminClient;
    const links = {
      async findByProductId() {
        calls.push("link");
        return { productId: "prod-os-1", medusaProductId: MEDUSA_PRODUCT };
      },
    } as unknown as MedusaProductLinkRepository;

    const service = new MedusaInventoryProjectionService(links, medusa, null);
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "sales-channel-not-configured");
    assert.deepEqual(calls, [], "beállítás nélkül egyetlen hívás sem indul");
  });

  it("nulla készlethely a csatornán -> megállunk, nem írunk", async () => {
    const { service, calls } = fakes({ locations: [] });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "stock-location-not-resolved");
    assert.ok(!calls.some((entry) => entry.includes("level")));
    assert.ok(!calls.some((entry) => entry.startsWith("backorder:")));
  });

  it("több készlethely a csatornán -> üzleti döntés, megállunk", async () => {
    const { service, calls } = fakes({
      locations: [LOCATION, { id: "sloc_2", name: "Bolt" }],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "stock-location-not-resolved");
    assert.match(outcome.details, /sloc_1 \(Acropora\), sloc_2 \(Bolt\)/);
    assert.ok(!calls.some((entry) => entry.includes("level")));
  });

  it("a készlethely a CSATORNÁBÓL jön, minden futásnál", async () => {
    const { service, calls } = fakes({});
    await service.project(stock("5"));
    assert.ok(
      calls.includes(`locations:${CHANNEL}`),
      "beégetett készlethely-azonosító nincs: a helyet a csatorna adja",
    );
  });

  it("leképezés nélkül nem hozunk létre semmit", async () => {
    const { service, calls } = fakes({ link: null });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "no-product-link");
    assert.deepEqual(
      calls.filter((entry) => !entry.startsWith("link:")),
      [],
    );
  });

  it("hiányzó kapcsolat-mező: megállunk, nem üres listának olvassuk", async () => {
    const variant = variantWith({ chainMissing: true });
    assert.equal(
      "inventory_items" in variant,
      false,
      "a bemenetnek tényleg HIÁNYOZNIA kell, különben egy másik őrzőt mérnénk",
    );

    const { service, calls } = fakes({ variants: [variant] });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "inventory-chain-missing");
    assert.match(outcome.details, /inventory_items/);
    assert.ok(
      !calls.some((entry) => entry.includes("level")),
      "üres listaként olvasva itt csendben a rossz ágra mennénk",
    );
  });

  it("hiányzó szint-lista: megállunk, és MÁS mezőt nevez meg", async () => {
    const { service } = fakes({
      variants: [variantWith({ levels: undefined })],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "inventory-chain-missing");
    assert.match(outcome.details, /location_levels/);
  });

  it("üres kapcsolat-lista: NINCS inventory item, és ez más ok", async () => {
    const { service } = fakes({
      variants: [variantWith({ inventoryItems: [] })],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "no-inventory-item");
  });

  it("nem készletkezelt változat: saját ok, saját teendő", async () => {
    const { service } = fakes({
      variants: [variantWith({ manageInventory: false, levels: [] })],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "inventory-not-managed");
  });

  it("nincs ilyen cikkszámú változat: megnevezzük, mi van helyette", async () => {
    const { service } = fakes({
      variants: [variantWith({ sku: "masik", levels: [] })],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "variant-not-found");
    assert.match(outcome.details, /masik/);
  });

  it("két azonos cikkszámú változat: azonossági kérdés, megállunk", async () => {
    const { service } = fakes({
      variants: [
        variantWith({ levels: [] }),
        { ...variantWith({ levels: [] }), id: "variant_2" },
      ],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "ambiguous-variant");
  });

  it("két inventory item egy változaton: azonossági kérdés, megállunk", async () => {
    const { service } = fakes({
      variants: [
        variantWith({
          inventoryItems: [
            { inventory: { id: "iitem_1", location_levels: [] } },
            { inventory: { id: "iitem_2", location_levels: [] } },
          ],
        }),
      ],
    });
    const outcome = await service.project(stock("5"));

    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "ambiguous-inventory-item");
  });
});

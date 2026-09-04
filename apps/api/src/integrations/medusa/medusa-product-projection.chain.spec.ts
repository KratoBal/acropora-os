import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaProductInput,
  type MedusaProductLookupRow,
  type MedusaProductRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectableProduct,
} from "./medusa-product-projection.service.js";

/**
 * A HÁROM ÁLLAPOT EGY FUTAMBAN: `created`, `updated`, `relinked`.
 *
 * A meglévő `medusa-product-projection.service.spec.ts` mindhárom ágat méri,
 * de KÜLÖN-KÜLÖN, előre beállított kiindulóhelyzetből. Ez a lap mást állít, és
 * pont azt, ami az átvételi feltétel: hogy a lánc VÉGIGMEGY emberi kéz nélkül.
 *
 * A KÜLÖNBSÉG NEM SZŐRSZÁLHASOGATÁS, és mért esetből jön. 2026-08-29-én a
 * stage-en úgy futott végig a készlet-vetítés, hogy előtte valaki KÉZZEL írt be
 * egy leképezés-sort. Három zöld egység-teszt mellett is: azok ugyanis a
 * leképezést BEMENETKÉNT kapják, tehát arról hallgatnak, hogy honnan lett.
 * Ez a lap a leképezést KIMENETNEK tekinti, és csak a szolgáltatás írhatja.
 *
 * A hamis bolt ezért ÁLLAPOTOS, és a cél oldali egyediséget is utánozza. A két
 * korlátot a telepített Medusa 2.19.0 forrásából mértem, nem feltételeztem:
 * `IDX_product_handle_unique` a `product.handle`, `IDX_product_variant_sku_unique`
 * a `product_variant.sku` oszlopon, mindkettő részleges (`deleted_at IS NULL`).
 *
 * AZ ÜTKÖZÉS VÁLASZA HTTP 400, ÉS EZ NEM MAGÁTÓL ÉRTETŐDŐ. A `23505` kódot NEM a
 * HTTP réteg látja meg: a modul adat-rétege előbb elkapja
 * (`mikro-orm-repository.js`, minden tranzakció `.catch(dbErrorMapper)` alatt
 * fut), és `INVALID_DATA` típusú hibává alakítja, `"<Tábla> with <kulcs>:
 * <érték>, already exists."` szöveggel. Az `exception-formatter.js` 23505 ágából
 * születő `DUPLICATE_ERROR` és a hozzá tartozó 422 státusz LÉTEZIK, de a modul
 * írásai nem járnak arra: mire odaérnének, már MedusaError van a kézben.
 *
 * Ezt a stage FUTÓ példányának naplója mondta meg, nem a forrás-olvasatom: a
 * 2026-08-29 14:44:04 időbélyegű sor szó szerint `Product variant with sku:
 * TEST0001, already exists.`, és utána a `POST /admin/products` 400 státusszal
 * zárt. Az első következtetésem 422 volt, mert a `dbErrorMapper` réteget
 * kihagytam a láncból.
 *
 * A GYAKORLATI KÖVETKEZMÉNYE, ami miatt ez itt áll: a 400 státusz ÖNMAGÁBAN nem
 * különbözteti meg az ütközést egy sémasértéstől. A kettőt csak a szöveg
 * választja szét, azt viszont mi szándékosan nem visszhangozzuk, mert az
 * ÉRTÉKET is viszi (itt magát a cikkszámot).
 */

const SALES_CHANNEL = "sc_test_channel";
const now = new Date("2026-08-29T10:00:00.000Z");

const product: ProjectableProduct = {
  id: "prod-os-chain-1",
  name: "Stage Proof Pump",
  description: "Leírás",
  descriptionLong: null,
  primarySku: "STAGEPROOF0002",
  /*
    EGY VALTOZAT, UNAS KOMBINACIO NELKUL: ez a hetkoznapi termek alakja (ma
    1884 ilyen van). A vetites ilyenkor a sajat alapertelmezett opciojat adja,
    es EZ AZ AZ ALAK, aminek a viselkedese NEM valtozhat.
  */
  variantRows: [{ sku: "STAGEPROOF0002", unasVariantValues: null }],
  /** A fixtura NEM ad teljes kategoria-listat: a mezo igy nem kerul a torzsbe. */
  medusaCategoryIds: null,
  medusaCollectionId: null,
  barcode: null,
  unit: null,
  secondaryUnit: null,
  secondaryUnitFactor: null,
  minimumOrderQuantity: null,
  maximumOrderQuantity: null,
  orderQuantityStep: null,
  slug: null,
  seoRobots: null,
  seoTitle: null,
  seoDescription: null,
  seoKeywords: null,
  unasProductUrl: null,
  images: null,
  publication: {
    catalogAuthority: "ACROPORA",
    isActive: true,
    webshopSellable: true,
    activeVariantCount: 1,
  },
};

interface StoredProduct {
  id: string;
  handle: string;
  externalId: string | null;
  sku: string | null;
  deletedAt: string | null;
}

/**
 * A cél oldal, ahogy VISELKEDIK, nem ahogy válaszol.
 *
 * A `title` alapú handle-képzés szándékosan durvább, mint a Medusáé: itt csak
 * annyi kell belőle, hogy KÉT AZONOS CÍMBŐL azonos handle legyen, mert az
 * ütközés a mérendő, nem a karakter-szabály.
 */
function fakeStore(seed: StoredProduct[] = []) {
  const rows = new Map<string, StoredProduct>();
  for (const row of seed) rows.set(row.id, row);
  let counter = 0;

  const live = () => [...rows.values()].filter((row) => !row.deletedAt);

  const handleOf = (title: string) =>
    title.toLowerCase().trim().replace(/\s+/g, "-");

  /**
   * A cél oldal ÜTKÖZÉS-VÁLASZA, a mért alakban: 400, `invalid_data`, és a
   * szövegben ott áll az ÉRTÉK. A törzs azért ilyen pontos, mert a lap alján
   * álló szivárgás-állítás csak akkor mér valamit, ha a törzsben tényleg benne
   * van, aminek nem szabad kikerülnie.
   */
  const duplicate = (table: string, field: string, value: string): never => {
    throw new MedusaAdminHttpError(
      400,
      JSON.stringify({
        type: "invalid_data",
        message: `${table} with ${field}: ${value}, already exists.`,
      }),
    );
  };

  const client = {
    findSalesChannel: async (id: string) => ({ id, name: "Acropora Webshop" }),
    findByExternalId: async (externalId: string) => {
      const found: MedusaProductLookupRow[] = [...rows.values()]
        .filter((row) => row.externalId === externalId)
        .map((row) => ({
          id: row.id,
          deleted_at: row.deletedAt,
          external_id: row.externalId,
        }));
      return { rows: found, truncated: false };
    },
    create: async (input: MedusaProductInput): Promise<MedusaProductRow> => {
      const handle = handleOf(input.title);
      if (live().some((row) => row.handle === handle))
        duplicate("Product", "handle", handle);
      const sku = input.variants[0]?.sku ?? null;
      if (sku && live().some((row) => row.sku === sku))
        duplicate("Product variant", "sku", sku);

      counter += 1;
      const created: StoredProduct = {
        id: `prod_fake_${counter}`,
        handle,
        externalId: input.external_id,
        sku,
        deletedAt: null,
      };
      rows.set(created.id, created);
      return { id: created.id, deleted_at: null };
    },
    update: async (
      id: string,
      input: Partial<MedusaProductInput>,
    ): Promise<MedusaProductRow> => {
      const row = rows.get(id);
      assert.ok(row, `a hamis bolt nem ismeri a ${id} azonosítót`);
      if (input.external_id !== undefined) row.externalId = input.external_id;
      return { id: row.id, deleted_at: row.deletedAt };
    },
  } as unknown as MedusaAdminClient;

  return { client, rows, live };
}

/**
 * A leképezés-tábla, ÍRÁS-NAPLÓVAL.
 *
 * A napló nem kényelmi: enélkül a „senki nem írta kézzel" állítást nem lehet
 * kimondani, csak hinni. A `forget` az élő `--forget-link` kapcsoló megfelelője.
 */
function fakeLinks() {
  const table = new Map<string, string>();
  const writes: { productId: string; medusaProductId: string }[] = [];

  const repository = {
    findByProductId: async (productId: string) => {
      const medusaProductId = table.get(productId);
      return medusaProductId
        ? { productId, medusaProductId, lastSyncedAt: null }
        : null;
    },
    link: async (productId: string, medusaProductId: string) => {
      table.set(productId, medusaProductId);
      writes.push({ productId, medusaProductId });
      return { productId, medusaProductId, lastSyncedAt: now };
    },
  } as unknown as MedusaProductLinkRepository;

  return { repository, table, writes, forget: () => table.clear() };
}

describe("MedusaProductProjectionService, a teljes lánc", () => {
  it("runs created, updated and relinked without a hand-written link", async () => {
    const store = fakeStore();
    const links = fakeLinks();
    const service = new MedusaProductProjectionService(
      links.repository,
      store.client,
      SALES_CHANNEL,
    );

    const first = await service.project(product, now);
    assert.equal(first.action, "created");
    if (first.action !== "created") return;
    const medusaProductId = first.medusaProductId;

    const second = await service.project(product, now);
    assert.equal(second.action, "updated");
    if (second.action !== "updated") return;
    assert.equal(second.medusaProductId, medusaProductId);

    /** A leképezés elvesztése, ugyanaz, amit a `--forget-link` csinál. */
    links.forget();

    const third = await service.project(product, now);
    assert.equal(third.action, "relinked");
    if (third.action !== "relinked") return;
    assert.equal(third.medusaProductId, medusaProductId);

    /**
     * A LÉNYEG NEM A HÁROM SZÓ, HANEM A DARABSZÁM A MÁSIK OLDALON. Az
     * idempotenciát az bizonyítja, hogy a boltban egyetlen termék van, nem az,
     * hogy mi mit írtunk ki magunkról.
     */
    assert.equal(store.live().length, 1);
    assert.equal(store.live()[0]!.id, medusaProductId);
    assert.equal(store.live()[0]!.externalId, product.id);

    /**
     * És hogy a leképezést KI írta. Három írás, mindhárom a szolgáltatásé, és
     * mindhárom ugyanarra a párra: kézi sor nincs a láncban.
     */
    assert.equal(links.writes.length, 3);
    for (const write of links.writes)
      assert.deepEqual(write, { productId: product.id, medusaProductId });
  });

  /**
   * JELLEMZŐ-TESZT, NEM KÖVETELMÉNY: azt rögzíti, ami MA történik, nem azt,
   * aminek történnie kellene.
   *
   * Az eset a valódi migráció alapesete: a bolt ismeri a cikkszámot, az
   * Acropora OS nem ismeri a párt. A cikkszám egyedi a cél oldalon, tehát a
   * létrehozás elhasal, és a vetítés megáll - NEM hoz létre másodikat, és NEM
   * ír leképezést.
   *
   * Hogy ilyenkor ÖRÖKBE KELL-E FOGADNI a bolti terméket a cikkszám alapján,
   * az azonossági döntés, és Balázsé: a cikkszám üzleti kulcs, amit emberek
   * újra szoktak használni, tehát az örökbefogadás állítás, nem következtetés.
   * Amíg nincs döntés, ez a teszt őrzi, hogy a megállás megállás maradjon.
   */
  it("stops instead of creating a second product when the SKU is already taken", async () => {
    const store = fakeStore([
      {
        id: "prod_already_there",
        handle: "valami-mas-cim",
        externalId: "egy-masik-os-termek",
        sku: product.primarySku,
        deletedAt: null,
      },
    ]);
    const links = fakeLinks();
    const service = new MedusaProductProjectionService(
      links.repository,
      store.client,
      SALES_CHANNEL,
    );

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "medusa-write-failed");

    assert.equal(store.live().length, 1);
    assert.equal(store.live()[0]!.id, "prod_already_there");
    assert.equal(links.writes.length, 0);

    /**
     * A megállás szövege a STÁTUSZT nevezi meg, a választ NEM visszhangozza.
     * A hamis törzsbe szándékosan tettem egy értéket (a cikkszámot), és az
     * állítás az, hogy nem jelenik meg: a jelentés Discordra kerülhet.
     */
    assert.match(outcome.details, /HTTP 400/);
    assert.equal(outcome.details.includes(product.primarySku!), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AI_PRODUCT_SEARCH_PROJECTION_VERSION } from "./ai-product-search.config.js";
import type {
  AiProductSearchRepository,
  ProductSearchRow,
} from "./ai-product-search.repository.js";
import { AiProductSearchService } from "./ai-product-search.service.js";

const row = (overrides: Partial<ProductSearchRow> = {}): ProductSearchRow => ({
  id: "prod_1",
  name: "Fauna Marin Balling Light",
  catalogAuthority: "UNAS",
  description: null,
  mirrorState: "ACTIVE",
  missingSince: null,
  lastSyncedAt: new Date("2026-08-27T06:00:00.000Z"),
  brand: { name: "Fauna Marin" },
  categories: [{ category: { name: "Adalékok" } }],
  variants: [{ sku: "FM-BL-1", name: "1 liter" }],
  unasSnapshot: {
    descriptionShort: "Balling rendszer alapoldat.",
    descriptionLong: "Hosszú leírás.",
    parameters: { kiszereles: "1 l" },
    netPrice: "10000",
    grossPrice: "12700",
    currency: "HUF",
    reportedStock: "4",
    reportedStockSyncedAt: new Date("2026-08-27T05:30:00.000Z"),
    updatedAt: new Date("2026-08-27T06:00:00.000Z"),
  },
  ...overrides,
});

const serviceWith = (rows: ProductSearchRow[], totalMatched = rows.length) =>
  new AiProductSearchService({
    search: async () => ({ rows, totalMatched }),
  } as unknown as AiProductSearchRepository);

describe("AiProductSearchService projekció", () => {
  it("az árat és a készletet STRUKTURÁLTAN adja, nem a szövegbe olvasztva", async () => {
    /**
     * A projekció legfontosabb szabálya. Amit a modell szövegként kap, azt
     * ÁTFOGALMAZZA: egy leírásba ágyazott "12 700 Ft" a válaszban lehet
     * "körülbelül 13 ezer", kerekítve vagy rossz pénznemmel. Egy strukturált
     * mezőt, amit a felület jelenít meg, nem fogalmaz át senki - és ez akkor
     * is igaz, ha az ár soha nem változik.
     */
    const result = await serviceWith([row()]).search({ query: "balling" });
    const hit = result.hits[0]!;

    assert.deepEqual(hit.price, {
      net: 10000,
      gross: 12700,
      currency: "HUF",
      source: "unas",
      at: "2026-08-27T06:00:00.000Z",
    });
    assert.deepEqual(hit.stock, {
      quantity: 4,
      source: "unas",
      at: "2026-08-27T05:30:00.000Z",
    });

    // és a szöveges mezőkben nincs ott az ár
    assert.equal(hit.descriptionShort?.includes("12700"), false);
    assert.equal(hit.descriptionLong?.includes("12700"), false);
  });

  it("a hiányzó árat null-lal adja vissza, nem nullával", async () => {
    // "Nem tudjuk, mennyibe kerül" és "ingyen van" két külön állítás, és
    // csak az egyik igaz.
    const result = await serviceWith([
      row({
        unasSnapshot: {
          descriptionShort: null,
          descriptionLong: null,
          parameters: null,
          netPrice: null,
          grossPrice: null,
          currency: null,
          reportedStock: null,
          reportedStockSyncedAt: new Date("2026-08-27T05:30:00.000Z"),
          updatedAt: new Date("2026-08-27T06:00:00.000Z"),
        },
      }),
    ]).search({ query: "x" });

    assert.equal(result.hits[0]!.price, null);
    assert.equal(result.hits[0]!.stock, null);
  });

  it("megmondja, MELYIK készletről beszél", async () => {
    // Ma csak az UNAS jelentése áll rendelkezésre itt, és a projekció ezt ki
    // is mondja, ahelyett hogy sajátként adná tovább. Amikor a POS
    // sorrendje be lesz kötve, csak a source mező változik, az alak nem.
    const result = await serviceWith([row()]).search({ query: "x" });

    assert.equal(result.hits[0]!.stock?.source, "unas");
  });

  it("a frissesség a találattal együtt utazik", async () => {
    /**
     * Egy keresési eredmény, ami nem tudja megmondani, milyen régi, egy
     * leállt szinkronból magabiztos választ csinál - és a képernyőn semmi
     * nem mutatná.
     */
    const result = await serviceWith([
      row({ lastSyncedAt: new Date("2026-08-27T06:00:00.000Z") }),
      row({ id: "prod_2", lastSyncedAt: new Date("2026-08-20T06:00:00.000Z") }),
    ]).search({ query: "x" });

    assert.equal(result.hits[0]!.lastSyncedAt, "2026-08-27T06:00:00.000Z");
    assert.equal(result.oldestSyncedAt, "2026-08-20T06:00:00.000Z");
  });

  it("a teljes találatszámot külön mondja meg, nem csak a visszaadottakat", async () => {
    // Enélkül a "nem volt több" és a "levágtuk a listát" egyformán néz ki, és
    // aki a választ értékeli, nem tud különbséget tenni.
    const result = await serviceWith([row()], 57).search({ query: "x" });

    assert.equal(result.hits.length, 1);
    assert.equal(result.totalMatched, 57);
  });

  it("a projekció VERZIÓJA a válaszban utazik", async () => {
    // A tárolt értékelés csak akkor értelmezhető később, ha tudjuk, milyen
    // alakú adatból készült a válasz.
    const result = await serviceWith([row()]).search({ query: "x" });

    assert.equal(
      result.projectionVersion,
      AI_PRODUCT_SEARCH_PROJECTION_VERSION,
    );
  });

  it("a leírás TISZTÍTVA hagyja el a szolgáltatást, nem nyersen", async () => {
    /**
     * Ez a teszt nem a tisztító függvényről szól - annak sajátja van -, hanem
     * arról, hogy a vetítés HÍVJA is. A drágább hibaosztály ebben a projektben
     * eddig mindig ez volt: a darab megvan, négy teszt állít róla, és az az
     * útvonal, ami használná, kihagyja. Zöld unit teszt és be nem kötött kód
     * tökéletesen megfér egymás mellett.
     *
     * A bemenet szándékosan olyan leírás, amit az UNAS SIMA SZÖVEGNEK jelöl:
     * a mért katalógusban 774 termék ilyen. A jelzőt itt nem is adjuk át.
     */
    const service = serviceWith([
      row({
        unasSnapshot: {
          descriptionShort: "Els&odblac; sor<br>M&aacute;sodik sor",
          descriptionLong: "<p>Hossz&uacute; leírás.</p>",
          parameters: null,
          netPrice: null,
          grossPrice: null,
          currency: null,
          reportedStock: null,
          reportedStockSyncedAt: new Date("2026-08-27T05:30:00.000Z"),
          updatedAt: new Date("2026-08-27T06:00:00.000Z"),
        },
      }),
    ]);

    const result = await service.search({ query: "x" });

    assert.equal(result.hits[0]!.descriptionShort, "Első sor\nMásodik sor");
    assert.equal(result.hits[0]!.descriptionLong, "Hosszú leírás.");
  });

  it("SEMMIT nem ad vissza, ami nincs a projekcióban", async () => {
    /**
     * A ProductExtension egy relációnyira van a terméktől, és beszerzési árat
     * meg beszállítót tart. Amit a kontextusba teszünk, azt KIMONDOTTNAK kell
     * tekinteni - ezért a mezőlista zárt, és ezt a teszt tételesen állítja.
     */
    const result = await serviceWith([row()]).search({ query: "x" });

    assert.deepEqual(Object.keys(result.hits[0]!).sort(), [
      "brand",
      "categories",
      "descriptionLong",
      "descriptionShort",
      "descriptionSource",
      "lastSyncedAt",
      "mirrorState",
      "missingSince",
      "name",
      "parameters",
      "price",
      "productId",
      "sku",
      "stock",
      "variants",
    ]);
  });
});

/**
 * A price and a stock quantity are two claims of different ages, and the
 * projection has to say which is which.
 *
 * WHY THIS IS NOT PEDANTRY: before this, the row carried one `lastSyncedAt`
 * for everything on it. A sync rewrites the snapshot row whenever ANY field
 * moves, while `reportedStockSyncedAt` only moves when the quantity is
 * actually re-read - so a row can be minutes old while the quantity on it is
 * days old. Reporting the row's time for the quantity would round that
 * difference away silently, and the answer would sound fresher than it is.
 */
describe("az ár és a készlet kora", () => {
  it("az ár idejét a pillanatkép sorából veszi, a készletét a saját oszlopából", async () => {
    const result = await serviceWith([
      row({
        unasSnapshot: {
          descriptionShort: "Rövid.",
          descriptionLong: "Hosszú.",
          parameters: null,
          netPrice: "10000",
          grossPrice: "12700",
          currency: "HUF",
          reportedStock: "4",
          reportedStockSyncedAt: new Date("2026-08-20T09:00:00.000Z"),
          updatedAt: new Date("2026-08-27T06:00:00.000Z"),
        },
      }),
    ]).search({ query: "balling" });
    const hit = result.hits[0]!;

    assert.equal(hit.price?.at, "2026-08-27T06:00:00.000Z");
    assert.equal(hit.price?.source, "unas");

    assert.equal(hit.stock?.at, "2026-08-20T09:00:00.000Z");
    assert.equal(hit.stock?.source, "unas");

    assert.notEqual(
      hit.stock?.at,
      hit.price?.at,
      "a két időpont külön oszlopból jön, tehát nem eshet egybe csak azért, mert egy soron ülnek",
    );
  });

  it("nullát mond, ha egy forrás nem hoz időpontot, és nem tippel helyette", async () => {
    const result = await serviceWith([
      row({
        unasSnapshot: {
          descriptionShort: "Rövid.",
          descriptionLong: null,
          parameters: null,
          netPrice: null,
          grossPrice: null,
          currency: null,
          reportedStock: "4",
          reportedStockSyncedAt: null,
          updatedAt: new Date("2026-08-27T06:00:00.000Z"),
        },
      }),
    ]).search({ query: "balling" });

    assert.equal(result.hits[0]!.stock?.at, null);
  });
});

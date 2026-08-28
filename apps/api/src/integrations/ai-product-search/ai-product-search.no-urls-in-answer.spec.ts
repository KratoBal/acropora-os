import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AiProductSearchRepository,
  ProductSearchRow,
} from "./ai-product-search.repository.js";
import { AiProductSearchService } from "./ai-product-search.service.js";
import type { AiProductSearchHit } from "./ai-product-search.types.js";

/**
 * URL A MODELL ELÉ KERÜLŐ SZÖVEGBEN, ÉS AMIT EZ A FÁJL RÖGZÍT.
 *
 * A projekció az a hely, ahonnan a katalógus szövege elhagyja a mi oldalunkat:
 * ami itt kimegy, azt a modell megkapja. Egy külső cím onnan a válaszba
 * kerülhet, és Balázs szabálya szerint külső hivatkozás csak három nevesített
 * kivételnél mehet ki (2026-08-27).
 *
 * **A mai védelem NEM szabály, hanem MELLÉKHATÁS.** Mérve 2026-08-28 az
 * 1893 termékes exporton: a leírásokban 330 URL áll 96 terméknél, és ebből a
 * projekció után **NULLA** marad. Nem azért, mert bárki kiszűrné, hanem mert
 * mind a 330 HTML-attribútumban áll (`img src`, `a href`, `iframe src`), és a
 * `plainText` a jelölőt eltávolítja.
 *
 * Ebből következik, amit ez a fájl rögzít: **egy sima szövegként beírt cím ma
 * átmegy.** A tesztek MINDKÉT irányt kimondják, mert egy őrző, ami csak a jó
 * esetet méri, nem mond semmit arról, hogy egyáltalán lát-e valamit.
 */

/** Bárhol a projektált találatban: a `parameters` tetszőleges JSON. */
function findUrls(value: unknown, path = "hit"): string[] {
  if (typeof value === "string")
    return (value.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? []).map(
      (url) => `${path}: ${url}`,
    );
  if (Array.isArray(value))
    return value.flatMap((item, index) => findUrls(item, `${path}[${index}]`));
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]) => findUrls(item, `${path}.${key}`),
    );
  return [];
}

const MECHANIZMUS =
  "A projektált szöveg a modell elé kerül, tehát ami itt URL, az a válaszba " +
  "kerülhet. És a HTML-tisztító NEM véd meg ettől: az csak a jelölőt szedi " +
  "ki, tehát egy attribútumban álló címet elvisz, egy sima szövegként beírtat " +
  "viszont nem. Ha ez a teszt pirosodik, a kérdés nem az, hogy honnan jött a " +
  "cím, hanem hogy szabad-e neki a modell elé kerülnie (három nevesített " +
  "kivétel, Balázs, 2026-08-27).";

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
  },
  ...overrides,
});

const hitFor = async (r: ProductSearchRow): Promise<AiProductSearchHit> => {
  const service = new AiProductSearchService({
    search: async () => ({ rows: [r], totalMatched: 1 }),
  } as unknown as AiProductSearchRepository);
  const result = await service.search({ query: "balling" });
  return result.hits[0]!;
};

describe("URL a modell elé kerülő szövegben", () => {
  it("a HTML-attribútumban álló cím NEM jut át", async () => {
    /**
     * Ez a mai katalógus teljes esete: mind a 330 mért URL ilyen alakban áll.
     * A `plainText` a jelölőt eltávolítja, és vele a címet is.
     */
    const hit = await hitFor(
      row({
        unasSnapshot: {
          descriptionShort:
            '<p>Adatlap: <a href="https://www.faunamarin.de/adatlap.pdf">letöltés</a></p>',
          descriptionLong:
            '<img src="https://shop.unas.hu/shop_ordered/47679/pic/002.png">',
          parameters: { kiszereles: "1 l" },
          netPrice: "10000",
          grossPrice: "12700",
          currency: "HUF",
          reportedStock: "4",
        },
      }),
    );

    assert.deepEqual(
      findUrls(hit),
      [],
      `A projektált találat URL-t tartalmaz. ${MECHANIZMUS}`,
    );
    // És ami marad, az a horgony SZÖVEGE, cím nélkül.
    assert.equal(hit.descriptionShort, "Adatlap: letöltés");
  });

  it("a kereső maga nem vak: a sima szövegben álló címet megtalálja", () => {
    /**
     * Egy őrző, ami mindig zöld, attól is zöld lehet, hogy nem néz semmit. Ez
     * a sor az, ami ezt kizárja: ugyanaz a kereső, egy ismert bemeneten.
     */
    assert.deepEqual(
      findUrls({ descriptionShort: "Részletek: https://pelda.hu/adatlap" }),
      ["hit.descriptionShort: https://pelda.hu/adatlap"],
    );
    assert.deepEqual(
      findUrls({ parameters: [{ name: "Adatlap", value: "http://pelda.hu" }] }),
      ["hit.parameters[0].value: http://pelda.hu"],
    );
  });

  it("A HIÁNY, AMIT EZ A FÁJL RÖGZÍT: sima szövegként beírt cím ma ÁTMEGY", async () => {
    /**
     * NEM azt állítjuk, hogy ez így helyes. Azt állítjuk, hogy ma ez történik,
     * és hogy a mai tisztaság a HTML-tisztító mellékhatása, nem szabály.
     *
     * **Ha ez a teszt egyszer pirosodik, az JÓ HÍR:** valaki bekötötte a
     * hiányzó szabályt. Akkor ezt a tesztet törölni kell, és az első kettőt
     * meghagyni - azok a szabályt mérik, ez a hiányát.
     *
     * A `parameters` külön áll a felsorolásban, mert az a mező **nyersen** megy
     * ki, tisztítás nélkül: ott egy cím nem is találkozik a tisztítóval.
     */
    const hit = await hitFor(
      row({
        unasSnapshot: {
          descriptionShort: "Részletek: https://www.marine-aquatics.eu/termek",
          descriptionLong: null,
          parameters: { adatlap: "http://pelda.hu/adatlap.pdf" },
          netPrice: null,
          grossPrice: null,
          currency: null,
          reportedStock: null,
        },
      }),
    );

    assert.deepEqual(findUrls(hit), [
      "hit.descriptionShort: https://www.marine-aquatics.eu/termek",
      "hit.parameters.adatlap: http://pelda.hu/adatlap.pdf",
    ]);
  });
});

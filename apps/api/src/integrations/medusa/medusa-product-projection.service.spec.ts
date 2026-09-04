import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaAdminClient,
  MedusaProductInput,
  MedusaProductRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectableProduct,
} from "./medusa-product-projection.service.js";

/**
 * A vetítés DÖNTÉSE mérve, hívás nélkül.
 *
 * Amit itt bizonyítani kell, az nem az, hogy a HTTP-hívás jól van megírva,
 * hanem hogy a döntés helyes akkor is, amikor a világ nem a legegyszerűbb
 * állapotában van: elveszett leképezés, törölt sor, két élő találat.
 */

const now = new Date("2026-08-24T23:00:00.000Z");

const product: ProjectableProduct = {
  id: "prod-os-1",
  name: "Reef Pump",
  description: "Leírás",
  descriptionLong: null,
  primarySku: "PUMP-1",
  /*
    EGY VALTOZAT, UNAS KOMBINACIO NELKUL: ez a hetkoznapi termek alakja (ma
    1884 ilyen van). A vetites ilyenkor a sajat alapertelmezett opciojat adja,
    es EZ AZ AZ ALAK, aminek a viselkedese NEM valtozhat.
  */
  variantRows: [{ sku: "PUMP-1", unasVariantValues: null }],
  /**
   * Alapból ÉRTÉKESÍTHETŐ állapot, hogy a meglévő tesztek arról szóljanak,
   * amiről eddig: az azonossági láncról. A publikációs viselkedést külön
   * tesztek mérik, saját bemenettel.
   */
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

/** A stage csatornája; a tesztekben csak annyi számít, hogy VAN érték. */
const SALES_CHANNEL = "sc_test_channel";

function fakes(options: {
  link?: { productId: string; medusaProductId: string } | null;
  found?: MedusaProductRow[];
  truncated?: boolean;
  channelMissing?: boolean;
}) {
  const calls: string[] = [];
  const linked: { productId: string; medusaProductId: string }[] = [];
  /**
   * A create BEMENETE, nem csak az, hogy meghívtuk. A hívás-sorrend eddig is
   * mérve volt, a küldött alak viszont nem, és pont az bukott el élesben: a
   * Medusa a változat ár-tömbjét megköveteli, mi meg nem küldtük.
   */
  const createdWith: MedusaProductInput[] = [];
  /**
   * Az update BEMENETE, ugyanabból az okból, amiért a create-é: a publikációs
   * kör állítása az, hogy MIT küldünk, nem az, hogy hívunk-e.
   */
  const updatedWith: Partial<MedusaProductInput>[] = [];

  const links = {
    findByProductId: async () => {
      calls.push("findLink");
      return options.link ? { ...options.link, lastSyncedAt: null } : null;
    },
    link: async (productId: string, medusaProductId: string) => {
      calls.push("link");
      linked.push({ productId, medusaProductId });
      return { productId, medusaProductId, lastSyncedAt: now };
    },
  } as unknown as MedusaProductLinkRepository;

  const medusa = {
    findByExternalId: async () => {
      calls.push("search");
      return {
        rows: options.found ?? [],
        truncated: options.truncated ?? false,
      };
    },
    create: async (input: MedusaProductInput) => {
      calls.push("create");
      createdWith.push(input);
      return { id: "prod_uj", deleted_at: null };
    },
    findSalesChannel: async (id: string) => {
      calls.push("findSalesChannel");
      return options.channelMissing ? null : { id, name: "Acropora Webshop" };
    },
    update: async (_id: string, input: Partial<MedusaProductInput>) => {
      calls.push("update");
      updatedWith.push(input);
      return {
        id: options.link?.medusaProductId ?? "prod_x",
        deleted_at: null,
      };
    },
  } as unknown as MedusaAdminClient;

  return {
    calls,
    linked,
    createdWith,
    updatedWith,
    links,
    medusa,
    service: new MedusaProductProjectionService(links, medusa, SALES_CHANNEL),
  };
}

/**
 * A VETITES NEM EJTHET MEZOT CSENDBEN.
 *
 * MIERT LETEZIK: 2026-09-03-ig a vetites HAT dolgot vitt at (nev, leiras,
 * azonosito, allapot, csatorna, kategoria plusz a cikkszam), es senki nem
 * vette eszre, hogy a tobbi lemarad. A `handle` peldaul MAR OTT VOLT a kliens
 * tipusaban, es a vetites megsem kuldte -- egy be nem kotott mezo semmiben nem
 * kulonbozik egy nem letezotol, amig valaki meg nem szamolja.
 *
 * A LISTA A FIXTURABOL JON, NEM KEZZEL IRVA. Ha valaki uj mezot vesz fel a
 * `ProjectableProduct`-ba, a fixtura kulcsai kozott megjelenik, es ez az
 * allitas AZONNAL szol -- meg akkor is, ha a bekotest elfelejtette. Egy kezzel
 * karbantartott lista pontosan az uj mezot hagyna ki, amiert letezik.
 *
 * ES EZ A MASODIK VEDELEM, NEM AZ ELSO -- kalibraciobol tudjuk. Ha a mezo
 * KOTELEZO, a fordito elobb megall: a harom fixtura es a hivo mind hianyolja.
 * Ez az allitas akkor szolal meg, amikor a fejleszto MAR VEGIGVITTE a mezot
 * mindenhol, es csak a nyilvantartasba nem vette fel -- mert onnantol a
 * fordito elegedett, es semmi mas nem szolna.
 */
const MEZO_SORSA: Record<string, "atmegy" | "szandekosan-nem"> = {
  id: "atmegy", // -> external_id
  name: "atmegy", // -> title es a valtozat neve
  description: "atmegy",
  primarySku: "atmegy", // -> a valtozat sku mezoje
  slug: "atmegy", // -> handle
  seoRobots: "atmegy", // -> metadata.seo_robots
  seoTitle: "atmegy", // -> metadata.seo_title (ma ures, lasd a tipus melletti indokot)
  seoDescription: "atmegy", // -> metadata.seo_description (ma ures)
  seoKeywords: "atmegy", // -> metadata.seo_keywords (ma ures)
  unasProductUrl: "atmegy", // -> metadata.unas_product_url
  descriptionLong: "atmegy", // -> description (osszefuzve) es metadata
  images: "atmegy", // -> images (sorrendben) es thumbnail (az elso elem)
  medusaCategoryIds: "atmegy", // -> categories, ha van teljes lista
  medusaCollectionId: "atmegy", // -> collection_id (a marka gyujtemenye)
  barcode: "atmegy", // -> a valtozat ean vagy upc mezoje, hossz szerint
  unit: "atmegy", // -> metadata.unas_unit
  secondaryUnit: "atmegy", // -> metadata.unas_secondary_unit
  secondaryUnitFactor: "atmegy", // -> metadata.unas_secondary_unit_factor
  minimumOrderQuantity: "atmegy", // -> metadata.unas_minimum_order_quantity
  maximumOrderQuantity: "atmegy", // -> metadata.unas_maximum_order_quantity
  orderQuantityStep: "atmegy", // -> metadata.unas_order_quantity_step
  /**
   * A publikacios ALLAPOT bemenet, nem mezo: belole a `status` es a
   * `sales_channels` szuletik, a szolgaltatas dontese szerint.
   */
  publication: "atmegy",
  /**
   * A VALTOZAT-SOROK: ebbol szuletik az `options` blokk es a `variants` lista.
   *
   * Tengely nelkul a vetites a sajat alapertelmezett opciojat adja (ez ma az
   * 1884 hetkoznapi termek alakja); tengellyel a FORRAS nevet es ertekeit.
   */
  variantRows: "atmegy",
};

describe("MedusaProductProjectionService -- nem ejt mezot csendben", () => {
  it("a bemenet minden mezojenek ki van mondva a sorsa", () => {
    const fixturaMezok = Object.keys(product).sort();
    const nyilvantartott = Object.keys(MEZO_SORSA).sort();
    assert.deepEqual(
      fixturaMezok,
      nyilvantartott,
      "uj mezo a ProjectableProduct-ban: vedd fel a MEZO_SORSA tablaba, es " +
        "mondd ki, atmegy-e vagy szandekosan nem",
    );
  });

  /**
   * ES A NYILVANTARTAS NEM ELEG: az "atmegy" jelolesnek LATSZANIA is kell a
   * keres torzseben. Enelkul a tabla csak egy szandek-nyilatkozat lenne, es
   * pontosan ugy nezne ki egy bekotott es egy elfelejtett mezo.
   */
  it("amire azt mondjuk, hogy atmegy, az tenyleg ott van a keresben", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(
      {
        ...product,
        slug: "Teszt-cim",
        seoRobots: "noindex, nofollow",
        seoTitle: "Teszt cim",
        seoDescription: "Teszt leiras",
        seoKeywords: "teszt, kulcsszo",
        unasProductUrl: "https://bolt.test/regi-lap",
        medusaCategoryIds: ["cat_1"],
        medusaCollectionId: "pcol_1",
        barcode: { field: "ean" as const, value: "4006381333931" },
        unit: "ml",
        secondaryUnit: "karton",
        secondaryUnitFactor: "12",
        minimumOrderQuantity: "2",
        maximumOrderQuantity: "50",
        orderQuantityStep: "5",
        images: ["https://kep/1.jpg", "https://kep/2.jpg"],
        descriptionLong: "Hosszú leírás",
      },
      now,
    );
    const torzs = f.createdWith[0];
    assert.ok(torzs, "a create nem futott le");
    const megjelenik: Record<string, boolean> = {
      id: torzs.external_id === "prod-os-1",
      name: torzs.title === "Reef Pump",
      description: (torzs.description ?? "").includes("Leírás"),
      descriptionLong: (torzs.description ?? "").includes("Hosszú leírás"),
      primarySku: torzs.variants[0]?.sku === "PUMP-1",
      slug: torzs.handle === "teszt-cim",
      medusaCategoryIds: torzs.categories?.[0]?.id === "cat_1",
      medusaCollectionId: torzs.collection_id === "pcol_1",
      barcode: torzs.variants[0]?.ean === "4006381333931",
      unit: torzs.metadata?.unas_unit === "ml",
      secondaryUnit: torzs.metadata?.unas_secondary_unit === "karton",
      secondaryUnitFactor: torzs.metadata?.unas_secondary_unit_factor === "12",
      minimumOrderQuantity: torzs.metadata?.unas_minimum_order_quantity === "2",
      maximumOrderQuantity:
        torzs.metadata?.unas_maximum_order_quantity === "50",
      orderQuantityStep: torzs.metadata?.unas_order_quantity_step === "5",
      seoRobots: torzs.metadata?.seo_robots === "noindex, nofollow",
      seoTitle: torzs.metadata?.seo_title === "Teszt cim",
      seoDescription: torzs.metadata?.seo_description === "Teszt leiras",
      seoKeywords: torzs.metadata?.seo_keywords === "teszt, kulcsszo",
      unasProductUrl:
        torzs.metadata?.unas_product_url === "https://bolt.test/regi-lap",
      images:
        torzs.images?.[0]?.url === "https://kep/1.jpg" &&
        torzs.thumbnail === "https://kep/1.jpg",
      publication: torzs.status !== undefined,
      /**
       * ES A JELOLESNEK LATSZANIA IS KELL: a fixtura EGY, kombinacio nelkuli
       * sort ad, tehat pontosan egy bolti valtozat all elo, az alapertelmezett
       * opcioval. A `primarySku` sora ugyanezt a valtozatot meri, de a MASIK
       * mezojet -- itt a DARABSZAM az allitas.
       */
      variantRows: torzs.variants.length === 1,
    };
    const hianyzo = Object.entries(MEZO_SORSA)
      .filter(([mezo, sors]) => sors === "atmegy" && !megjelenik[mezo])
      .map(([mezo]) => mezo);
    assert.deepEqual(
      hianyzo,
      [],
      "a tablaban 'atmegy', a keresbol mégis hianyzik",
    );
  });
});

describe("MedusaProductProjectionService -- az indexelesi tiltas", () => {
  /**
   * KULON ALLITAS, NEM A "TOBBI MEZO" CSOMAGBAN -- acrobot kikotese, es a szam
   * indokolja: az 1893 termekbol MINDOSSZE KETTONEK van kezzel irt Meta
   * blokkja, es mindkettonel CSAK a `Robots` all benne. A tobbi 1891
   * automatikusan generalt, amit a bolt is tudna.
   *
   * Vagyis az at nem vitel itt nem veszteseg, hanem a TILTAS ELTUNESE.
   */
  it("a noindex tiltast atviszi a metadata mezobe", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(
      { ...product, seoRobots: "noindex, nofollow" },
      now,
    );
    assert.equal(f.createdWith[0]?.metadata?.seo_robots, "noindex, nofollow");
  });

  /**
   * A SZUKITES: tiltas nelkul a `metadata` mezo KI SEM KERUL a keresbe.
   *
   * Egy ures `metadata` felulirna, amit a bolt oldalan barki mas oda tett -- ez
   * ugyanaz a megkulonboztetes, mint a `handle`-nel: a hiany es az uresség ket
   * kulonbozo dolog.
   */
  it("ha SEMMI nem megy a metaadatba, a mezot ki sem kuldi", async () => {
    /**
     * A FELTETEL 2026-09-04-en BOVULT, es az allitas VELE EGYUTT -- nem lazult.
     *
     * Korabban eleg volt a `seoRobots: null`, mert csak az kerult a metaadatba.
     * Azota a KET LEIRAS is odamegy (kulon kulcson), tehat az uresség
     * feltetele HAROM mezo egyuttes hianya. A vedelem valtozatlan: egy URES
     * `metadata` felulirna, amit a bolt oldalan barki mas oda tett.
     */
    const f = fakes({ link: null, found: [] });
    await f.service.project(
      { ...product, seoRobots: null, description: null, descriptionLong: null },
      now,
    );
    assert.equal("metadata" in (f.createdWith[0] ?? {}), false);
  });

  /**
   * ES AZ UJ VISELKEDES ALLITASA, KULON: tiltas NELKUL is kimegy a metaadat, ha
   * van leiras. Enelkul a fenti allitas ugy is teljesulne, hogy a leirasok
   * SOSEM jutnak el a metaadatba -- vagyis a kirakat nem tudna ket slotot
   * tolteni, es a szukites elrejtené a hianyt.
   */
  it("tiltas nelkul is kimegy a metaadat, ha van leiras", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(
      {
        ...product,
        seoRobots: null,
        description: "<p>Rovid</p>",
        descriptionLong: "<p>Hosszu</p>",
      },
      now,
    );
    const torzs = f.createdWith[0];
    assert.equal(torzs?.metadata?.unas_short_description, "<p>Rovid</p>");
    assert.equal(torzs?.metadata?.unas_long_description, "<p>Hosszu</p>");
    assert.ok(!("seo_robots" in (torzs?.metadata ?? {})));
  });

  /**
   * A NEGY UJ MEZO KULON-KULON, ES NEM EGY TESZTBEN.
   *
   * Kulon, mert kulon ronthatok: mindegyik sajat felteteles agat kap a
   * metaadat-osszeallitasban. Egy tesztbe irva a kalibracio ugyanazt a nevet
   * adna vissza mindegyikre, tehat nem mondana meg, melyik ag romlott el.
   */
  /**
   * A MERTEKEGYSEG A "db" ESETEN IS KIMEGY, es ez DONTES, nem mulasztas.
   *
   * 1893 termekbol 1844-en a "db" all -- a szukites tehat kezenfekvo lenne. De
   * az egy BEEGETETT erteket tenne a kodba a MI katalogusunkrol, es az a
   * valosag elmozdulasakor csendben hazuggá valna: holnap lehet 1800, es a kod
   * ettol nem lesz pirosabb, csak hamisabb.
   *
   * Ezert all itt allitas KIFEJEZETTEN a "db" ertekre: enelkul egy kesobbi
   * "optimalizalas" eltavolithatna, es semmi nem szolna.
   */
  it("a db mertekegyseg is kimegy, nem csak a ritka egysegek", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project({ ...product, unit: "db" }, now);

    assert.equal(f.createdWith[0]?.metadata?.unas_unit, "db");
  });

  it("a masodlagos egyseg es a szorzo kulon kulcsot kap", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      { ...product, secondaryUnit: "karton", secondaryUnitFactor: "12" },
      now,
    );

    const metadata = f.createdWith[0]?.metadata ?? {};
    assert.equal(metadata.unas_secondary_unit, "karton");
    assert.equal(metadata.unas_secondary_unit_factor, "12");
  });

  /**
   * ES A HIANYZO MASODLAGOS EGYSEG KULCSA KI SEM MEGY. A mert adatban 1893-bol
   * 1874 termeknek NINCS masodlagos egysege, tehat ez az ag fut le szinte
   * mindenhol -- egy kikuldott ures ertek felulirna, amit a bolt oldalan barki
   * mas oda tett.
   */
  it("masodlagos egyseg nelkul a ket kulcs ki sem kerul", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      {
        ...product,
        unit: "db",
        secondaryUnit: null,
        secondaryUnitFactor: null,
      },
      now,
    );

    const metadata = f.createdWith[0]?.metadata ?? {};
    assert.equal(metadata.unas_unit, "db");
    assert.ok(!("unas_secondary_unit" in metadata));
    assert.ok(!("unas_secondary_unit_factor" in metadata));
  });

  /**
   * A RENDELESI KORLATOK. HAROM KULON ALLITAS, mert harom kulon sor viszi oket,
   * es egy ciklus EGY allitas lenne: elbukna, ha barmelyik hianyzik, de nem
   * mondana meg, MELYIK.
   *
   * A CEL-HELY MERT: a Medusa 2.19.0 termek- es variant-modelljen nincs
   * rendelesi korlat mezo, tehat metaadat, `unas_` elotaggal.
   */
  it("a minimalis rendelheto mennyiseg a metaadatba megy", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project({ ...product, minimumOrderQuantity: "2" }, now);

    assert.equal(f.createdWith[0]?.metadata?.unas_minimum_order_quantity, "2");
  });

  it("a maximalis rendelheto mennyiseg a metaadatba megy", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project({ ...product, maximumOrderQuantity: "50" }, now);

    assert.equal(f.createdWith[0]?.metadata?.unas_maximum_order_quantity, "50");
  });

  /**
   * A LEPESKOZ A HAROM KOZUL A LEGGYAKORIBB: merve a 09-03-as exporton, HUSZ
   * termeken all (a maximum heten), es a husz kozul tizenhat publikalt. Foleg
   * kimert, meroedenybol adagolt tetel -- ott csak a meroegyseg tobbszorose
   * rendelheto.
   */
  it("a rendelesi lepeskoz a metaadatba megy", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project({ ...product, orderQuantityStep: "5" }, now);

    assert.equal(f.createdWith[0]?.metadata?.unas_order_quantity_step, "5");
  });

  /**
   * ES KORLAT NELKUL A HAROM KULCS KI SEM KERUL. Ez nem szepitesi kerdes: a
   * metaadat CSERE-szemantikaju, tehat egy kikuldott ures ertek felulirna azt,
   * amit a bolt oldalan barki mas oda tett. A mert adatban a termekek
   * TULNYOMO tobbsegen nincs korlat, vagyis ez az ag fut le szinte mindenhol.
   */
  it("rendelesi korlat nelkul a harom kulcs ki sem kerul", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      {
        ...product,
        unit: "db",
        minimumOrderQuantity: null,
        maximumOrderQuantity: null,
        orderQuantityStep: null,
      },
      now,
    );

    const metadata = f.createdWith[0]?.metadata ?? {};
    assert.equal(metadata.unas_unit, "db");
    assert.ok(!("unas_minimum_order_quantity" in metadata));
    assert.ok(!("unas_maximum_order_quantity" in metadata));
    assert.ok(!("unas_order_quantity_step" in metadata));
  });

  it("a vonalkod a valtozat ean mezojebe kerul", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      { ...product, barcode: { field: "ean", value: "4006381333931" } },
      now,
    );

    assert.equal(f.createdWith[0]?.variants[0]?.ean, "4006381333931");
  });

  it("a 12 jegyu kod az upc mezobe kerul, nem az ean-be", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      { ...product, barcode: { field: "upc", value: "036000291452" } },
      now,
    );

    const valtozat = f.createdWith[0]?.variants[0];
    assert.equal(valtozat?.upc, "036000291452");
    assert.ok(!("ean" in (valtozat ?? {})));
  });

  /**
   * VONALKOD NELKUL A KULCS KI SEM MEGY. Egy ures `ean` kikuldese felulirna
   * azt, amit a bolt oldalan barki mas oda tett -- ugyanaz a szabaly, mint a
   * metaadatnal, es ugyanugy a kulcs JELENLETET merjuk, nem az erteket.
   */
  it("vonalkod nelkul sem ean, sem upc kulcs nem kerul a valtozatra", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project({ ...product, barcode: null }, now);

    const valtozat = f.createdWith[0]?.variants[0] ?? {};
    assert.ok(!("ean" in valtozat));
    assert.ok(!("upc" in valtozat));
  });

  it("a UNAS bolti cime a metaadatba megy, nem a handle-be", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      { ...product, unasProductUrl: "https://bolt.test/regi-lap" },
      now,
    );

    const torzs = f.createdWith[0];
    assert.equal(
      torzs?.metadata?.unas_product_url,
      "https://bolt.test/regi-lap",
    );
    // A handle ettol fuggetlen: a slugbol jon, es itt nincs slug.
    assert.ok(!("handle" in (torzs ?? {})));
  });

  it("a harom tovabbi SEO mezo kulon kulcsot kap a metaadatban", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      {
        ...product,
        seoTitle: "Cim",
        seoDescription: "Leiras",
        seoKeywords: "egy, ketto",
      },
      now,
    );

    const torzs = f.createdWith[0];
    assert.equal(torzs?.metadata?.seo_title, "Cim");
    assert.equal(torzs?.metadata?.seo_description, "Leiras");
    assert.equal(torzs?.metadata?.seo_keywords, "egy, ketto");
  });

  /**
   * ES AZ URES MEZO KULCSA KI SEM MEGY.
   *
   * Nem `null`-t kuldunk, hanem semmit: a `metadata` a cel oldalon
   * CSERE-szemantikaju, tehat egy kikuldott ures ertek felulirna azt, amit a
   * bolt oldalan barki mas oda tett. Ez az allitas azert kell, mert a harom uj
   * SEO mezo MA gyakorlatilag mindig ures (a UNAS-ban 1893-bol kettonek van
   * kezzel irt Meta blokkja), tehat ez az ag fut le szinte minden termeknel.
   */
  it("ures SEO mezonel a kulcs ki sem kerul a metaadatba", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      { ...product, seoRobots: "noindex", seoTitle: null, seoKeywords: null },
      now,
    );

    const metadata = f.createdWith[0]?.metadata ?? {};
    assert.equal(metadata.seo_robots, "noindex");
    assert.ok(!("seo_title" in metadata));
    assert.ok(!("seo_keywords" in metadata));
  });

  it("a frissitesnel is atviszi", async () => {
    const f = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_x" },
    });
    await f.service.project(
      { ...product, seoRobots: "noindex, nofollow" },
      now,
    );
    assert.equal(f.updatedWith[0]?.metadata?.seo_robots, "noindex, nofollow");
  });

  /**
   * AZ UPDATE-AG A LEIRASRA, es ez NEM ugyanaz, mint a fenti.
   *
   * A fenti allitas a `seo_robots` kulcsot meri, tehat csak azt mondja ki,
   * hogy a metaadat MINT MEZO kimegy a frissitesen. A leirasra eddig minden
   * allitasom a create-agon allt (`createdWith`), es a ketto NEM egy ut: a
   * `metadataPatch` mas feltetelbol keletkezik, es a `description` kulon mezo.
   *
   * Es epp ez az az ut, amin egy MAR ATVITT termek ujrafuttatasa megy: az elso
   * adag termekei a regi kod szerint mentek at, tehat a boltban ma a csonka
   * leiras all, es a javitasukhoz ugyanaz a `medusa:project` parancs fut le
   * ujra -- csak most a link mar megvan, tehat az UPDATE-ag visz mindent.
   * Enelkul az allitas nelkul a "ujrafuttathato" mondat kodolvasas, nem meres.
   */
  const updateWithBothDescriptions = async () => {
    const f = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_x" },
    });
    await f.service.project(
      {
        ...product,
        seoRobots: null,
        description: "<p>Rovid</p>",
        descriptionLong: "<p>Hosszu</p>",
      },
      now,
    );
    assert.equal(f.createdWith.length, 0, "meglevo linknel nem hozunk letre");
    const torzs = f.updatedWith[0];
    assert.ok(torzs, "az update nem futott le");
    return torzs;
  };

  /**
   * A MARKA GYUJTEMENYKENT MEGY AT, ES A HAROM ALLITAS KULON TESZT.
   *
   * Kulon, mert kulon ronthatok: a create-ag, az update-ag es a mezo
   * ELHAGYASA harom kulonbozo sor a szolgaltatasban. Egy tesztbe irva a
   * kalibracio kimenete mindharomra ugyanazt a nevet adna vissza, tehat nem
   * mondana meg, melyik ut romlott el.
   */
  it("a create-agon kimegy a marka gyujtemenye", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project({ ...product, medusaCollectionId: "pcol_9" }, now);

    assert.equal(f.createdWith[0]?.collection_id, "pcol_9");
  });

  it("az update-agon is kimegy a marka gyujtemenye", async () => {
    const f = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_x" },
    });

    await f.service.project({ ...product, medusaCollectionId: "pcol_9" }, now);

    assert.equal(f.updatedWith[0]?.collection_id, "pcol_9");
  });

  /**
   * ES A HARMADIK, AMI NEM ADODIK MAGATOL: marka nelkul a mezo EL SEM MEGY.
   *
   * Nem `null`-t kuldunk, hanem semmit. A ketto nem ugyanaz: a `null` LEVENNE
   * azt a gyujtemenyt, amit a bolt oldalan barki mas oda tett, es a hivas
   * sikerrel terne vissza. Egy `assert.equal(..., null)` alaku allitas ezt a
   * kulonbseget NEM latna, ezert a kulcs JELENLETET merjuk.
   */
  it("marka nelkul a gyujtemeny-mezo el sem megy a keresben", async () => {
    const f = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_x" },
    });

    await f.service.project({ ...product, medusaCollectionId: null }, now);

    assert.ok(!("collection_id" in (f.updatedWith[0] ?? {})));
  });

  it("az update-agon a FO mezoben ott van mindket leiras", async () => {
    const torzs = await updateWithBothDescriptions();

    // Az osszefuzott fo mezo az, ami keresheto a boltban.
    assert.ok((torzs.description ?? "").includes("Rovid"));
    assert.ok((torzs.description ?? "").includes("Hosszu"));
  });

  /**
   * KULON teszt, nem ugyanannak a masik fele: a `description` es a
   * `metadataPatch` KET kulon mezo, kulon feltetellel keletkeznek, es kulon
   * rontas donti pirosra oket. Egy tesztbe irva a kalibracio kimenete
   * ugyanazt a nevet adna mindket rontasra, tehat nem mondana meg, melyik ut
   * romlott el.
   */
  it("az update-agon a METAADAT is viszi kulon mindket leirast", async () => {
    const torzs = await updateWithBothDescriptions();

    assert.equal(torzs.metadata?.unas_short_description, "<p>Rovid</p>");
    assert.equal(torzs.metadata?.unas_long_description, "<p>Hosszu</p>");
  });
});

describe("MedusaProductProjectionService -- a bolti cim", () => {
  /**
   * EZ AZ ALLITAS A MEZO LETEZESENEK OKA.
   *
   * A vetites 2026-09-03-ig nem kuldott `handle`-t, tehat a Medusa a NEVBOL
   * szarmaztatta. Merve az 1893 termeken: a mai SefUrl-lel mindossze NEGY
   * egyezne beture, a tobbi 1809 UJ cimet kapna -- es a regi hivatkozasok
   * sehova nem vezetnenek.
   *
   * A CIM 2026-09-04 OTA KISBETUS, es ez nem szepites: a cel oldal KOVETELI.
   * Az elutasitott alak nem "csunyabb" cimet adna, hanem elbuktatna a termeket
   * -- merve, az 1813-bol 1799-et.
   */
  it("a bolti cimet kisbetusitve viszi at a letrehozasnal", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(
      { ...product, slug: "Aqua-Illumination-Prime-HD-LED-panel" },
      now,
    );
    assert.equal(
      f.createdWith[0]?.handle,
      "aqua-illumination-prime-hd-led-panel",
    );
  });

  /**
   * A PAR A KIMENETBEN IS OTT VAN, NEM CSAK A LEKEPEZESBEN.
   *
   * A tiszta fuggveny allitasa nem eleg: ez azt meri, hogy a vetites TOVABB IS
   * ADJA a part -- enelkul a lista sehol nem allna elo, es a hiba nema lenne
   * (a cim helyes, csak a regi elveszne).
   *
   * MI PIROSIT: ha a `cim` mezo kimarad a visszateresbol.
   */
  it("a regi-uj cim part a KIMENETBEN is atadja", async () => {
    const f = fakes({ link: null, found: [] });
    const outcome = await f.service.project(
      { ...product, slug: "Aqua-Illumination-Prime-HD-LED-panel" },
      now,
    );
    assert.equal(outcome.action, "created");
    assert.deepEqual(outcome.action === "created" ? outcome.cim : undefined, {
      regi: "Aqua-Illumination-Prime-HD-LED-panel",
      uj: "aqua-illumination-prime-hd-led-panel",
    });
  });

  it("a bolti cimet a frissitesnel is kisbetusitve viszi at", async () => {
    const f = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_x" },
    });
    await f.service.project(
      { ...product, slug: "Aqua-Illumination-Prime-HD-LED-panel" },
      now,
    );
    assert.equal(
      f.updatedWith[0]?.handle,
      "aqua-illumination-prime-hd-led-panel",
    );
  });

  /**
   * A SZUKITES ALLITASA: cim nelkul a mezo KI SEM KERUL a keresbe.
   *
   * Ez nem ugyanaz, mint egy ures ertek: az ures `handle` felulirna azt, amit
   * a Medusa korabban a nevbol szarmaztatott. A `handle in input` alak
   * szandekos -- egy `equal(undefined)` akkor is atmenne, ha a mezot URESEN
   * kikuldenenk.
   */
  it("cim nelkul a handle mezot ki sem kuldi", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project({ ...product, slug: null }, now);
    assert.equal("handle" in (f.createdWith[0] ?? {}), false);
  });

  /**
   * A VALODI ADAT ALAKJA: 107 SefUrl PERJELET tartalmaz a mertekegyseg miatt,
   * es a `handle` egyetlen URL-szegmens. Perjellel a cim kettevalna.
   */
  it("a mertekegyseg perjelet atalakitva viszi at", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(
      { ...product, slug: "Jebao-Sine-Wave-Pump-SLW-5-aramoltato-3000-l/h" },
      now,
    );
    assert.equal(
      f.createdWith[0]?.handle,
      "jebao-sine-wave-pump-slw-5-aramoltato-3000-l-h",
    );
  });
});

describe("MedusaProductProjectionService", () => {
  it("creates the product when nothing points at it yet", async () => {
    const { service, calls, linked } = fakes({ link: null, found: [] });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "created",
      cim: null,
      medusaProductId: "prod_uj",
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
    });
    assert.deepEqual(calls, [
      "findSalesChannel",
      "findLink",
      "search",
      "create",
      "link",
    ]);
    assert.deepEqual(linked, [
      { productId: "prod-os-1", medusaProductId: "prod_uj" },
    ]);
  });

  /**
   * A KÜLDÖTT ALAK, karakterre.
   *
   * Ez az állítás egy éles bukásból született: a Medusa 400-zal utasította el
   * a létrehozást, mert a változat `prices` mezője kötelező, és mi nem
   * küldtük. A hiba hangos volt, de a mező HIÁNYÁT semmi nem tartotta: a
   * hívás-sorrend zöld maradt, a kliens tesztje pedig a keresést méri.
   *
   * Az `prices: []` itt nem formaság, hanem a kör állítása: a mező azért van
   * ott, mert a cél oldal megköveteli, és azért ÜRES, mert nem viszünk át
   * árat. Ha valaki egyszer beleír egy összeget, ennek a sornak kell pirosra
   * váltania, nem egy éles futásnak.
   */
  it("sends the shape the create endpoint requires, with no price in it", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    await service.project(product, now);

    assert.equal(createdWith.length, 1);
    assert.deepEqual(createdWith[0], {
      title: "Reef Pump",
      description: "Leírás",
      /**
       * A METAADAT 2026-09-04 OTA ITT ALL, es ez a halo epp ezert letezik: a
       * ket UNAS-leiras KULON kulcson is atmegy, hogy a kirakat ket slotba
       * tudja tenni oket, ahogy a mai bolt teszi. A fixtura csak rovid
       * leirast ad, ezert csak az egyik kulcs all itt.
       */
      metadata: { unas_short_description: "Leírás" },
      external_id: "prod-os-1",
      /**
       * A publikációs mezők a LÉTREHOZÁSNÁL is mennek, és ez nem díszítés: a
       * telepített 2.19.0 validátora szerint a `status` alapértelmezése
       * `draft`, tehát a mező elhagyása nem semleges, hanem draftot jelent.
       */
      status: "published",
      sales_channels: [{ id: SALES_CHANNEL }],
      options: [{ title: "Kivitel", values: ["Alap"] }],
      variants: [
        {
          title: "Reef Pump",
          sku: "PUMP-1",
          options: { Kivitel: "Alap" },
          prices: [],
        },
      ],
    });
  });

  /**
   * A második futás NEM hoz létre semmit. Ez a kör első bizonyítása, és a
   * hívás-sorrend a bizonyíték: `create` nem szerepel benne.
   */
  it("updates instead of creating when the mapping is already there", async () => {
    const { service, calls } = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_megvan" },
    });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "updated",
      cim: null,
      medusaProductId: "prod_megvan",
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
    });
    assert.deepEqual(calls, ["findSalesChannel", "findLink", "update", "link"]);
    assert.ok(
      !calls.includes("create"),
      "meglévő leképezésnél nem hozunk létre",
    );
    assert.ok(!calls.includes("search"), "leképezéssel nem is kell keresni");
  });

  /**
   * A második bizonyítás: elveszett leképezés mellett a külső azonosító
   * megtalálja az ÉLŐ terméket, és abból áll helyre a leképezés. Egy
   * megvalósítás, ami itt létrehoz, minden elveszett leképezésnél új terméket
   * szülne - és pontosan ezt kellett kizárni.
   */
  it("recovers the mapping from a live match instead of creating a second product", async () => {
    const { service, calls, linked } = fakes({
      link: null,
      found: [{ id: "prod_elo", deleted_at: null }],
    });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "relinked",
      cim: null,
      medusaProductId: "prod_elo",
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
    });
    assert.ok(!calls.includes("create"));
    assert.deepEqual(linked, [
      { productId: "prod-os-1", medusaProductId: "prod_elo" },
    ]);
  });

  /**
   * Egy TÖRÖLT és egy ÉLŐ sor ugyanazzal az azonosítóval hétköznapi állapot,
   * NEM hiba: pont az áll elő, ha valamit törölnek és az azonosító újra
   * bekerül. Az élő számít; a törölt történelem. Ez az az eset, amit nyers
   * sorokat számolva tévesen hibának néznénk.
   */
  it("treats a deleted row beside a live one as history, not as ambiguity", async () => {
    const { service } = fakes({
      link: null,
      found: [
        { id: "prod_regi", deleted_at: "2026-08-01T00:00:00.000Z" },
        { id: "prod_elo", deleted_at: null },
      ],
    });

    assert.deepEqual(await service.project(product, now), {
      action: "relinked",
      cim: null,
      medusaProductId: "prod_elo",
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
    });
  });

  /**
   * Két ÉLŐ találat: nem választunk közülük. A Medusa nem garantálja a külső
   * azonosító egyediségét (nincs rajta index), tehát ez előfordulhat, és a
   * helyes válasz a megállás - mindkettőt néven nevezve, mert egy szám nem
   * mondja meg, melyikről van szó.
   */
  it("stops on two live matches, and names both", async () => {
    const { service, calls } = fakes({
      link: null,
      found: [
        { id: "prod_egy", deleted_at: null },
        { id: "prod_ketto", deleted_at: null },
      ],
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "ambiguous",
    );
    assert.match(
      outcome.action === "stopped" ? outcome.details : "",
      /prod_egy.*prod_ketto/,
    );
    assert.ok(!calls.includes("create"));
    assert.ok(!calls.includes("link"), "ütközésnél leképezést sem írunk");
  });

  /**
   * Csak törölt találat: MEGSZAKADT AZONOSSÁGI LÁNC, Balázs döntése szerint
   * megállás és jelentés.
   *
   * A jelentés tartalmát is állítjuk, nem csak a tényt: egy „identity
   * conflict" önmagában nem mondja meg, MELYIK terméket kell megnézni. Benne
   * kell lennie az OS-termék azonosítójának és a törölt Medusa-sornak.
   *
   * A mai stage-adaton ez az ág NEM érhető el (nulla puhán törölt termék),
   * tehát ez a teszt szándékosan konstruált állapotot vizsgál.
   */
  it("stops when the external id only sits on deleted products", async () => {
    const { service, calls } = fakes({
      link: null,
      found: [{ id: "prod_torolt", deleted_at: "2026-08-01T00:00:00.000Z" }],
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "broken-identity-chain",
    );
    const details = outcome.action === "stopped" ? outcome.details : "";
    assert.match(
      details,
      /prod-os-1/,
      "az OS-termék azonosítója szerepeljen benne",
    );
    assert.match(
      details,
      /prod_torolt/,
      "a törölt Medusa-sor is szerepeljen benne",
    );
    assert.match(details, /TÖRÖLT/, "mondja ki, hogy a találat törölt");
    assert.ok(
      !calls.includes("create"),
      "törölt találat mellé nem hozunk létre",
    );
    assert.ok(
      !calls.includes("link"),
      "megszakadt láncnál leképezést sem írunk",
    );
  });

  /**
   * Csonkolt válaszon nem döntünk. A lista nem rendez, tehát egy kimerített
   * limit tetszőleges részhalmazt ad, és abból az élők száma bármi lehet: két
   * élő és egy törölt találatból visszajöhetne egy élő meg egy törölt, amiből
   * a szolgáltatás azt olvasná ki, hogy pontosan egy élő van, és rákötné a
   * leképezést a rossz termékre.
   */
  it("refuses to decide on a truncated lookup", async () => {
    const { service, calls } = fakes({
      link: null,
      found: [{ id: "prod_elo", deleted_at: null }],
      truncated: true,
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "lookup-truncated",
    );
    assert.ok(!calls.includes("create"));
    assert.ok(
      !calls.includes("link"),
      "csonkolt halmaznál leképezést sem írunk",
    );
  });

  it("stops on a product with no sku instead of inventing one", async () => {
    const { service, calls } = fakes({ link: null, found: [] });

    const outcome = await service.project(
      {
        ...product,
        primarySku: null,
        /**
         * A VALÓSÁGOS eset: cikkszám akkor hiányzik, ha nincs aktív változat.
         * A `sku` oszlop nem nullázható, tehát a másik kombináció (aktív
         * változat, cikkszám nélkül) csak hívó-hibából állhat elő - annak
         * saját tesztje van.
         */
        publication: { ...product.publication, activeVariantCount: 0 },
      },
      now,
    );

    assert.equal(outcome.action, "stopped");
    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "no-sku");
    assert.deepEqual(calls, [], "cikkszám nélkül semmit nem kérdezünk odaát");

    /**
     * AZ ÜZENET NEM ÁLLÍTHAT TÖBBET, MINT AMIT A SZOLGÁLTATÁS TUD.
     *
     * Régen azt írta, hogy „a terméknek nincs cikkszáma". Ezt innen nem lehet
     * tudni: a `sku` oszlop nem nullázható, tehát a terméknek LEHET cikkszáma,
     * csak nem olyan változaton, amit a hívó átvinne. A pontos okot az tudja,
     * aki a lekérdezést futtatta - lásd `describeNoProjectableSku`.
     */
    assert.ok(
      !/nincs cikkszáma$/.test(outcome.details),
      "ilyen állapot az adatmodell szerint elő sem állhat: a sku oszlop nem nullázható",
    );
    assert.match(outcome.details, /nincs AKTÍV változata/);
    assert.match(outcome.details, /változat aktiválása/);
  });
});

describe("a hiányzó cikkszám MELYIK esete", () => {
  /**
   * A KÉT ESET KÜLÖN, mert a teendő is más.
   *
   * A cikkszám oszlop nem nullázható, tehát a hiányzó elsődleges cikkszám nem
   * jelenthet cikkszám-hiányt. Vagy nincs aktív változat (a termék állapota),
   * vagy a hívó ellentmondó bemenetet adott (a hívó hibája). A régi, egyetlen
   * mondat mindkettőt „a terméknek nincs cikkszáma" néven fedte, és egyik
   * esetben sem mutatott a teendőre.
   */
  it("nincs aktív változat: a termék állapotát nevezi meg", async () => {
    const { service } = fakes({});
    const outcome = await service.project(
      {
        ...product,
        primarySku: null,
        publication: { ...product.publication, activeVariantCount: 0 },
      },
      now,
    );

    assert.ok(outcome.action === "stopped");
    assert.match(outcome.details, /nincs AKTÍV változata/);
    assert.match(outcome.details, /NEM cikkszám-hiány/);
  });

  it("van aktív változat, de nincs cikkszám: a HÍVÓT nevezi meg", async () => {
    const { service } = fakes({});
    const outcome = await service.project(
      {
        ...product,
        primarySku: null,
        publication: { ...product.publication, activeVariantCount: 2 },
      },
      now,
    );

    assert.ok(outcome.action === "stopped");
    assert.match(outcome.details, /ellentmondó bemenet/);
    assert.match(outcome.details, /2 aktív/);
    assert.ok(
      !outcome.details.includes("nincs AKTÍV változata"),
      "ez nem a termék állapota, és a mondat sem állíthatja annak",
    );
  });
});

describe("a publikáció és a csatorna a vetítésben", () => {
  const sellableProduct = (
    overrides: Partial<ProjectableProduct["publication"]> = {},
  ): ProjectableProduct => ({
    ...product,
    publication: { ...product.publication, ...overrides },
  });

  it("értékesíthető terméket published állapotban és a csatornához kötve hoz létre", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    const outcome = await service.project(sellableProduct(), now);

    assert.equal(outcome.action, "created");
    assert.equal(createdWith.at(-1)?.status, "published");
    assert.deepEqual(createdWith.at(-1)?.sales_channels, [
      { id: SALES_CHANNEL },
    ]);
  });

  /**
   * EZ AZ A MERCE, AMI MA NEMA LENNE.
   *
   * A gazda-feltetel 2026-09-02-ig UNAS terméknel `draft` allapotot es URES
   * csatorna-listat adott. Az atallas utan a termek ugyanugy publikalt --
   * es a kulonbseg egy ZOLD FUTASBOL NEM LATSZANA, mert a vetites mindket
   * esetben "created" eredmenyt jelent. A hiba nem hibauzenetben all elo,
   * hanem abban, hogy a boltban semmi nem latszik.
   *
   * A tulajdonos dontese (Balazs, 2026-09-02 17:54): "Ami az unasban van az
   * kell a medusaba is."
   */
  it("UNAS gazdájú terméket is published állapotban és a csatornához kötve hoz létre", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    const outcome = await service.project(
      sellableProduct({ catalogAuthority: "UNAS" }),
      now,
    );

    assert.equal(outcome.action, "created");
    assert.equal(createdWith.at(-1)?.status, "published");
    assert.deepEqual(createdWith.at(-1)?.sales_channels, [
      { id: SALES_CHANNEL },
    ]);
  });

  /**
   * A LEKEPEZETT AZONOSITOK ATMENNEK, es mind a KET iranyban: a letrehozas es a
   * frissites ugyanabbol a szamitasbol dolgozik.
   */
  it("a leképezett kategóriákat átadja a létrehozásban", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    await service.project(
      { ...sellableProduct(), medusaCategoryIds: ["pcat_1", "pcat_2"] },
      now,
    );

    assert.deepEqual(createdWith.at(-1)?.categories, [
      { id: "pcat_1" },
      { id: "pcat_2" },
    ]);
  });

  it("a leképezett kategóriákat átadja a frissítésben is", async () => {
    const { service, updatedWith } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await service.project(
      { ...sellableProduct(), medusaCategoryIds: ["pcat_1"] },
      now,
    );

    assert.deepEqual(updatedWith.at(-1)?.categories, [{ id: "pcat_1" }]);
  });

  /**
   * EZ AZ AZ ALLITAS, AMI EGY CSENDES TORLEST ELOZ MEG.
   *
   * A mezo ELHAGYASA es az URES TOMB nem ugyanaz. A `sales_channels`-rol a
   * telepitett 2.19.0 forrasabol MERTUK, hogy csere-szemantikaju: ott az ures
   * lista a lekotes. A `categories`-ra ugyanez nincs elesben megmerve -- a
   * termek-frissites csere-listaja nem tartalmazza --, es amig nincs, a
   * szigorubb olvasat szerint jarunk el.
   *
   * Ha ez az allitas kiesne, es a mezo csere-szemantikaju lenne, egy vetites
   * LEVENNE a termekrol a kategoriait. Nem hibauzenettel: a hivas sikerrel
   * terne vissza, es a kirakatban esnenek ki a termekek a kategoriaikbol.
   */
  it("leképezés nélkül a kérés törzsében NINCS categories kulcs", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    await service.project(
      { ...sellableProduct(), medusaCategoryIds: null },
      now,
    );

    const torzs = createdWith.at(-1)!;
    assert.ok(
      !("categories" in torzs),
      "üres tömb helyett a mezőnek EL kell maradnia",
    );
  });

  /** Ugyanez ures listara: az sem lehet ures tomb a torzsben. */
  it("üres listából sem lesz üres tömb", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    await service.project({ ...sellableProduct(), medusaCategoryIds: [] }, now);

    assert.ok(!("categories" in createdWith.at(-1)!));
  });

  it("nem értékesíthető terméknél draft ÉS üres csatorna-lista megy egy kérésben", async () => {
    /**
     * Az üres lista a LEKÖTÉS: a telepített 2.19.0 frissítő folyamata a
     * mezőt cseréként kezeli, tehát a meglévő linkeket törli és a kapott
     * (üres) listát hozza létre.
     */
    const { service, updatedWith } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await service.project(sellableProduct({ webshopSellable: false }), now);

    assert.equal(updatedWith.at(-1)?.status, "draft");
    assert.deepEqual(updatedWith.at(-1)?.sales_channels, []);
  });

  it("a második futás ugyanazt küldi, mint az első", async () => {
    // A brief 5. tesztje: nincs duplikált csatorna-kapcsolat. A cél oldali
    // csere-szemantika miatt ez abból következik, hogy ugyanazt küldjük.
    const first = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });
    await first.service.project(sellableProduct(), now);
    await first.service.project(sellableProduct(), now);

    assert.equal(first.updatedWith.length, 2);
    assert.deepEqual(first.updatedWith[0], first.updatedWith[1]);
  });

  it("a jelentés megmondja, mit állított be és miért", async () => {
    // A brief 11. tesztje. Egy "kész" sor önmagában nem mondja meg, mi lett
    // a termékkel.
    const { service } = fakes({ link: null, found: [] });

    const outcome = await service.project(
      sellableProduct({ isActive: false }),
      now,
    );

    assert.equal(outcome.action, "created");
    if (outcome.action !== "created") return;
    assert.equal(outcome.publication.status, "draft");
    assert.equal(outcome.publication.salesChannel, "detach");
    assert.equal(outcome.publication.reason, "a termék inaktív");
  });

  it("HANGOSAN megáll, ha a csatorna azonosítója nincs beállítva", async () => {
    /**
     * A legfontosabb teszt ebben a csoportban, és nem a leglátványosabb.
     *
     * A csendes alternatívák mindegyike rosszabb: a mező elhagyása félkész
     * állapotot hagyna (a status átáll, a link marad), az üres lista pedig
     * lekötésnek látszana, amit utólag senki nem tud megkülönböztetni egy
     * szándékos döntéstől. Ezért NEM küldünk semmit.
     */
    const { links, medusa, calls } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });
    const service = new MedusaProductProjectionService(links, medusa, null);

    const outcome = await service.project(sellableProduct(), now);

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "sales-channel-not-configured");
    assert.equal(calls.length, 0, "egyetlen hívás sem mehetett ki");
  });
  it("HANGOSAN megáll, ha a beállított csatorna NEM LÉTEZIK a cél oldalon", async () => {
    /**
     * Ez az az eset, amit egy környezetből a másikba átörökölt beállítás
     * okoz: a stage azonosítója az élesen nem létezik. Az ELSŐ használatkor
     * derül ki, egyszer - és ez a legkorábbi pillanat, amikor egyáltalán
     * kiderülhet. Egy termék, ami nem jelenik meg a boltban, sokkal később és
     * sokkal drágábban mondaná el ugyanezt.
     */
    const { service, calls } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
      channelMissing: true,
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "sales-channel-not-found");
    assert.deepEqual(
      calls,
      ["findSalesChannel"],
      "a lekérdezésen kívül semmi nem mehetett ki",
    );
  });

  it("a csatornát EGYSZER kérdezi le, akárhány terméknél", async () => {
    // Az azonosító nem változik futás közben. Egy hívás terméknként olyan
    // költség lenne, amiért cserébe semmit nem tudnánk meg.
    const { service, calls } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await service.project(product, now);
    await service.project(product, now);

    assert.equal(calls.filter((call) => call === "findSalesChannel").length, 1);
  });
});

/**
 * A KEPEK: A SORREND, A FO KEP, ES AZ, AMI NEM MEHET KI.
 *
 * A negy allitasbol KETTO a szukitest meri, nem a mukodest -- es ez szandekos.
 * Egy keszlet, ami csak azt nezi, hogy a kepek atmennek, ugyanolyan zold lenne
 * akkor is, ha a vetites URES listat kuldene: az is "atvinne" a kepeket.
 */
describe("MedusaProductProjectionService -- a termek kepei", () => {
  it("a lista sorrendben megy, es a fo kep az ELSO elem", async () => {
    const f = fakes({ link: null, found: [] });

    await f.service.project(
      { ...product, images: ["https://kep/a.jpg", "https://kep/b.jpg"] },
      now,
    );

    const torzs = f.createdWith[0];
    assert.ok(torzs, "a create nem futott le");
    assert.deepEqual(torzs.images, [
      { url: "https://kep/a.jpg" },
      { url: "https://kep/b.jpg" },
    ]);
    assert.equal(torzs.thumbnail, "https://kep/a.jpg");
  });

  /**
   * AZ UPDATE-AG KULON ALLITAS, ES NEM ISMETLES.
   *
   * A cel oldalon a ket ag MASKEPP viselkedik: a create-nel a hianyzo
   * thumbnail visszaesik az elso kep URL-jere, az update-nel NEM -- ott a regi
   * ertek maradna benne. Ha csak a create-et mernenk, egy elfelejtett
   * thumbnail az update-agon csendben menne at.
   */
  it("az update-agon IS kimegy a fo kep, nem csak a lista", async () => {
    const f = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await f.service.project(
      { ...product, images: ["https://kep/uj-fokep.jpg", "https://kep/b.jpg"] },
      now,
    );

    const torzs = f.updatedWith[0];
    assert.ok(torzs, "az update nem futott le");
    assert.equal(torzs.thumbnail, "https://kep/uj-fokep.jpg");
    assert.equal(torzs.images?.length, 2);
  });

  /**
   * ES A KET ALLITAS, AMI A NEMA KART MERI.
   *
   * Az `images` a cel oldalon csere-szemantikaju: egy ures lista LETOROLNE a
   * termek meglevo kepeit, es a hivas sikerrel terne vissza. A "nincs kepunk"
   * es a "torold a kepeket" tehat ket kulonbozo szandek, amit ugyanaz a
   * kimenet kepvisel -- ezert kell nev szerinti allitas arra, hogy a mezo KI
   * SEM KERUL.
   */
  it("ha nincs kep-lista, sem a lista, sem a fo kep NEM kerul a torzsbe", async () => {
    const f = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await f.service.project({ ...product, images: null }, now);

    const torzs = f.updatedWith[0];
    assert.ok(torzs, "az update nem futott le");
    assert.ok(!("images" in torzs), "ures kep-lista ment ki");
    assert.ok(!("thumbnail" in torzs), "fo kep ment ki lista nelkul");
  });

  it("az URES lista ugyanugy nem kerul ki, mint a hianyzo", async () => {
    const f = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await f.service.project({ ...product, images: [] }, now);

    const torzs = f.updatedWith[0];
    assert.ok(torzs, "az update nem futott le");
    assert.ok(!("images" in torzs), "ures tomb ment ki, ez torolne a kepeket");
    assert.ok(!("thumbnail" in torzs), "fo kep ment ki kepek nelkul");
  });
});

/**
 * A TOBB VALTOZAT ATVITELE: A FORRAS TENGELYE, ES EGY BOLTI SOR SORONKENT.
 *
 * A csomag harom allitasa harom KULON dolgot mer, es ezt a kalibracio
 * igazolta: az opcio-blokk nevet, a valtozatok szamat, es a vonalkod
 * elhagyasat. Ha egy allitas mind a harmat merne, egy reszleges rontas is
 * pirosat adna, es nem tudnank, mi romlott el.
 */
describe("MedusaProductProjectionService -- tobb valtozat", () => {
  const ketValtozat = {
    ...product,
    barcode: { field: "ean" as const, value: "4006381333931" },
    variantRows: [
      {
        sku: "RF-BLUEM-1",
        unasVariantValues: [{ name: "Szin", value: "Fekete" }],
      },
      {
        sku: "RF-BLUEM-2",
        unasVariantValues: [{ name: "Szin", value: "Feher" }],
      },
    ],
  };

  it("az opcio-blokk a FORRAS tengelyet viseli, nem az alapertelmezest", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(ketValtozat, now);

    const torzs = f.createdWith[0];
    assert.ok(torzs, "a create nem futott le");
    assert.deepEqual(torzs.options, [
      { title: "Szin", values: ["Fekete", "Feher"] },
    ]);
  });

  it("minden sorbol egy bolti valtozat lesz, sajat cikkszammal", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(ketValtozat, now);

    const torzs = f.createdWith[0];
    assert.ok(torzs, "a create nem futott le");
    assert.deepEqual(
      torzs.variants.map((valtozat) => ({
        sku: valtozat.sku,
        title: valtozat.title,
        options: valtozat.options,
      })),
      [
        {
          sku: "RF-BLUEM-1",
          title: "Fekete",
          options: { Szin: "Fekete" },
        },
        {
          sku: "RF-BLUEM-2",
          title: "Feher",
          options: { Szin: "Feher" },
        },
      ],
    );
  });

  /**
   * ES A VONALKOD NEM MEGY KI, HOLOTT A BEMENETBEN OTT ALL.
   *
   * A Medusa mind a harom vonalkod-mezore EGYEDI indexet tart, a mi
   * szinkronunk pedig UGYANAZT a `manufacturerPartNumber` erteket irja egy
   * termek MINDEN valtozat-soraba. Ket valtozatra ugyanaz a kod = a
   * letrehozas elhasal.
   *
   * ES NEM AZ ELSORE TESSZUK: az azt allitana, hogy epp ANNAK a valtozatnak ez
   * az EAN kodja. A hianyzo mezo lathato, egy rossz valtozathoz rendelt
   * vonalkod nem.
   */
  it("tobb valtozatnal a vonalkod EGYIKRE SEM kerul ki", async () => {
    const f = fakes({ link: null, found: [] });
    await f.service.project(ketValtozat, now);

    const torzs = f.createdWith[0];
    assert.ok(torzs, "a create nem futott le");
    assert.deepEqual(
      torzs.variants.filter((valtozat) => valtozat.ean || valtozat.upc),
      [],
    );
  });

  /**
   * ES EGY MEGALLAS, AMI AZELOTT ALL MEG, HOGY BARMIT IRTUNK VOLNA.
   *
   * Nem eleg, hogy a lekepezes elutasit: a vetitesnek MEG KELL ALLNIA, es a
   * `create` nem futhat le. Egy felig letrehozott termek rosszabb, mint egy
   * meg nem letezo.
   */
  it("ellentmondo tengelyeknel megall, es NEM ir semmit", async () => {
    const f = fakes({ link: null, found: [] });
    const kimenet = await f.service.project(
      {
        ...ketValtozat,
        variantRows: [
          {
            sku: "X-1",
            unasVariantValues: [{ name: "Szin", value: "Fekete" }],
          },
          { sku: "X-2", unasVariantValues: [{ name: "Meret", value: "L" }] },
        ],
      },
      now,
    );

    assert.equal(kimenet.action, "stopped");
    if (kimenet.action !== "stopped") return;
    assert.equal(kimenet.reason, "variant-axes-inconsistent");
    assert.deepEqual(f.createdWith, []);
  });
});

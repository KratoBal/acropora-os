import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  decidePublication,
  type ProductPublicationState,
} from "./medusa-publication.policy.js";

const state = (
  overrides: Partial<ProductPublicationState> = {},
): ProductPublicationState => ({
  catalogAuthority: "ACROPORA",
  isActive: true,
  webshopSellable: true,
  activeVariantCount: 1,
  ...overrides,
});

describe("a publikációs döntés", () => {
  it("aktív + webshopra jelölt ACROPORA termék: értékesíthető", () => {
    // A brief 1. falszifikálható tesztje.
    assert.deepEqual(decidePublication(state()), {
      sellable: true,
      reason: "sellable",
      status: "published",
      salesChannel: "attach",
    });
  });

  it("webshopra NEM jelölt termék: nem értékesíthető", () => {
    /**
     * A brief 2. tesztje, és ez az EGYETLEN, ami az új mezőt őrzi. Ha valaki
     * kiveszi a `webshopSellable` vizsgálatát a szabályból, minden más teszt
     * zöld marad, és ez pirosodik ki.
     */
    const decision = decidePublication(state({ webshopSellable: false }));

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "not-webshop-sellable");
    assert.equal(decision.status, "draft");
    assert.equal(decision.salesChannel, "detach");
  });

  it("inaktív termék: nem értékesíthető, akkor sem, ha webshopra jelölt", () => {
    // A brief 3. tesztje. A jelölés ATTÓL még igaz marad, hogy a termék
    // inaktív - a kettő két külön állítás, és a sorrend dönt.
    const decision = decidePublication(
      state({ isActive: false, webshopSellable: true }),
    );

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "product-inactive");
  });

  /**
   * A REGI SZABALY ITT ALLT: a nem-ACROPORA gazda onmagaban elutasitas volt, a
   * `null` es az `UNAS` egyformán. Ma NEM az.
   *
   * A tulajdonos dontese (Balazs, 2026-09-02 17:54, Discord): "Nem kell
   * kapcsolo. Ami az unasban van az kell a medusaba is. Akar regi akar ujonnan
   * rogzitett lesz". A gazda tehat nem szur tobbe -- a masik harom feltetel
   * viszont valtozatlanul all.
   */
  it("UNAS gazda: ugyanúgy értékesíthető, ha a többi feltétel áll", () => {
    const decision = decidePublication(state({ catalogAuthority: "UNAS" }));

    assert.equal(decision.sellable, true);
    assert.equal(decision.reason, "sellable");
    assert.equal(decision.status, "published");
    assert.equal(decision.salesChannel, "attach");
  });

  /**
   * A `null` VISZONT MARAD FAIL-CLOSED, es ez nem a regi szabaly maradeka.
   *
   * A sema szerint a gazdanak ket ismert erteke van (UNAS, ACROPORA); a `null`
   * egyik sem, tehat nem tudjuk, honnan jott a termek. Egy ismeretlen gazdaju
   * termeket kiengedni CSENDES tevedes -- megjelenik a boltban, es senki nem
   * keresi. Visszatartani HANGOS: valaki szol, hogy hianyzik.
   */
  it("ismeretlen gazda: fail-closed marad", () => {
    const decision = decidePublication(state({ catalogAuthority: null }));

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "unknown-authority");
    assert.equal(decision.status, "draft");
    assert.equal(decision.salesChannel, "detach");
  });

  it("nincs aktív változat: nem értékesíthető", () => {
    /**
     * Ma NINCS ilyen termék: Balázs mérése szerint nulla aktív termék áll
     * nulla aktív változattal. A szabály ettől még kimondja, mert a mérés a
     * MAI állapotról szól, a szabály pedig a holnapiról is.
     */
    const decision = decidePublication(state({ activeVariantCount: 0 }));

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "no-active-variant");
  });

  it("a LEGKORÁBBI akadályt nevezi meg, nem a legutolsót", () => {
    /**
     * Ha egyszerre több feltétel sérül, az indoklás azt mondja meg, ami a
     * sorban elöl áll. Enélkül egy inaktív, nem jelölt termékről azt írnánk,
     * hogy "nincs webshopra jelölve", és valaki bejelölné - mire kiderülne,
     * hogy attól még inaktív.
     */
    const decision = decidePublication(
      state({ isActive: false, webshopSellable: false, activeVariantCount: 0 }),
    );

    assert.equal(decision.reason, "product-inactive");
  });

  it("a két kapu EGYÜTT mozog, mindig", () => {
    /**
     * A brief 6. pontja: a status és a sales channel szándékosan együtt jár.
     * Ez a teszt azt őrzi, hogy soha ne keletkezzen olyan döntés, ami
     * `published` ÉS `detach`, vagy `draft` ÉS `attach` - mert a storefront a
     * kettő metszetét nézi, és egy félig elvégzett váltás pont úgy néz ki,
     * mint egy sikeres.
     */
    const combinations: ProductPublicationState[] = [
      state(),
      state({ webshopSellable: false }),
      state({ isActive: false }),
      state({ activeVariantCount: 0 }),
      state({ catalogAuthority: "UNAS" }),
      state({ catalogAuthority: null }),
    ];

    for (const input of combinations) {
      const decision = decidePublication(input);

      assert.equal(
        decision.status === "published",
        decision.salesChannel === "attach",
        JSON.stringify(input),
      );
      assert.equal(decision.sellable, decision.status === "published");
    }
  });

  it("ugyanarra a bemenetre ugyanazt adja, akárhányszor", () => {
    // Az idempotencia ALAPJA: a döntés nem függ semmi külsőtől, tehát a
    // második vetítés ugyanazt az állapotot kéri, mint az első.
    const input = state();

    assert.deepEqual(decidePublication(input), decidePublication(input));
  });
});

/**
 * A NEM-TERMEK SOROK NEVESITVE ALLNAK MEG (f39fdef4).
 *
 * === A MAI MERES, A DATUMAVAL -- EZ MONDJA MEG, MIERT NEM ELEG A MEGLEVO AG ===
 *
 * Staging adatbazis, 2026-09-21: mind a ket sor BEJUT hozzank, es AKTIV
 * (`isActive = true` a termeken ES a valtozaton). Ami ma visszatartja oket,
 * az KIZAROLAG a `webshopSellable = false`.
 *
 * ES AZ A VEDELEM VELETLEN: a `webshopSellable` nem azert hamis, mert ezek nem
 * termekek, hanem mert a UNAS-ban a statuszuk 0 (nincsenek kint a boltban). Ha
 * valaki elo allapotba teszi barmelyiket, a mai vedelem AZONNAL megszunik.
 *
 * A nyers UNAS exportbol (2026-09-02): a `discount-amount` a bolt sajat
 * kedvezmeny-tetele (1 Ft), az `Alap_Hal` sablon-rekord uj halak felvitelehez
 * (1,27 Ft).
 */
describe("a nem-termék sorok nem mennek ki", () => {
  const valodiTermek = {
    catalogAuthority: "UNAS",
    isActive: true,
    webshopSellable: true,
    activeVariantCount: 1,
  };

  /*
    ISMERT POZITIV KONTROLL ELOSZOR: egy VALODI termek atmegy. Enelkul a lenti
    ket tagadas egy olyan kapun is zold lenne, ami MINDENT kizar -- es akkor a
    bolt uresen maradna.
  */
  it("egy valódi termék továbbra is kimegy", () => {
    const d = decidePublication({
      ...valodiTermek,
      variantSkus: ["AQ-1234"],
    });
    assert.equal(d.sellable, true);
    assert.equal(d.reason, "sellable");
  });

  it("a kedvezmény-tétel SAJÁT okkal áll meg", () => {
    const d = decidePublication({
      ...valodiTermek,
      variantSkus: ["discount-amount"],
    });
    assert.equal(d.sellable, false);
    /*
      AZ OK NEVE A LENYEG, NEM A TAGADAS. A `not-webshop-sellable` azt
      allitana, hogy barmikor kimehetne, csak most nincs bejelolve -- egy
      kedvezmeny-tetelnel ez hamis.
    */
    assert.equal(d.reason, "not-a-product");
  });

  it("a sablon-rekord SAJÁT okkal áll meg", () => {
    const d = decidePublication({
      ...valodiTermek,
      variantSkus: ["Alap_Hal"],
    });
    assert.equal(d.reason, "not-a-product");
  });

  /**
   * ES A MAI VEDELEM NELKUL IS MEGALL -- EZ AZ ALLITAS MERI A KARTYA LENYEGET.
   *
   * A `webshopSellable: true` epp azt az allapotot allitja elo, ami akkor
   * keletkezne, ha valaki a UNAS-ban elo allapotba tenne a tetelt. Ma ez az
   * eset nem all fenn; a kapu viszont ettol fuggetlenul szol.
   *
   * A fenti harom allitas mind `webshopSellable: true` mellett fut, tehat ez
   * NEM kulon eset -- itt csak KIMONDOM, hogy miert igy vannak megirva.
   */
  it("a nem-termék akkor is megáll, ha webshopra jelölnék", () => {
    const d = decidePublication({
      catalogAuthority: "UNAS",
      isActive: true,
      webshopSellable: true,
      activeVariantCount: 1,
      variantSkus: ["Alap_Hal"],
    });
    assert.equal(d.reason, "not-a-product");
  });

  /*
    A CIKKSZAM-LISTA ELHAGYHATO, es a regi hivok viselkedese VALTOZATLAN.
    Enelkul egy hianyzo mezo csendben MINDENT atengedne vagy mindent kizarna --
    es a meglevo hivohelyek egyike sem szolna rola.
  */
  it("cikkszámok nélkül a döntés változatlan", () => {
    const d = decidePublication(valodiTermek);
    assert.equal(d.sellable, true);
  });
});

/**
 * ES A BEKOTES, MERT A SZABALY ONMAGABAN NEM VED SEMMIT.
 *
 * A `variantSkus` mezo ELHAGYHATO -- ez szandekos, hogy a regi hivok
 * valtozatlanok maradjanak. De epp ezert: ha a futtato nem adja at, a kapu
 * SOHA nem sul el, es a fenti ot allitas VALTOZATLANUL ZOLD marad.
 *
 * Ez a szakadas alakja: a kepesseg megvan, es senki nem hivja. Egy tiszta
 * fuggveny tesztje ezt szerkezetileg nem tudja megfogni -- ezert olvas ez az
 * allitas FORRAST.
 */
describe("a nem-termék kapu be van kötve a futtatóba", () => {
  it("a futtató átadja a változatok cikkszámait", () => {
    const forras = readFileSync(
      join(
        new URL("../../../", import.meta.url).pathname,
        "src",
        "integrations",
        "medusa",
        "medusa-projection.runner.ts",
      ),
      "utf8",
    );

    // ISMERT POZITIV KONTROLL: a fajlt tenyleg beolvastuk. Rossz utvonalnal
    // ures szovegen a lenti allitas is elbukna, de a hibauzenet mast mondana.
    assert.ok(forras.length > 5000, "gyanúsan rövid futtató-forrás");

    const kod = forras
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

    assert.match(kod, /variantSkus:\s*product\.variants\.map\(/);
  });
});

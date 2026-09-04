import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  describePriceSource,
  isSaleActive,
  resolvePriceSource,
  type MirrorPriceRow,
} from "./medusa-price-source.js";

/**
 * A MÉRCE: EGY ÁR SE MENJEN ÁT ROSSZ FORRÁSBÓL, ÉS EGY HIÁNY SE LEGYEN NÉMA.
 *
 * A két drága tévedés nem egyforma, és mindkettőre külön állítás van:
 *  - a befagyott tükör-árat a saját, friss ár helyett publikálni (a gazdaság
 *    már a miénk),
 *  - a listaárat publikálni egy AKTÍV akció mellett (a vevő többet fizet).
 *
 * === HA A UNAS-ÁGAT ELRONTOD, HÁROM ÁLLÍTÁS PIROSODIK. EZ NEM ROSSZ TESZT. ===
 *
 * A kalibráció harmadik állapota („több piros a szántnál") a legkönnyebben
 * olvasható sikernek -- „hát elbukott, tehát működik" --, pedig általában azt
 * mondja, hogy nem tudjuk, mit mértünk. ITT MÁS A HELYZET, és mérve van:
 *
 * A UNAS-ág EGYETLEN visszatérés. Mind a három állítás ARRA az egy sorra épül,
 * két rétegen (ez a tiszta modul és a parancs specje), plusz a lejárt akció
 * pozitív kontrollja, ami szintén a tükör árát állítja. Szűkebb rontás erre az
 * ágra nem írható, mert a viselkedés egyetlen sor.
 *
 * Vagyis a három piros nem azt jelenti, hogy a teszt nem különböztet, hanem
 * hogy a KÓD egy pontban dönt. A különbség eldöntéséhez nem elég ránézni a
 * számra: meg kell nézni, hogy a piros állítások UGYANARRA a sorra épülnek-e.
 *
 * ELLENPÉLDA UGYANEBBŐL A FÁJLBÓL: az ACROPORA-ág elrontása PONTOSAN EGY
 * állítást pirosít. Ott a kód két külön helyen dönt, tehát ott a szám is
 * elvárható.
 */

const forint = (value: string) => new Prisma.Decimal(value);

/*
  A TUKOR-SOR ALAPERTELMEZESE PENZNEM NELKUL ALL, MERT A VALODI SOR IS OLYAN.

  Az elso valtozat "HUF" erteket tett ide, es ezzel a fixture olyan mezot
  toltott ki, amit a VALODI iro SOHA nem tolt ki: a
  unas-product-sync.repository.ts sehol nem ir currency mezot a pillanatkepbe,
  es a UNAS forras nem is kuld penznemet (a Prices blokk kulcsai 1893 termeken
  csak Appearance, Price es Vat).

  Emiatt a tesztek zoldek voltak, kozben az eles agon MINDEN termek megallt
  volna. A fixture hazudott, nem a kod.
*/
const tukor = (over: Partial<MirrorPriceRow> = {}): MirrorPriceRow => ({
  grossPrice: forint("7800"),
  currency: null,
  saleGrossPrice: null,
  saleStartsAt: null,
  saleEndsAt: null,
  ...over,
});

const sajat = {
  sellingGrossPrice: forint("9900"),
  sellingPriceCurrency: "HUF",
};
const nincsSajat = { sellingGrossPrice: null, sellingPriceCurrency: null };
const most = new Date("2026-09-04T12:00:00Z");

describe("honnan jön az ár", () => {
  it("UNAS gazdánál a TÜKÖR ára megy", () => {
    /*
      EZ A (b) UT MAGA (Balazs dontese, 2026-09-04). A koltozes arral egyutt
      megy, tehat egy UNAS-gazdaju termek ara a tukorbol jon -- senkinek nem
      kell 1905 valtozaton feltoltenie a sajat mezot.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor(),
      own: nincsSajat,
      now: most,
    });

    assert.equal(d.ok, true);
    assert.equal(d.ok && d.source, "mirror");
    assert.equal(d.ok && d.price.sellingGrossPrice?.toString(), "7800");
  });

  it("ACROPORA gazdánál a SAJÁT ár megy, akkor is, ha a tükör-sor ott van", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN.

      A tukor-sor a gazdasag atvetele utan is OTT MARAD, es a LEGUTOLSO UNAS
      allapotot orzi. Egy "van tukor-sor, olvassuk azt" szabaly mellett a sajat,
      frissebb arunk helyett egy befagyott regit publikalnank -- es semmi nem
      szolna rola.

      MI PIROSIT: ha a dontes a tukor-sor MEGLETEBOL indulna, nem a gazdabol.
    */
    const d = resolvePriceSource({
      authority: "ACROPORA",
      mirror: tukor({ grossPrice: forint("7800") }),
      own: sajat,
      now: most,
    });

    assert.equal(d.ok && d.source, "own");
    assert.equal(d.ok && d.price.sellingGrossPrice?.toString(), "9900");
  });

  it("a hiányzó pénznem FORINT, különben egyetlen ár sem menne ki", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN, ES EGY MERT VAK FOLTOT KOT LE.

      A tukor penzneme MINDIG ures: se az import nem irja, se a forras nem kuldi.
      Ha valtozatlanul adnank tovabb, a policy `currency-missing` okkal allna meg
      MIND az 1894 UNAS-gazdaju termeken -- rendezett jelentes, nulla publikalt
      ar, es az egesz szelet no-op lenne.

      MI PIROSIT: a `?? SUPPORTED_CURRENCY` visszavetele pass-through alakra.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor(),
      own: nincsSajat,
      now: most,
    });

    assert.equal(d.ok && d.price.sellingPriceCurrency, "HUF");
  });

  it("de a MEGADOTT pénznemet NEM írjuk felül", () => {
    /*
      TESTVER-KONTROLL: a vedelem nem veszett el, csak nem a hianyra szol. Ha a
      mezo valaha erteket kap, egy idegen penznem a policy neven nevezett
      megallasara fut -- egy beegetett HUF ezt csendben forintta tenne.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor({ currency: "EUR" }),
      own: nincsSajat,
      now: most,
    });

    assert.equal(d.ok && d.price.sellingPriceCurrency, "EUR");
  });

  it("ISMERETLEN gazdánál egyik sem: megáll", () => {
    /*
      A `catalogAuthority` NULLAZHATO, es a null nem "mienk" es nem "ovek". Egy
      `!== "UNAS"` alaku feltetel mellett csendben a sajatunknak vennenk.
    */
    const d = resolvePriceSource({
      authority: null,
      mirror: tukor(),
      own: sajat,
      now: most,
    });

    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, "authority-unknown");
  });
});

describe("a három hiány három külön néven", () => {
  it("UNAS gazda, NINCS tükör-sor", () => {
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: null,
      own: nincsSajat,
      now: most,
    });

    assert.equal(!d.ok && d.reason, "mirror-row-missing");
    assert.match(!d.ok ? d.details : "", /import fusson le/);
  });

  it("van tükör-sor, de NINCS benne ár", () => {
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor({ grossPrice: null }),
      own: nincsSajat,
      now: most,
    });

    assert.equal(!d.ok && d.reason, "mirror-price-missing");
  });

  it("ACROPORA gazda, üres saját ár", () => {
    const d = resolvePriceSource({
      authority: "ACROPORA",
      mirror: tukor(),
      own: nincsSajat,
      now: most,
    });

    assert.equal(!d.ok && d.reason, "own-price-missing");
  });

  it("a három ok SZÖVEGE is különbözik, nem csak a neve", () => {
    /*
      A NEV a kodnak szol, a SZOVEG az embernek, es a teendo mindharomnal MAS:
      az elsot egy import oldja meg, a masodikat a bolt, a harmadikat mi. Egy
      kozos mondat mindharmat ugyanoda kuldene.

      MI PIROSIT: a harom ag osszevonasa egy kozos "nincs ar" szovegre. Figyeld
      meg, hogy erre a hibara a `reason` allitasa VAK.
    */
    const uzenet = (d: ReturnType<typeof resolvePriceSource>) =>
      d.ok ? "" : d.details;
    const a = uzenet(
      resolvePriceSource({
        authority: "UNAS",
        mirror: null,
        own: nincsSajat,
        now: most,
      }),
    );
    const b = uzenet(
      resolvePriceSource({
        authority: "UNAS",
        mirror: tukor({ grossPrice: null }),
        own: nincsSajat,
        now: most,
      }),
    );
    const c = uzenet(
      resolvePriceSource({
        authority: "ACROPORA",
        mirror: tukor(),
        own: nincsSajat,
        now: most,
      }),
    );

    assert.equal(new Set([a, b, c]).size, 3);
  });
});

describe("az aktív akciós ár megy ki, nem a listaár", () => {
  it("aktív akciónál az AKCIOS ár megy, és a forrás ezt meg is nevezi", () => {
    /*
      BALAZS DONTESE, 2026-09-04, szo szerint: "viszi az akciokat". A vevo tehat
      ugyanazt latja a koltozo boltban, mint a maiban.

      MERVE a 2026-08-27-i UNAS exporton: 1893 termekbol 95-nel van akcios sor
      es 67-nel AKTIV, es a kulonbseg nagy (198000 helyett 130000).

      MI PIROSIT: ha a listaar megy ki akcio kozben (a vevo tobbet fizetne), es
      az is, ha a forras neve nem kulonbozteti meg az akcios agat.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor({ saleGrossPrice: forint("3500") }),
      own: nincsSajat,
      now: most,
    });

    assert.equal(d.ok, true);
    assert.equal(d.ok && d.source, "mirror-sale");
    assert.equal(d.ok && d.price.sellingGrossPrice?.toString(), "3500");
  });

  it("az akciós ág is FORINTTAL megy, ha a tükör nem mond pénznemet", () => {
    /*
      TESTVER-KONTROLL a penznem-javitashoz: az akcios ag KULON visszateres,
      tehat ha ott kimaradna a tartalek, MINDEN akcios termek megallna
      currency-missing okkal -- ugyanaz a nema no-op, csak a 67 termeken.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor({ saleGrossPrice: forint("3500") }),
      own: nincsSajat,
      now: most,
    });

    assert.equal(d.ok && d.price.sellingPriceCurrency, "HUF");
  });

  it("LEJÁRT akció mellett a LISTAÁR megy", () => {
    /*
      A HATAR MASIK OLDALA. E nelkul egy fuggveny, ami MINDEN akcios sorra az
      akcios arat kuldi, ugyanugy atmenne a fenti alliton -- es egy evekkel
      ezelotti akcio ara menne ki a mai listaar helyett.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor({
        saleGrossPrice: forint("3500"),
        saleEndsAt: new Date("2026-08-01T00:00:00Z"),
      }),
      own: nincsSajat,
      now: most,
    });

    assert.equal(d.ok && d.source, "mirror");
    assert.equal(d.ok && d.price.sellingGrossPrice?.toString(), "7800");
  });

  it("a HIÁNYZÓ dátum NYITOTT határ, nem inaktív akció", () => {
    /*
      A UNAS oldalan egy kezdo- vagy vegdatum nelkuli akcios ar ERVENYES. Ha a
      hianyt "nem aktiv"-nak vennenk, epp a leggyakoribb alak (allando akcios
      ar) menne at csendben, listaarral.
    */
    assert.equal(
      isSaleActive(tukor({ saleGrossPrice: forint("1") }), most),
      true,
    );
    assert.equal(
      isSaleActive(
        tukor({
          saleGrossPrice: forint("1"),
          saleStartsAt: new Date("2026-09-10T00:00:00Z"),
        }),
        most,
      ),
      false,
    );
  });
});

describe("a jelentés megnevezi a forrást", () => {
  it("a két forrás MÁS mondatot kap, és mindkettő megnevezi a mezőt", () => {
    /*
      acrobot kikotese: enelkul egy kesobbi olvaso nem tudja eldonteni, MIERT
      regi egy ar. Egy befagyott tukor-ar es egy elavult sajat ar a jelentesben
      ugyanugy nez ki.
    */
    const nevek = [
      describePriceSource("mirror"),
      describePriceSource("mirror-sale"),
      describePriceSource("own"),
    ];
    // MIND A HAROM KULONBOZO: egy kozos mondat epp azt venne el, amiert a mezo van.
    assert.equal(new Set(nevek).size, 3);
    assert.match(nevek[0]!, /UnasProductSnapshot/);
    assert.match(nevek[1]!, /AKCIÓS/);
    assert.match(nevek[1]!, /saleGrossPrice/);
    assert.match(nevek[2]!, /sellingGrossPrice/);
  });
});

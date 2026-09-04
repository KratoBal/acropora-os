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
 */

const forint = (value: string) => new Prisma.Decimal(value);

const tukor = (over: Partial<MirrorPriceRow> = {}): MirrorPriceRow => ({
  grossPrice: forint("7800"),
  currency: "HUF",
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

describe("az aktív akció megállít", () => {
  it("aktív akciós árnál NEM vetítünk listaárat", () => {
    /*
      MERVE a 2026-08-27-i UNAS exporton: 1893 termekbol 95-nel van akcios sor
      es 67-nel AKTIV. A kulonbseg nagy (peldaul 198000 helyett 130000), tehat
      ez nem kerekitesi kerdes.

      A KET TEVEDES ARA NEM EGYFORMA: a listaar vetitese egy akcios termekre
      azt jelenti, hogy a vevo TOBBET fizet, es semmi nem szol rola. A megallas
      hangos.

      MI PIROSIT: ha az ag kikerul, es a listaar csendben atmegy.
    */
    const d = resolvePriceSource({
      authority: "UNAS",
      mirror: tukor({ saleGrossPrice: forint("3500") }),
      own: nincsSajat,
      now: most,
    });

    assert.equal(!d.ok && d.reason, "mirror-sale-active-needs-decision");
    // A SZAMOK IS OTT VANNAK: enelkul a megallas nem mondja meg, mekkora a tet.
    assert.match(!d.ok ? d.details : "", /3500/);
    assert.match(!d.ok ? d.details : "", /7800/);
  });

  it("ISMERT POZITÍV: LEJÁRT akció mellett a listaár megy", () => {
    /*
      E NELKUL a fenti allitas semmit nem mondana: egy fuggveny, ami MINDEN
      akcios sorra megall, ugyanugy atmenne rajta -- es akkor egy evekkel
      ezelotti akcio orokre feltartana a termeket.
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
    assert.notEqual(describePriceSource("mirror"), describePriceSource("own"));
    assert.match(describePriceSource("mirror"), /UnasProductSnapshot/);
    assert.match(describePriceSource("own"), /sellingGrossPrice/);
  });
});

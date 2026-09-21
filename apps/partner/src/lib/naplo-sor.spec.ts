import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServiceJobTimelineEntry } from "@acropora/types";

import { naploSor } from "./naplo-sor.js";

/**
 * A NAPLÓSOR SZÖVEGE -- ÉS EZ AZ ELSŐ VISELKEDÉST MÉRŐ SPEC EBBEN A CSOMAGBAN.
 *
 * A `portal-wiring.spec.ts` fejléce kimondja a határát: azok az állítások a
 * FORRÁS SZÖVEGÉT olvassák. Ez nem: a függvényt FUTTATJA, tehát egy átírt
 * mondat ugyanúgy megfogható, mint egy elhagyott ág.
 *
 * A HELYE AZÉRT LEHET ITT, mert a függvény tiszta: nincs benne React, nincs
 * benne `@/` alias (a csomag teszt-konfigja szándékosan nem old fel ilyet), és
 * az egyetlen függősége a `@acropora/types`, ami a teszt előtt felépül.
 */

const status = (fromStatus: "NEW" | null, note: string | null = null) =>
  ({
    kind: "status",
    at: "2026-09-20T08:00:00.000Z",
    sortKey: "e1",
    event: {
      id: "e1",
      fromStatus,
      toStatus: "WAITING_FOR_PARTS",
      note,
      actorName: "Kiss Márta",
      createdAt: "2026-09-20T08:00:00.000Z",
    },
  }) satisfies ServiceJobTimelineEntry;

describe("a partner naplósora", () => {
  /**
   * A LEGFONTOSABB ÁLLÍTÁS: A BELSŐ ÁLLAPOT NEVE NEM KERÜL A SORBA.
   *
   * A nyolc belső állapot az, amit a partner NEM lát -- a szerver neki külön,
   * négyértékű állapotot és saját feliratot küld. A napló-bejegyzés viszont a
   * belső értéket hordozza, tehát egy gondatlan sor kiírná.
   *
   * MI PIROSÍT: bármelyik belső címke beírása a mondatba. Kalibrálva:
   * `Alkatrészre vár`-t téve a sorba ez az állítás pirosodik ki, egyedül.
   */
  it("nem nevezi meg a belső állapotot", () => {
    const belso = [
      "Új",
      "Felmérve",
      "Ütemezve",
      "Folyamatban",
      "Alkatrészre vár",
      "Ügyfélre vár",
      "Elkészült",
      "Meghiúsult",
      "WAITING_FOR_PARTS",
      "NEW",
    ];
    for (const kezdo of [null, "NEW" as const])
      for (const cimke of belso)
        assert.ok(
          !naploSor(status(kezdo)).includes(cimke),
          `a sor megnevezi a belső állapotot: ${cimke}`,
        );
  });

  /**
   * POZITÍV KONTROLL A FENTIHEZ: a két ág szövege nem üres, és KÜLÖNBÖZIK.
   * Enélkül a fenti negatív állítás akkor is zöld lenne, ha a függvény minden
   * ágon `""`-t adna.
   *
   * === MIÉRT NEM A TELJES MONDATRA ILLESZT, HOLOTT ELŐSZÖR ÚGY ÍRTAM ===
   *
   * Kalibrálva 2026-09-21: a belső állapot nevét a váltás mondatába téve KÉT
   * állítás pirosodott ki, nem egy. A második azért, mert a TELJES mondatot
   * rögzítette -- vagyis ugyanazt a rontást mérte, mint a fenti, csak
   * szigorúbban. Két állítás, ami ugyanarra a bemenetre pirosodik, nem két
   * mérés: az egyik nem mond semmi újat.
   *
   * Így viszont a kontroll a SAJÁT kérdését méri (van-e két különböző,
   * nem üres mondat), és a rontás pontosan a fenti állítást viszi pirosra.
   */
  it("a létrejövés és a váltás KÜLÖNBÖZŐ, nem üres mondatot kap", () => {
    const letrejott = naploSor(status(null));
    const valtott = naploSor(status("NEW"));
    assert.ok(letrejott.length > 10, "a létrejövés sora üres vagy csonka");
    assert.ok(valtott.length > 10, "a váltás sora üres vagy csonka");
    assert.notEqual(letrejott, valtott);
    /* ÉS A KETTŐ KÖZTI KÜLÖNBSÉG A LÉNYEG: csak az egyik szól létrejövésről. */
    assert.ok(letrejott.includes("létrejött"));
    assert.ok(!valtott.includes("létrejött"));
  });

  it("a munkalap sora a nevet és zárójelben az azonosítót viseli", () => {
    const entry: ServiceJobTimelineEntry = {
      kind: "worksheet",
      at: "2026-09-20T09:00:00.000Z",
      sortKey: "w1",
      worksheet: {
        id: "w1",
        number: "BIO-2026-004",
        subject: "Szivattyú csere",
        createdAt: "2026-09-20T09:00:00.000Z",
        handedOverAt: null,
      },
    };
    assert.equal(
      naploSor(entry),
      "Munkalap a jegy alatt: Szivattyú csere (BIO-2026-004)",
    );
  });

  /**
   * A SZÁMOZATLAN LAP NEM "NÉVTELEN". A portálon és a belső lapon UGYANAZ a
   * függvény adja a címkét (`serviceJobWorksheetLabel`, `@acropora/types`),
   * és ez az állítás azt is méri, hogy a portál tényleg azt hívja: egy saját
   * másolat előbb-utóbb elcsúszna.
   */
  it("a piszkozat lap is megkülönböztethető marad", () => {
    const entry: ServiceJobTimelineEntry = {
      kind: "worksheet",
      at: "2026-09-20T09:00:00.000Z",
      sortKey: "w2",
      worksheet: {
        id: "w2",
        number: null,
        subject: "Szűrőmosás",
        createdAt: "2026-09-20T09:00:00.000Z",
        handedOverAt: null,
      },
    };
    assert.equal(
      naploSor(entry),
      "Munkalap a jegy alatt: Szűrőmosás (Piszkozat)",
    );
  });

  it("az eszköz sora a számot ÉS a nevet is viseli", () => {
    const entry: ServiceJobTimelineEntry = {
      kind: "asset",
      at: "2026-09-20T10:00:00.000Z",
      sortKey: "a1",
      asset: {
        id: "link1",
        assetId: "asset1",
        assetNumber: "ESZ-0042",
        assetName: "Fő szivattyú",
        attachedAt: "2026-09-20T10:00:00.000Z",
      },
    };
    assert.equal(naploSor(entry), "Eszköz a jegyen: ESZ-0042 (Fő szivattyú)");
  });

  /**
   * A TÖRLÉS SORA MEGNEVEZI, KI VETTE LE. Ez az egyetlen naplósor, ami
   * VISSZAFORDÍTHATATLAN műveletről szól -- ott a "ki" nem kísérőadat.
   *
   * ÉS A NÉV NÉLKÜLI ÁG IS MÉRVE: egy azóta törölt kolléga nem viheti magával
   * a naplót, tehát a sornak név nélkül is olvashatónak kell maradnia.
   */
  it("a törölt csatolmány sora megnevezi a törlőt, ha tudjuk", () => {
    const alap = {
      kind: "document",
      at: "2026-09-20T11:00:00.000Z",
      sortKey: "d1",
      removal: {
        id: "d1",
        fileName: "szivattyu.jpg",
        documentType: "PHOTO",
        actorName: "Nagy Béla",
        removedAt: "2026-09-20T11:00:00.000Z",
        uploadedByName: null,
        uploadedAt: null,
      },
    } satisfies ServiceJobTimelineEntry;
    assert.equal(
      naploSor(alap),
      "Nagy Béla törölt egy fényképet (szivattyu.jpg)",
    );
    assert.equal(
      naploSor({
        ...alap,
        removal: { ...alap.removal, actorName: null, documentType: "OTHER" },
      }),
      "Törölt csatolmányt (szivattyu.jpg)",
    );
  });
});

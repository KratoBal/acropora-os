import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServiceJobPartnerTimelineEntry } from "@acropora/types";

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

/*
  A FIXTURA 2026-09-21 OTA A PARTNER ALAKJAT EPITI.

  Korabban `fromStatus`, `toStatus` es `note` allt benne -- vagyis a teszt
  olyan adatot adott at, ami MA MAR EL SEM JUT a partnerhez. A szerver a
  `{{isCreation}}` bitet kuldi a nyolc erteku belso enum helyett, es a
  megjegyzest egyaltalan nem.

  A FORDITO KENYSZERITETTE KI EZT A VALTOZAST, es ez a lenyeg: a lenti
  "nem nevezi meg a belso allapotot" allitas mostantol NEM az egyetlen vedelem
  -- a belso nev BE SEM FER a tipusba. A ketto kulon all, es a regebbi
  allitast szandekosan NEM vettem ki: az a MONDATOT ellenorzi, a tipus a
  BEMENETET.
*/
const status = (
  isCreation: boolean,
  partnerStatusLabel = "Feldolgozás alatt",
) =>
  ({
    kind: "status",
    at: "2026-09-20T08:00:00.000Z",
    sortKey: "e1",
    event: {
      id: "e1",
      isCreation,
      partnerStatusLabel,
      actorName: "Kiss Márta",
      createdAt: "2026-09-20T08:00:00.000Z",
    },
  }) satisfies ServiceJobPartnerTimelineEntry;

describe("a partner naplósora", () => {
  /**
   * A SOR A KAPOTT PARTNERI FELIRATOT NEVEZI MEG -- MIND A KÉT ÁGON (147d9a1d).
   *
   * A napló-esemény 2026-09-21 délután óta viszi a négyértékű partneri
   * feliratot. Enélkül ez a sor csak annyit tudott mondani, hogy „az állapot
   * változott", de nem, hogy MIRE.
   *
   * A KELETKEZÉS ÁGA IS MÉRVE, és ez nem felesleges: ma ott mindig „Új" áll (a
   * jegynek egyetlen létrehozó útja van, `NEW` állapottal). Egy beégetett szó
   * ugyanott NÉMÁN tévedne, ha ez egyszer megváltozik.
   */
  it("megnevezi a kapott partneri feliratot, létrejövéskor is", () => {
    for (const kezdo of [true, false])
      assert.ok(
        naploSor(status(kezdo, "Lezárva")).includes("Lezárva"),
        `a sor nem nevezi meg az állapotot (isCreation=${kezdo})`,
      );
  });

  /**
   * ÉS VISSZAFELÉ: A FÜGGVÉNY NEM ÍR A MONDATBA BELSŐ CÍMKÉT.
   *
   * MI VÁLTOZOTT A HATÓKÖRÉN (2026-09-21): amíg a sor semmilyen állapotot nem
   * nevezett meg, ez az állítás a TELJES mondatot védte. Ma a feliratot a
   * SZERVER adja, tehát a „nem megy ki belső szó" garancia ott áll (a típus a
   * belső enumot be sem engedi, és a `service-job-partner-detail.test.ts`
   * külön méri mind a két irányban). Ez az állítás innentől azt őrzi, amit
   * EZ A FÜGGVÉNY ronthat el: hogy ne írjon a mondatba SAJÁT, belső szót.
   *
   * === A LISTÁBÓL KÉT SZÓ KIKERÜLT, ÉS AZ MÉRÉS, NEM ENGEDMÉNY ===
   *
   * Az „Új" és az „Elkészült" MIND A KÉT szókincsben szerepel, mert azokra a
   * leképezés azonosság (`NEW -> NEW`, `COMPLETED -> COMPLETED`). Mérve
   * 2026-09-21: a nyolc belső és a négy partneri felirat metszete pontosan ez
   * a két szó.
   *
   * ÉS AZ ÁRÁT IS MEGMÉRTEM, NEM LEVEZETTEM: a régi listát visszatéve, a
   * keletkezés ágán a VALÓDI felirattal („Új" -- a jegy egyetlen létrehozó
   * útja `NEW` állapottal nyit), ez az állítás PIROSRA vált egy tökéletesen
   * helyes mondaton. Vagyis nem szigorúbb lenne, hanem HAMIS -- és a javítója
   * a listát nézné, nem a mondatot.
   *
   * MI PIROSÍT: bármelyik csak-belső címke beírása a mondatba. Kalibrálva:
   * `Alkatrészre vár`-t téve a sorba ez az állítás pirosodik ki, egyedül.
   */
  it("nem ír a mondatba belső címkét", () => {
    const csakBelso = [
      "Felmérve",
      "Ütemezve",
      "Folyamatban",
      "Alkatrészre vár",
      "Ügyfélre vár",
      "Meghiúsult",
      "WAITING_FOR_PARTS",
      "NEW",
    ];
    for (const kezdo of [true, false])
      for (const cimke of csakBelso)
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
    const letrejott = naploSor(status(true));
    const valtott = naploSor(status(false));
    assert.ok(letrejott.length > 10, "a létrejövés sora üres vagy csonka");
    assert.ok(valtott.length > 10, "a váltás sora üres vagy csonka");
    assert.notEqual(letrejott, valtott);
    /* ÉS A KETTŐ KÖZTI KÜLÖNBSÉG A LÉNYEG: csak az egyik szól létrejövésről. */
    assert.ok(letrejott.includes("létrejött"));
    assert.ok(!valtott.includes("létrejött"));
  });

  it("a munkalap sora a nevet és zárójelben az azonosítót viseli", () => {
    const entry: ServiceJobPartnerTimelineEntry = {
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
    const entry: ServiceJobPartnerTimelineEntry = {
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
    const entry: ServiceJobPartnerTimelineEntry = {
      kind: "asset",
      at: "2026-09-20T10:00:00.000Z",
      sortKey: "a1",
      asset: {
        id: "link1",
        assetId: "asset1",
        assetNumber: "ESZ-0042",
        assetName: "Fő szivattyú",
        assetCategoryName: null,
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
    } satisfies ServiceJobPartnerTimelineEntry;
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

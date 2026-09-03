import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideDrain,
  isDueForRetry,
  describeQueueBacklog,
  describeQueueState,
  describeRepeatedFailures,
} from "./queue-drain";

/**
 * A KET IRANY KULON ALL, ES A MASODIK A FONTOSABB.
 *
 *   a sor MEGTELIK -> a felvitel nem veszett el
 *   a sor KIURUL   -> a felvitel tenyleg FELMENT
 *
 * Egy felvitel, ami a sorban marad es sosem megy fel, a telefonon SIKERES
 * ROGZITESNEK latszik. A kollega latta, hogy elmentette, es tovabbment; a hiba
 * napokkal kesobb derul ki, amikor valaki keresi az eszkozt.
 */

const sor = (
  allapot: "pending" | "failed" | "conflict" | "syncing" | "stalled",
  n = 0,
) => ({
  id: "op1",
  state: allapot,
  attemptCount: n,
});

describe("a sor kiürülése", () => {
  it("sikeres válasz után a sor TÖRÖLHETŐ", () => {
    // EZ A KIURULES ALLITASA. Enelkul csak azt tudnank, hogy a felvitel
    // bekerult -- azt nem, hogy valaha ki is megy.
    const out = decideDrain({
      row: sor("pending"),
      httpStatus: 201,
      errorMessage: null,
    });
    assert.equal(out.type, "done");
  });

  it("HÁLÓZAT NÉLKÜL marad, és újrapróbálható", () => {
    /*
      A `null` statusz a NORMALIS offline allapot. Ha konfliktuskent kezelnenk,
      minden offline felvitel azonnal emberi dontesre varna -- vagyis epp a
      funkcio celja veszne el.
    */
    const out = decideDrain({
      row: sor("pending", 2),
      httpStatus: null,
      errorMessage: null,
    });
    assert.equal(out.type, "retry");
    assert.equal(out.type === "retry" && out.attemptCount, 3);
  });

  it("a szerver ELUTASÍTÁSA nem próbálkozik tovább", () => {
    // Egy 409-re valo vegtelen ujraprobalas a kepernyon MUNKANAK latszik.
    const out = decideDrain({
      row: sor("pending"),
      httpStatus: 409,
      errorMessage: "ez a kód már áll egy eszközön",
    });
    assert.equal(out.type, "conflict");
  });

  it("az 500 ÚJRAPRÓBÁLHATÓ, a 409 nem", () => {
    // TESTVER-KONTROLL: a ket agnak KULONBOZNIE kell, kulonben a besorolas
    // barmit mondhat.
    assert.equal(
      decideDrain({ row: sor("pending"), httpStatus: 500, errorMessage: null })
        .type,
      "retry",
    );
    assert.equal(
      decideDrain({ row: sor("pending"), httpStatus: 409, errorMessage: null })
        .type,
      "conflict",
    );
  });

  it("ami MÁR FUT vagy ütközik, azt NEM küldi el újra", () => {
    /*
      MI PIROSIT: ha a kiurites az allapotot nem nezne. Egy masodik futas
      ujrakuldene azt, ami epp uton van, es a szerveren KET felvitel keletkezne
      ugyanabbol -- pontosan az a duplikatum, ami ellen az egesz szelet szol.
    */
    assert.equal(
      decideDrain({ row: sor("syncing"), httpStatus: 201, errorMessage: null })
        .type,
      "conflict",
    );
    assert.equal(
      decideDrain({ row: sor("conflict"), httpStatus: 201, errorMessage: null })
        .type,
      "conflict",
    );
  });
});

describe("a sor állapota emberi szemmel", () => {
  it("ÜRES sornál nincs mit mondani", () => {
    // TESTVER-KONTROLL: egy valtozat, ami mindig kiir valamit, minden
    // kepernyon ott hagyna egy savot, es harmadszorra senki nem olvasna.
    assert.equal(describeQueueState({ pending: 0, conflict: 0 }), null);
  });

  it("a VÁRAKOZÓ felvitelt kimondja", () => {
    const s = describeQueueState({ pending: 2, conflict: 0 });
    assert.match(s ?? "", /2 felvitel még nem ment fel/);
  });

  it("az ELAKADT felvitelt KÜLÖN mondja, mert más a teendő", () => {
    /*
      A varakozo magatol felmegy, ha lesz halozat. Az elakadt SOSEM -- ahhoz
      ember kell. Egy kozos mondat a masodikat elrejtene az elso mogott, es a
      kollega varna valamire, ami nem fog megtortenni.
    */
    const s = describeQueueState({ pending: 0, conflict: 1 });
    assert.match(s ?? "", /döntés kell/);
    assert.doesNotMatch(s ?? "", /még nem ment fel/);
  });
});

describe("ami a sorban MARAD", () => {
  it("a KÉP-hátralékot akkor is kimondja, ha minden rögzítés felment", () => {
    /*
      EZ AZ ALLITAS A FUGGVENY LETEZESENEK OKA. Ez az az allapot, ami "sikeres
      szinkronnak" latszik: nulla rogzites var, es kozben harom kep sosem ment
      fel. Egy egyetlen szamot mutato sav ezt elrejtene.
    */
    const s = describeQueueBacklog({ recordings: 0, photos: 3, conflict: 0 });
    assert.match(s ?? "", /3 fénykép még nem ment fel/);
  });

  it("az ELAKADT sort KÜLÖN mondja, mert más a teendő", () => {
    // A varakozo magatol felmegy, ha lesz halozat. Az elakadt SOSEM.
    const s = describeQueueBacklog({ recordings: 1, photos: 0, conflict: 2 });
    assert.match(s ?? "", /1 rögzítés vár feltöltésre/);
    assert.match(s ?? "", /döntés kell/);
  });

  it("ÜRES sornál hallgat", () => {
    // ISMERT POZITIV KONTROLL a fentiekhez: e nelkul egy "mindig szol"
    // valtozat is atmenne rajtuk, es a kezdolapon allando sav lenne.
    assert.equal(
      describeQueueBacklog({ recordings: 0, photos: 0, conflict: 0 }),
      null,
    );
  });

  it("rögzítést ÉS képet együtt is bont", () => {
    /*
      A ket szam KULON all, nem osszegezve. Az osszeg (`pending`) ugyanezt a
      kettot szamolja, tehat egy osszeg + bontas parositas ugyanazt ketszer
      mondana -- ezert nem is kerul a fuggveny bemenetei koze.
    */
    const s = describeQueueBacklog({ recordings: 2, photos: 3, conflict: 0 });
    assert.match(s ?? "", /2 rögzítés és 3 fénykép vár feltöltésre/);
  });
});

describe("ami ISMÉTELTEN elbukik", () => {
  it("nulla ilyen sornál hallgat", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "mindig szol" valtozat is atmenne
    // a lentieken, es a kezdolapon allando riasztas ulne.
    assert.equal(
      describeRepeatedFailures({ rows: 0, maxAttempts: 0, lastError: null }),
      null,
    );
  });

  it("kimondja a KÍSÉRLETSZÁMOT és az UTOLSÓ HIBÁT", () => {
    /*
      EZ AZ ALLITAS A FUGGVENY LETEZESENEK OKA. Az `attempt_count` es a
      `last_error` 2026-09-03-ig IROTT, DE OLVASATLAN adat volt: egy tetel, ami
      SOSEM fog atmenni, pontosan ugy nezett ki, mint az, ami terero nelkul var.
    */
    const s = describeRepeatedFailures({
      rows: 1,
      maxAttempts: 4,
      lastError: "szerver hiba (500)",
    });
    assert.match(s ?? "", /4 alkalommal/);
    assert.match(s ?? "", /szerver hiba \(500\)/);
    // ES AZT IS KIMONDJA, hogy ez nem magatol oldodik meg -- kulonben a mondat
    // csak egy szam lenne, es a szerelo tovabb varna.
    assert.match(s ?? "", /magától nem fog megoldódni/);
  });

  it("HIÁNYZÓ hibaszövegnél is mond valamit, nem hallgat el", () => {
    /*
      MI PIROSIT: ha az uzenet a `lastError` nelkul ures maradna. A sor akkor is
      ismetelten bukik, ha a hiba szovege nem maradt meg -- a hallgatas ugyanaz
      a vakfolt lenne, amit ez a mondat megszuntet.
    */
    const s = describeRepeatedFailures({
      rows: 2,
      maxAttempts: 7,
      lastError: null,
    });
    assert.match(s ?? "", /2 felvitel/);
    assert.match(s ?? "", /7 alkalommal/);
    assert.match(s ?? "", /nem maradt meg/);
  });
});

describe("a szerver-hibák felső határa", () => {
  it("a NYOLCADIK szerver-hiba MEGÁLLÍTJA a sort", () => {
    /*
      Aki nyolcszor 500-at ad, a kilencedikre is azt fogja. A sor MARAD (a
      felvitel egyetlen letezo peldanya), de nem indul el maganak tobbe.

      MI PIROSIT: a hatar elhagyasa. Akkor ugyanez a tetel a vegtelensegig
      probalkozna, es a szerelo azt latna, hogy "var feltoltesre".
    */
    const out = decideDrain({
      row: sor("failed", 7),
      httpStatus: 500,
      errorMessage: "szerver hiba (500)",
    });
    assert.equal(out.type, "stalled");
    assert.equal(out.type === "stalled" && out.attemptCount, 8);
  });

  it("a HETEDIK szerver-hiba még újrapróbálható", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy valtozat, ami MINDEN szerver-hibat
    // megallit, atmenne a fenti allitason -- es az elso atmeneti 500 utan a
    // felvitel emberre varna.
    const out = decideDrain({
      row: sor("failed", 6),
      httpStatus: 500,
      errorMessage: null,
    });
    assert.equal(out.type, "retry");
  });

  it("a HÁLÓZATI hiba SOHA nem állítja meg, akárhányszor volt", () => {
    /*
      EZ AZ ALLITAS VEDI MEG A PINCEBEN DOLGOZO SZERELOT. A `null` statusz azt
      jelenti, hogy a keres el sem jutott a szerverig -- terero nelkul ez a
      normalis allapot. Egy felso hatar itt azt jelentene, hogy egy het utan az
      EP felvitel feladja.

      MI PIROSIT: ha a hatar a halozati agra is vonatkozna.
    */
    const out = decideDrain({
      row: sor("failed", 99),
      httpStatus: null,
      errorMessage: null,
    });
    assert.equal(out.type, "retry");
  });

  it("a szerver ELUTASÍTÁSA továbbra is KONFLIKTUS, nem megállás", () => {
    // A ket eset teendoje mas: a conflictnal a FELVITELT kell javitani, a
    // stallednel a szerverrel van baj.
    const out = decideDrain({
      row: sor("failed", 50),
      httpStatus: 422,
      errorMessage: null,
    });
    assert.equal(out.type, "conflict");
  });
});

describe("a várakoztatás", () => {
  const most = new Date("2026-09-03T12:00:00.000Z");

  it("HIÁNYZÓ időpont ESEDÉKES", () => {
    /*
      A mezo elott keletkezett sorokon `null` all. Ha a hianyt varakoztatasnak
      vennenk, azok a sorok SOHA nem indulnanak el -- egy uj mezo csendben
      allitana meg a regi felviteleket.
    */
    assert.equal(
      isDueForRetry({ attemptCount: 3, lastAttemptAt: null }, most),
      true,
    );
  });

  it("FRISS kísérlet után VÁR", () => {
    // Harom kiserlet utan ket perc a varakozas; harminc masodperccel a kiserlet
    // utan tehat meg nem esedekes.
    assert.equal(
      isDueForRetry(
        { attemptCount: 3, lastAttemptAt: "2026-09-03T11:59:30.000Z" },
        most,
      ),
      false,
    );
  });

  it("ELÉG idő után ESEDÉKES", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "mindig var" valtozat is atmenne a
    // fenti allitason, es a sor SOHA nem urulne ki.
    assert.equal(
      isDueForRetry(
        { attemptCount: 3, lastAttemptAt: "2026-09-03T11:50:00.000Z" },
        most,
      ),
      true,
    );
  });

  it("ÉRTELMEZHETETLEN időbélyeg ESEDÉKES", () => {
    // Elallitott ora vagy serult sor: a felvitel elkuldese fontosabb, mint a
    // varakoztatas pontossaga.
    assert.equal(
      isDueForRetry({ attemptCount: 3, lastAttemptAt: "nem dátum" }, most),
      true,
    );
  });
});

describe("a megállt sorok a felületen", () => {
  it("KÜLÖN mondatot kapnak, nem a konfliktusét", () => {
    /*
      A conflictnal a FELVITELT kell javitani ("a szerver elutasitotta"), a
      stallednel a felvitellel semmi baj: a szerverrel van. Egy kozos mondat
      mellett a szerelo a sajat adatat kezdene javitani egy szerver-hiba miatt.

      MI PIROSIT: a ket szam osszevonasa egy mondatba.
    */
    const s = describeQueueState({ pending: 0, conflict: 0, stalled: 2 });
    assert.match(s ?? "", /2 megállt/);
    assert.match(s ?? "", /segítség kell/);
    assert.doesNotMatch(s ?? "", /elutasította/);
  });

  it("a hátralék mondatában is megjelennek", () => {
    const s = describeQueueBacklog({
      recordings: 1,
      photos: 0,
      conflict: 0,
      stalled: 1,
    });
    assert.match(s ?? "", /1 rögzítés vár feltöltésre/);
    assert.match(s ?? "", /1 megállt/);
  });

  it("megállt sor NÉLKÜL a mondat változatlan", () => {
    // TESTVER-KONTROLL: e nelkul egy valtozat, ami MINDIG emliti a megallt
    // sorokat, atmenne a fenti kettoen, es minden uzenetben ott lenne egy nulla.
    const s = describeQueueBacklog({ recordings: 1, photos: 0, conflict: 0 });
    assert.doesNotMatch(s ?? "", /megállt/);
  });
});

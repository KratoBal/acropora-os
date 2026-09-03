import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideDrain,
  describeQueueBacklog,
  describeQueueState,
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
  allapot: "pending" | "failed" | "conflict" | "syncing",
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

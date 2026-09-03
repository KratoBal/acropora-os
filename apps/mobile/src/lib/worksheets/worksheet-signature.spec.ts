import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetSignaturePayload,
  canSignWorksheetVersion,
  worksheetSignerName,
} from "./worksheet-signature";

/**
 * A KEPERNYO KET DONTESE: KINEK A NEVE MEGY A LAPRA, ES MIKOR ALL OTT A GOMB.
 *
 * Mindketto a torzsben lakna, ha nem lenne ez a modul -- es a torzset ebben az
 * appban csak kezzel, a helyszinen lehet kiprobalni.
 */

const ALAP = { decision: "ACCEPTED" as const, note: "" };

describe("kinek a neve megy a lapra", () => {
  it("a HIVATALOS nevet adja, akkor is, ha van beceneve", () => {
    /*
      MI PIROSIT: a `personDisplayName` helper hivasa. Az a becenevet
      reszesiti elonyben, es akkor egy alairt munkalapon "Bébé" allna.
      Ez a spec az egyetlen hely, ahol ez a tevedes kiderulne: a ket fuggveny
      MINDEN olyan emberre ugyanazt adja, akinek nincs beceneve.
    */
    assert.equal(
      worksheetSignerName({ displayName: "Kovács Béla", nickname: "Bébé" }),
      "Kovács Béla",
    );
  });

  it("a nev korul allo szokozoket levagja", () => {
    assert.equal(
      worksheetSignerName({ displayName: "  Kovács Béla " }),
      "Kovács Béla",
    );
  });
});

describe("mikor all ott az alairas gomb", () => {
  it("aláírásra váró lapon, írási joggal: igen", () => {
    assert.equal(
      canSignWorksheetVersion({
        status: "AWAITING_SIGNATURE",
        worksheetsManage: true,
      }),
      true,
    );
  });

  it("írási jog nélkül nem", () => {
    assert.equal(
      canSignWorksheetVersion({
        status: "AWAITING_SIGNATURE",
        worksheetsManage: false,
      }),
      false,
    );
  });

  it("piszkozaton, már aláírt és elutasított lapon sem", () => {
    /*
      MIERT MIND A HAROM, ES NEM CSAK EGY: a szerver mindharmat elutasitja
      ("vagy meg piszkozat, vagy mar megszuletett rola a dontes"). Egy gomb,
      ami barmelyiken megjelenik, azt igeri az ugyfel elott allo szerelonek,
      hogy megy -- es a keres utan derul ki, hogy nem.
    */
    for (const status of ["DRAFT", "SIGNED", "REJECTED"])
      assert.equal(
        canSignWorksheetVersion({ status, worksheetsManage: true }),
        false,
        status,
      );
  });
});

describe("a küldött törzs", () => {
  it("elfogadásnál a nevet és üres megjegyzést ad", () => {
    const result = buildWorksheetSignaturePayload(ALAP, "Kovács Béla");
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.payload, {
      decision: "ACCEPTED",
      signerName: "Kovács Béla",
      note: null,
    });
  });

  it("a megjegyzés köré írt szóközöket levágja", () => {
    const result = buildWorksheetSignaturePayload(
      { decision: "ACCEPTED", note: "  Jövő héten visszamegyek.  " },
      "Kovács Béla",
    );
    assert.equal(result.ok && result.payload.note, "Jövő héten visszamegyek.");
  });

  it("a csupa szóközből álló megjegyzésből `null` lesz, nem üres szöveg", () => {
    /*
      MI PIROSIT: egy `note: note` sor a `note ? note : null` helyett. Akkor a
      lapon egy URES megjegyzes allna -- ami ranezesre ugyanaz, mint a
      hianyzó, csak epp letezik, es a lap ugy nezne ki, mintha valaki irt volna
      valamit.
    */
    const result = buildWorksheetSignaturePayload(
      { decision: "ACCEPTED", note: "     " },
      "Kovács Béla",
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.payload.note, null);
  });

  it("ezer karakternél hosszabb megjegyzést nem enged el", () => {
    /*
      A hatar a szervere (`@MaxLength(1000)`). A LEVAGOTT hosszt merjuk, mert a
      szerver is azt kapja: a kore irt szokozoket mar levettuk.
    */
    assert.equal(
      buildWorksheetSignaturePayload(
        { decision: "ACCEPTED", note: "a".repeat(1001) },
        "Kovács Béla",
      ).ok,
      false,
    );
    assert.equal(
      buildWorksheetSignaturePayload(
        { decision: "ACCEPTED", note: "a".repeat(1000) },
        "Kovács Béla",
      ).ok,
      true,
    );
  });
});

describe("az elutasítás oka kötelező", () => {
  it("indok nélkül nem engedi el", () => {
    const result = buildWorksheetSignaturePayload(
      { decision: "REJECTED", note: "" },
      "Kovács Béla",
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "note");
  });

  it("csupa szóközből álló indokkal sem", () => {
    /*
      MI PIROSIT: a `trim()` elhagyasa a hossz-merés elott. A szerver
      ugyanezt a levagott hosszt nezi, tehat a kettő kulonbsege azt jelentene,
      hogy a telefon elenged egy kerest, amit a szerver 400-zal ad vissza --
      az ugyfel elott.
    */
    const result = buildWorksheetSignaturePayload(
      { decision: "REJECTED", note: "   " },
      "Kovács Béla",
    );
    assert.equal(result.ok, false);
  });

  it("két karakteres indokkal sem, hárommal igen", () => {
    /*
      A HATAR PONTOSAN a szerveré (`< 3`). Egy eggyel elcsuszott masolat
      ugyanolyan csendes hiba, mint a hianyzo ellenorzés: vagy elenged valamit,
      amit a szerver visszadob, vagy megfog valamit, amit elfogadna.
    */
    assert.equal(
      buildWorksheetSignaturePayload(
        { decision: "REJECTED", note: "ok" },
        "Kovács Béla",
      ).ok,
      false,
    );
    assert.equal(
      buildWorksheetSignaturePayload(
        { decision: "REJECTED", note: "drá" },
        "Kovács Béla",
      ).ok,
      true,
    );
  });

  it("elfogadásnál viszont nem kér indokot", () => {
    /*
      ISMERT POZITIV KONTROLL az elozo harom mellé: enelkul mindharom
      teljesulne attol is, ha a fuggveny MINDENT elutasitana.
    */
    assert.equal(buildWorksheetSignaturePayload(ALAP, "Kovács Béla").ok, true);
  });
});

describe("a név a szerver határain belül kell legyen", () => {
  it("egy karakteres név nem elég, és az üzenet NEM az űrlapra mutat", () => {
    /*
      A MEZO ZARVA VAN: a szerelo nem tudja "kijavitani" a sajat nevet ezen a
      kepernyon. Egy "add meg a neved" alaku mondat egy nem letezo gombra
      mutatna, ezert az uzenet az irodara mutat. Ezt a spec allitja, mert a
      szoveg a viselkedes resze, nem diszites.
    */
    const result = buildWorksheetSignaturePayload(ALAP, "K");
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "signerName");
    assert.ok(!result.ok && result.message.includes("irodának"));
  });

  it("üres név sem", () => {
    assert.equal(buildWorksheetSignaturePayload(ALAP, "   ").ok, false);
  });

  it("kétszáz karakternél hosszabb név sem", () => {
    assert.equal(
      buildWorksheetSignaturePayload(ALAP, "K".repeat(201)).ok,
      false,
    );
    assert.equal(
      buildWorksheetSignaturePayload(ALAP, "K".repeat(200)).ok,
      true,
    );
  });
});

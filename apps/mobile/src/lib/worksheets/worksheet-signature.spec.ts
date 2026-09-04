import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetSignaturePayload,
  canSignWorksheetVersion,
  worksheetSignatureConfirmation,
} from "./worksheet-signature";

/**
 * A KEPERNYO KET DONTESE: KINEK A NEVE MEGY A LAPRA, ES MIKOR ALL OTT A GOMB.
 *
 * Mindketto a torzsben lakna, ha nem lenne ez a modul -- es a torzset ebben az
 * appban csak kezzel, a helyszinen lehet kiprobalni.
 */

/**
 * AZ ALAPFORMA A KODOT IS VISZI, mert a listarol valasztott agon az KOTELEZO.
 * Enelkul minden ilyen allitas a kod hianyan bukna el, es a tesztek nem arrol
 * szolnanak, amirol szolni akarnak.
 */
const ALAP = {
  decision: "ACCEPTED" as const,
  note: "",
  signatureCode: "0000",
};

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
  it("a LISTÁRÓL választott aláírónál CSAK az azonosító megy fel", () => {
    /*
      A NEVET A SZERVER VESZI a valasztott sorbol. Ha a kliens is kuldene egyet,
      a szerver KET allitast kapna arrol, ki irta ala, es a KLIENS dontene el,
      melyik nyer -- vagyis a lapra mas nev kerulhetne, mint akit valasztottak.

      MI PIROSIT: ha a `signerName` is bekerulne a torzsbe. A `deepEqual` epp
      ezert TELJES alakot allit, nem mezonkent.
    */
    const result = buildWorksheetSignaturePayload(ALAP, "kontakt-1");
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.payload, {
      decision: "ACCEPTED",
      signerUserId: "kontakt-1",
      signatureCode: "0000",
      note: null,
    });
  });

  it("az EGYIK SEM ágon a BEÍRT név megy, azonosító nélkül", () => {
    /*
      A masik ag, es a ket alak KIZARJA egymast: itt nincs valasztott szemely,
      tehat a nev az egyetlen, amit a szerver kaphat.

      MI PIROSIT: ha mind a ketto ott allna -- akkor a szerver nem tudna, melyik
      agon ment az alairas, es a lapon a jelzes hamis lehetne.
    */
    const result = buildWorksheetSignaturePayload(
      { decision: "ACCEPTED", note: "", typedName: "  Kovács Béla  " },
      null,
    );
    assert.deepEqual(result.ok && result.payload, {
      decision: "ACCEPTED",
      signerName: "Kovács Béla",
      note: null,
    });
  });

  it("a megjegyzés köré írt szóközöket levágja", () => {
    const result = buildWorksheetSignaturePayload(
      {
        decision: "ACCEPTED",
        note: "  Jövő héten visszamegyek.  ",
        signatureCode: "0000",
      },
      "kontakt-1",
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
      { ...ALAP, note: "     " },
      "kontakt-1",
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
        { ...ALAP, note: "a".repeat(1001) },
        "kontakt-1",
      ).ok,
      false,
    );
    assert.equal(
      buildWorksheetSignaturePayload(
        { ...ALAP, note: "a".repeat(1000) },
        "kontakt-1",
      ).ok,
      true,
    );
  });
});

describe("az elutasítás oka kötelező", () => {
  it("indok nélkül nem engedi el", () => {
    const result = buildWorksheetSignaturePayload(
      { ...ALAP, decision: "REJECTED", note: "" },
      "kontakt-1",
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
      { ...ALAP, decision: "REJECTED", note: "   " },
      "kontakt-1",
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
        { ...ALAP, decision: "REJECTED", note: "ok" },
        "kontakt-1",
      ).ok,
      false,
    );
    assert.equal(
      buildWorksheetSignaturePayload(
        { ...ALAP, decision: "REJECTED", note: "drá" },
        "kontakt-1",
      ).ok,
      true,
    );
  });

  it("elfogadásnál viszont nem kér indokot", () => {
    /*
      ISMERT POZITIV KONTROLL az elozo harom mellé: enelkul mindharom
      teljesulne attol is, ha a fuggveny MINDENT elutasitana.
    */
    assert.equal(buildWorksheetSignaturePayload(ALAP, "kontakt-1").ok, true);
  });
});

describe("a név a szerver határain belül kell legyen", () => {
  it("az EGYIK SEM ágon egy karakteres név nem elég, és az üzenet a MEZŐRE mutat", () => {
    /*
      2026-09-04 ELOTT ez a mondat az IRODARA mutatott, mert a nev a
      bejelentkezett felhasznalobol jott, es a szerelo nem tudta kijavitani.
      MA MAS: a mezo ott van, a szerelo BE TUDJA irni -- tehat a mondat egy
      LETEZO helyre mutat, es a valasztast is felkinalja.

      MI PIROSIT: a regi, irodara mutato szoveg visszairasa. Az ma egy nem
      letezo teendore kuldene a szerelot.
    */
    const result = buildWorksheetSignaturePayload(
      { ...ALAP, typedName: "K" },
      null,
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "signerName");
    assert.match(!result.ok ? result.message : "", /Válaszd ki az aláírót/);
  });

  it("az EGYIK SEM ágon üres név sem elég", () => {
    assert.equal(
      buildWorksheetSignaturePayload({ ...ALAP, typedName: "   " }, null).ok,
      false,
    );
  });

  it("kétszáz karakternél hosszabb BEÍRT név sem", () => {
    assert.equal(
      buildWorksheetSignaturePayload(
        { ...ALAP, typedName: "K".repeat(201) },
        null,
      ).ok,
      false,
    );
    assert.equal(
      buildWorksheetSignaturePayload(
        { ...ALAP, typedName: "K".repeat(200) },
        null,
      ).ok,
      true,
    );
  });

  it("a LISTÁRÓL választott ágon a NÉV-ellenőrzés KIMARAD", () => {
    /*
      TESTVER-KONTROLL, ES NEM DISZ. A nevet ott nem is a kliens adja: egy
      itteni hossz-kapu olyan erteket vizsgalna, ami fel sem megy -- es a
      valasztott alairoval indulo alairas elakadna egy ures szovegmezo miatt,
      amit a szerelo ki sem nyitott.

      MI PIROSIT: ha az ellenorzes a valasztott agon is futna.
    */
    assert.equal(
      buildWorksheetSignaturePayload({ ...ALAP, typedName: "" }, "kontakt-1")
        .ok,
      true,
    );
  });
});

describe("a megerősítés szövege", () => {
  const elfogad = worksheetSignatureConfirmation({
    decision: "ACCEPTED",
    signerName: "Kovács Béla",
  });
  const elutasit = worksheetSignatureConfirmation({
    decision: "REJECTED",
    signerName: "Kovács Béla",
  });

  it("aláírásnál KIMONDJA, mi történik, nem csak kérdez", () => {
    /*
      EZ A LENYEG, es acrobot elore megnevezte, hogy konnyu elrontani: egy
      "Biztos vagy benne?" annyit ker, hogy nyomd meg megegyszer, es a
      masodik nyomast ugyanaz a kez vegzi, ugyanabban a masodpercben.

      MI PIROSIT: a szoveg lecserelese barmilyen puszta kerdesre. A ket
      kifejezes a KOVETKEZMENYT nevezi meg, nem a muveletet.
    */
    assert.ok(elfogad.message.includes("lezárul"), elfogad.message);
    assert.ok(elfogad.message.includes("nem szerkeszthető"), elfogad.message);
  });

  it("mindkét ágon megnevezi, kinek a nevében zárul a lap", () => {
    /*
      A kepernyon nincs nev-mezo, tehat a megerosites az UTOLSO hely, ahol a
      nev meg lathato, mielott felmegy.
    */
    assert.ok(elfogad.message.includes("Kovács Béla"), elfogad.message);
    assert.ok(elutasit.message.includes("Kovács Béla"), elutasit.message);
  });

  it("elutasításnál MÁST mond, mert más is történik", () => {
    /*
      LEMERVE a szerveren (`worksheet-amendment.ts`): az `amendRefusal` a
      SIGNED allapotra elutasitast ad, a REJECTED-re `null`-t. Vagyis az
      alairt lap vegleges, az elutasitott viszont atirhato -- egy kozos,
      altalanos mondat az egyik agon HAZUDNA.

      MI PIROSIT: egy megosztott szoveg a ket agra.
    */
    assert.ok(elutasit.message.includes("átírhatja"), elutasit.message);
    assert.equal(elutasit.message.includes("nem szerkeszthető"), false);
    assert.notEqual(elfogad.message, elutasit.message);
  });

  it("a megerősítő gomb felirata megnevezi a tettet", () => {
    /*
      A rendszer-parbeszedben a gomb felirata az utolso, amit valaki elolvas.
      Egy "Igen" ott ugyanannyit mond, mint egy ures gomb.
    */
    assert.equal(elfogad.confirmLabel, "Aláírom");
    assert.equal(elutasit.confirmLabel, "Elutasítás rögzítése");
  });

  it("a cím kérdés, a törzs állítás", () => {
    /*
      ISMERT POZITIV KONTROLL a fentiek melle: a fenti allitasok akkor is
      teljesulnenek, ha a cim es a torzs ugyanaz a szoveg lenne. Ket kulon
      szerepuk van, es ez meri, hogy tenyleg ketto van.
    */
    assert.ok(elfogad.title.endsWith("?"), elfogad.title);
    assert.ok(elutasit.title.endsWith("?"), elutasit.title);
    assert.notEqual(elfogad.title, elfogad.message);
  });
});

describe("az aláírókód a telefonon", () => {
  it("a LISTÁRÓL választott aláírónál KÖTELEZŐ", () => {
    /*
      A szerver ugyanezt ellenorzi, es azé a donto szo. Ez a masolat azert all
      itt, hogy a szerelo a valaszt AZONNAL lassa -- ne egy korut utan, az
      ugyfel elott allva.

      MI PIROSIT: a kapu elhagyasa. Olyankor a hianyzo kod csak a szerverrol
      derulne ki, es a hibauzenet egy mar atadott telefonon jelenne meg.
    */
    const result = buildWorksheetSignaturePayload(
      { decision: "ACCEPTED", note: "" },
      "kontakt-1",
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.field, "signatureCode");
  });

  it("PONTOSAN négy számjegy, és a szóköz nem számít", () => {
    /*
      A telefon billentyuzete konnyen ad szokozt, es a " 0000" a felhasznalo
      szemszogebol UGYANAZ a kod. Egy szigoru olvasas olyan hibat mutatna, amit
      a beiro nem lat.
    */
    assert.equal(
      buildWorksheetSignaturePayload(
        { ...ALAP, signatureCode: " 1234 " },
        "kontakt-1",
      ).ok,
      true,
    );
    assert.equal(
      buildWorksheetSignaturePayload(
        { ...ALAP, signatureCode: "123" },
        "kontakt-1",
      ).ok,
      false,
    );
  });

  it("az EGYIK SEM ágon NEM kér kódot", () => {
    /*
      TESTVER-KONTROLL, ES KI KELL MONDANI, MIERT NEM KISKAPU: ezen az agon a
      lap MAGA MONDJA KI, hogy nem a partner nyilvantartott munkatarsa irta ala.
      A kod hianya tehat nem rejtve marad, hanem a dokumentum resze lesz.

      MI PIROSIT: ha a kod-kapu ezen az agon is elsulne -- olyankor a szabad
      szoveges ut jarhatatlanna valna, es a szerelo ott allna a helyszinen.
    */
    assert.equal(
      buildWorksheetSignaturePayload(
        { decision: "ACCEPTED", note: "", typedName: "Kovács Kázmér" },
        null,
      ).ok,
      true,
    );
  });

  it("a kód a TORZSBE is bekerül, levágva", () => {
    // A szerver a levagott erteket varja; ha a szokoz felmenne, a hash-hasonlitas
    // MINDIG elbukna -- es a hiba a kod beirojara mutatna, holott jol irta be.
    const result = buildWorksheetSignaturePayload(
      { ...ALAP, signatureCode: " 4321 " },
      "kontakt-1",
    );
    assert.equal(result.ok && result.payload.signatureCode, "4321");
  });
});

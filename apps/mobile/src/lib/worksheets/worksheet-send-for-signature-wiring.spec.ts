import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KIKULDES BEKOTESE -- FORRAS SZINTEN.
 *
 * A dontesek a `worksheet-send-for-signature.ts`-ben allnak, es ott merhetok.
 * Ami CSAK itt dolhet el: hogy a kepernyo azokat HASZNALJA-e, hogy a gomb
 * tenyleg elindul-e a felugro ablakra, es hogy a felugro ablak UGYANAZT a
 * kaput hasznalja-e, mint a gomb.
 *
 * MIERT NEM RENDERELESSEL: ebben az appban nincs komponens-teszt eszkoz, es a
 * kepernyo `@/` alaku importokat hasznal, amiket a teszt-fordito nem old fel.
 * Ugyanaz az alak, mint a szomszed `worksheet-handover-wiring.spec.ts`-ben.
 */
const GYOKER = join(__dirname, "..", "..", "..", "src", "app", "worksheets");
const LAP = join(GYOKER, "[id].tsx");
const FELUGRO = join(GYOKER, "send-for-signature", "[id].tsx");

/**
 * A KOMMENTEKET KISZEDJUK, ES EZ NEM OVATOSSAG: a kepernyo kommentjei SZO
 * SZERINT idezik a fuggvenyneveket, tehat egy nyers kereses akkor is talalna,
 * ha a kod maga nem hivna oket.
 */
function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function forras(ut: string): string {
  const s = kodSzoveg(readFileSync(ut, "utf8"));
  // ISMERT POZITIV KONTROLL: rossz utvonalnal ures szovegen minden allitas
  // zold lenne, a hiany-allitasok pedig epp attol.
  assert.ok(s.length > 2000, `gyanúsan rövid forrás: ${ut}`);
  return s;
}

describe("a kiküldés bekötése a munkalap-képernyőn", () => {
  const lap = forras(LAP);

  it("a gomb kapuja a modulból jön, nem a képernyőről", () => {
    assert.match(lap, /kikuldhetoAlairasra\(\{/);
  });

  /**
   * A KAPU MINDHAROM MEZOT MEGKAPJA.
   *
   * Nem stilus: ha a `sentForSignatureAt` kimaradna, a hivas LEFORDULNA
   * (a mezo kotelezo, tehat nem -- de egy `null` beirasa igen), es a gomb
   * OTT MARADNA egy mar kikuldott lapon. A szerver azt atengedne, tehat a
   * szerelo masodszor is kikuldhetne -- epp az a tunet, amit Balazs nevezett
   * meg.
   */
  it("a kapu a lap valódi állapotából dolgozik", () => {
    const hivas = lap.match(/kikuldhetoAlairasra\(\{[\s\S]{0,300}?\}\)/);
    assert.ok(hivas, "nem találtam kikuldhetoAlairasra hívást");
    assert.match(hivas[0], /status: current\.status/);
    assert.match(hivas[0], /sentForSignatureAt: current\.sentForSignatureAt/);
    assert.match(hivas[0], /worksheetsManage: capabilities\.worksheetsManage/);
  });

  it("a gomb a felugró ablakra indul", () => {
    assert.match(lap, /pathname: "\/worksheets\/send-for-signature\/\[id\]"/);
  });

  /**
   * AZ ALLAPOT-SOR A GOMB PARJA, es ezert all rajta kulon allitas.
   *
   * A kikuldes utan a gomb eltunik. Ha csak a gomb tunne el es semmi nem
   * kerulne a helyere, a szerelo azt latna, hogy a lehetoseg ELVESZETT, nem
   * azt, hogy MEGTORTENT -- es telefonalna, epp amit Balazs el akart kerulni.
   */
  it("a kiküldés után a lap kiírja, kinek ment ki", () => {
    assert.match(lap, /kikuldesAllapotSora\(\{/);
    assert.match(
      lap,
      /sentForSignatureToName: current\.sentForSignatureToName/,
    );
  });
});

describe("a kiküldés felugró ablaka", () => {
  const felugro = forras(FELUGRO);

  /**
   * UGYANAZ A KAPU, MINT A GOMBON -- NEM MASOLAT, HANEM UGYANAZ A FUGGVENY.
   *
   * Ha a ket hely kulon feltetelt viselne, elso nap kette valna: a gomb
   * megjelenne, a kepernyo pedig visszadobna (vagy forditva, ami rosszabb).
   */
  it("ugyanazt a kaput használja, mint a gomb", () => {
    assert.match(felugro, /kikuldhetoAlairasra\(\{/);
  });

  it("a hívás a szerverre megy, a választott címzettel", () => {
    assert.match(felugro, /sendWorksheetForSignature\(id, cimzett\)/);
  });

  /**
   * A CIMZETT-LISTA UGYANABBOL A LEKERDEZESBOL JON, amibol a helyszini
   * alairas valasztoja. Ket lista ugyanarra a kerdesre elso nap kette valna,
   * es a szerelo ket kulonbozo nevsort latna ugyanarra a partnerre.
   */
  it("a címzettek a signers lekérdezésből jönnek", () => {
    assert.match(felugro, /listWorksheetSigners\(id\)/);
    assert.match(felugro, /queryKey: \["worksheet-signers", id\]/);
  });

  /**
   * CIMZETT NELKUL A GOMB NEM INDUL.
   *
   * A szerver a hianyzo `signerUserId`-t elutasitana, de csak azutan, hogy a
   * szerelo megnyomta -- itt viszont a gomb meg sem indul. Ez nem masodik
   * vedelem: a szerveri elutasitas UZENETE nem mondana meg, hogy egyszeruen
   * nem valasztott senkit.
   */
  it("címzett nélkül nem indul a küldés", () => {
    assert.match(
      felugro,
      /disabled=\{signerUserId === null \|\| kikuldes\.isPending\}/,
    );
    assert.match(felugro, /if \(signerUserId === null\) return;/);
  });
});

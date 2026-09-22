import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * A FELTEVES, AMIRE A KET KULON TABLA EPUL -- ES AMI MA IGAZ, HOLNAP CSENDBEN
 * ELROMOLHAT (acrobot kikotese, 2026-09-22 19:38).
 *
 * === MIT ALLIT A FELULET, ES MIRE EPUL ===
 *
 * A webes oldalon KET tabla all: az elonezete HAT okot ismer, a kuldese
 * NYOLCAT. Ez a felosztas arra a feltevesre epul, hogy az ELONEZET
 * szerkezetileg nem tud `no-sender`-t adni -- vagyis nem is nezi meg, van-e
 * levelkuldo.
 *
 * === ES MIERT NEM ELEG, HOGY MA IGAZ ===
 *
 * Ha valaki egyszer beir egy `this.sender` vizsgalatot a `preview` agra, az
 * elonezet elkezdhet `no-sender`-t adni -- es a felulet tablaja HETEDIK ok
 * nelkul maradna. A fordito NEM szolna: a preview TIPUSA valtozatlan, tehat a
 * `Record` teljes marad. A kezelo `undefined` leirast latna, epp abban az
 * allapotban, ahol a level MAJDNEM kiment.
 *
 * Ez tehat nem stilus-szabaly: a ket tabla kulonallasat orzi.
 *
 * === AMIT NEM BIZONYIT ===
 *
 * Csak azt meri, hogy a preview METODUS TORZSEBEN nem all `this.sender`. Ha
 * valaki egy segedfuggvenyt hiv, ami a kuldot nezi, ez zold marad -- akkor a
 * ket tabla kulonallasat ujra meg kell indokolni. A metodus torzsét
 * zarojel-parositassal vagjuk ki, nem regexszel: egy szomszedos metodus
 * `this.sender` hivasa igy nem szamit bele.
 */
/*
  A FORRAST A CSOMAG MUNKAKONYVTARAHOZ KEPEST NYITJUK, NEM `import.meta.url`-bol.

  MERT ESET, 2026-09-22: az elso valtozatom `new URL("./...", import.meta.url)`
  alakkal allt, es ELBUKOTT -- a lefordított spec a `test-dist`-bol fut, ahol
  `.ts` fajl nincs (`ENOENT: .../test-dist/notifications/mail/handover-mail.service.ts`).
  Helyben `tsx` alatt zold lett volna; a valodi kapu pirosat adott.

  A haz mintaja ugyanez (`mail-sender-wiring.spec.ts`, `label-scan-scope.spec.ts`).
*/
const FORRAS = "src/notifications/mail/handover-mail.service.ts";

function metodusTorzse(szoveg: string, nev: string): string {
  const kezd = szoveg.indexOf(nev);
  assert.notEqual(kezd, -1, `a ${nev} metodus nincs meg a forrasban`);
  const nyito = szoveg.indexOf("{", szoveg.indexOf(")", kezd));
  let melyseg = 0;
  for (let i = nyito; i < szoveg.length; i += 1) {
    if (szoveg[i] === "{") melyseg += 1;
    else if (szoveg[i] === "}") {
      melyseg -= 1;
      if (melyseg === 0) return szoveg.slice(nyito, i + 1);
    }
  }
  throw new Error(`a ${nev} torzse nem zarul le`);
}

test("az elonezet aga NEM nezi meg a levelkuldot", () => {
  const forras = readFileSync(FORRAS, "utf8");

  /*
    ISMERT POZITIV KONTROLL, ES NEM UDVARIASSAGBOL: e nelkul ez az allitas egy
    URES vagy ATNEVEZETT fajlon is zold lenne. A `send` torzse TARTALMAZZA a
    `this.sender`-t -- ha ez a sor elbukik, nem a preview romlott el, hanem a
    kivagas.
  */
  assert.match(
    metodusTorzse(forras, "async send("),
    /this\.sender/,
    "kontroll: a kuldes aganak NEZNIE KELL a kuldot",
  );

  assert.doesNotMatch(
    metodusTorzse(forras, "async preview("),
    /this\.sender/,
    "az elonezet nem nezheti a kuldot: erre epul a ket kulon tabla a feluleten",
  );
});

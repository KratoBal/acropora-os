import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * A `resolve()` FEJLECE KET MERT ALLITAST HORDOZ EGY MASIK FAJLROL -- ES EZ AZ,
 * AMI CSENDBEN ELAVUL.
 *
 * === MIT ALLIT A FEJLEC, ES MIERT SZAMIT ===
 *
 * A `handover-mail.service.ts` fejlece kimondja, hogy a `null` EGYETLEN
 * jelentese az, hogy a jegy nem letezik -- es ezt arra alapozza, hogy a
 * `jobForMail` hatokor-szures NELKUL kerdez. Erre epul az egesz kovetkeztetes:
 * hogy a 404 IGAZAT allit, es hogy nincs "letezik, de nem oldhato fel" allapot.
 *
 * Ha valaki egyszer hatokort tesz a `jobForMail` lekerdezesebe, a fejlec
 * HAMISSA valik -- es a kovetkezo olvaso egy MERT allitasnak fogja hinni. A
 * szoveg ott marad, meggyozoen, es semmi nem szol.
 *
 * === MIERT ITT ALL, ES NEM EGY SZABALY A LAPON ===
 *
 * Ugyanez a modul adott ma egy mert peldat (2026-09-22): egy masik fejlec egy
 * migracios mappara hivatkozott, amit kozben atneveztek, es a hivatkozas
 * hamisan allt ott -- egy komment elavulasat semmilyen teszt nem fogta meg.
 *
 * === AMIT MER, ES AMIT SZANDEKOSAN NEM ===
 *
 * MER: hogy a `jobForMail` TORZSEBEN nincs hatokor-fogalom. A torzset
 * zarojel-parositassal vagjuk ki, nem regexszel: a szomszed metodusok
 * (`recipients`, a naplo-irok) sajat feltetelei igy nem szamitanak bele.
 *
 * A KONTROLL ALAKJA EGY BUKOTT KALIBRACIOBOL JON (2026-09-22): eloszor a
 * `findUnique` NEVERE illesztett. A rontasom viszont `findFirst`-re cserelte a
 * hivast (egy hatokor-szures rendszerint ezzel jar), tehat a KONTROLL bukott
 * el, nem a mert allitas -- egy piros, egy nev, es a kalibracio semmit nem
 * bizonyitott. A tagabb minta a LEKERDEZES leteet meri, nem a Prisma-metodus
 * valasztasat.
 *
 * NEM MER: hogy a lekerdezes EREDMENYE hatokor-fuggetlen. Ha valaki egy
 * segedfuggvenybe rejti a szurest, ez zold marad -- akkor a fejlec allitasat
 * ujra meg kell merni. A hatar kimondva all, mert egy orzo, amirol azt hisszuk,
 * tobbet tud, rosszabb annal, amelyikrol tudjuk, mit nem fog meg.
 */
const FORRAS = "src/notifications/mail/handover-mail.repository.ts";

function metodusTorzse(szoveg: string, nev: string): string {
  const kezd = szoveg.indexOf(nev);
  assert.notEqual(kezd, -1, `a ${nev} nincs meg a forrasban`);
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

test("a jobForMail hatokor-szures NELKUL kerdez", () => {
  const forras = readFileSync(FORRAS, "utf8");
  const torzs = metodusTorzse(forras, "async jobForMail(");

  /*
    ISMERT POZITIV KONTROLL: a kivagas MUKODIK. A torzsnek tartalmaznia kell a
    lekerdezest -- ha ez elbukik, nem a hatokor kerult be, hanem a metodus neve
    vagy az alakja valtozott, es akkor a lenti nulla semmit nem jelentene.
  */
  assert.match(
    torzs,
    /prisma\.serviceJob\.find/,
    "kontroll: a torzs a lekerdezest tartalmazza",
  );

  assert.doesNotMatch(
    torzs,
    /scope|assignedUnitIds|customerId:\s*scope/,
    "a fejlec allitasa erre epul: a null egyetlen jelentese, hogy a jegy nem letezik",
  );
});

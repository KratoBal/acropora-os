#!/usr/bin/env node
/**
 * A MERES-AGAK KAPUJA: A ZOLD AZT JELENTI, HOGY A KOR MERT VALAMIT.
 *
 * === MIERT LETEZIK ===
 *
 * Egy meres-kor SZANDEKOSAN ront el valamit, tehat a rendes CI-ben PIROS lesz. A
 * piros viszont kifele megkulonboztethetetlen egy elromlott fejlesztestol, es a
 * GitHub ertesito email targyat NEM MI IRJUK: "Run failed: CI - <ag> (<sha>)".
 * Merve 2026-09-15: Balazs ezt a levelet kapta a meres/mind-az-otvenhat-2 korrol,
 * es harom meres-futast "3 piros PR"-kent olvasott -- holott egyiken sem volt PR.
 *
 * Negy jel allt ott (a commit-cim "meas: NE OLVASZD BE", az ag neve `meres/`, az
 * esemeny `push`, es hogy PR egyaltalan nincs), es egyik sem ert el a levelig.
 * Ezert nem elég "a nev mondja meg": ezen a csatornan szerkezetileg nem tud.
 *
 * === A MEGOLDAS NEM AZ ELREJTES, HANEM A SZIN MEGFORDITASA ===
 *
 * Ha a meres-agon NEM fut CI, nincs level -- de nincs NAPLO sem, es a naplora
 * epult az, hogy a meres-agakat torolni lehet (ma harmat toroltunk ugy, hogy a
 * bizonyitek a futasban maradt). Ezert a futas MEGMARAD, es a verdiktje fordul meg:
 *
 *     ZOLD  = a szandekos rontas ELSULT, a kor MERT valamit
 *     PIROS = a kor NEM mert semmit  (ez az igazi baj, es ilyenkor JOJJON level)
 *
 * === A ZOLD FELTETELE NEM "ELBUKOTT", HANEM "MEGJELENTEK A VART NEVEK" ===
 *
 * Ez a kulonbseg tartja a kaput meressé. Egy "a bukas a vart eredmeny" alaku
 * kapu pontosan az a szerkezet, ami el tud rejteni egy valodi hibat: barmilyen
 * osszeomlas "sikernek" szamitana. Ezert az ag maga mondja meg, MIT var, es a
 * kapu azt keresi a naploban.
 *
 * === HASZNALAT ===
 *
 *     node scripts/meres-kapu.mjs <naplo> <vart-fajl>
 *
 * A vart-fajl soronkent egy szoveg, aminek MEG KELL jelennie a naploban.
 * A `#` kezdetu es az ures sorok megjegyzesek.
 *
 * KILEPESI KODOK, es mind a negy MAS teendot ad:
 *     0  minden vart szoveg megjelent -- a kor mert
 *     1  valamelyik NEM jelent meg   -- a kor nem mert (ez a valodi baj)
 *     2  az ag nem mondta meg, mit var (hianyzo vagy ures vart-fajl)
 *     3  a naplot nem tudtam elolvasni
 */
import { readFileSync } from "node:fs";

const [, , naploUt, vartUt] = process.argv;

function megall(kod, ...sorok) {
  for (const s of sorok) console.error(s);
  process.exit(kod);
}

if (!naploUt || !vartUt)
  megall(2, "HASZNALAT: node scripts/meres-kapu.mjs <naplo> <vart-fajl>");

let vartNyers;
try {
  vartNyers = readFileSync(vartUt, "utf8");
} catch {
  megall(
    2,
    `FAIL: a meres-ag NEM MONDTA MEG, MIT VAR (${vartUt} nem olvashato).`,
    "",
    "Egy meres-ag, ami nem nevezi meg a vart nyomot, nem tud zold lenni: a kapu",
    "kulonben barmilyen osszeomlast sikernek olvasna. Tegyel a gyokerbe egy",
    "`meres-vart.txt` fajlt, soronkent egy szoveggel, aminek meg kell jelennie.",
  );
}

const vart = vartNyers
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith("#"));

if (vart.length === 0)
  megall(2, `FAIL: a ${vartUt} egyetlen vart szoveget sem tartalmaz.`);

let naplo;
try {
  naplo = readFileSync(naploUt, "utf8");
} catch {
  megall(3, `FAIL: a naplot nem tudtam elolvasni: ${naploUt}`);
}

const hianyzo = vart.filter((sor) => !naplo.includes(sor));

console.log(`MERES-KAPU  (${naploUt})`);
console.log(`  vart nyom:      ${vart.length}`);
console.log(`  megjelent:      ${vart.length - hianyzo.length}`);

if (hianyzo.length > 0) {
  console.log("");
  console.error(
    `FAIL: ${hianyzo.length} vart nyom NEM jelent meg a naploban -- a kor NEM MERT SEMMIT:`,
  );
  for (const sor of hianyzo) console.error(`    ${JSON.stringify(sor)}`);
  console.error("");
  console.error(
    "Ez NEM azt jelenti, hogy a fejlesztes elromlott: azt, hogy a szandekos",
  );
  console.error(
    "rontas nem sult el, tehat a meres eredmenye nem hasznalhato. A piros ITT",
  );
  console.error("a helyes szin, es ezert jon rola ertesites.");
  process.exit(1);
}

console.log("  rendben: minden vart nyom megjelent, a kor mert valamit.");

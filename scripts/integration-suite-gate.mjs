#!/usr/bin/env node
/**
 * Refuses an integration run that did not actually run its suites.
 *
 * WHY THIS EXISTS. On 2026-09-15 the leftover assertions landed in twenty-six
 * integration suites, and the only thing proving they had EXECUTED was a person
 * opening the run log and reading the summary by hand. A check that works only
 * when somebody remembers to look at it is a habit, not a gate.
 *
 * AND THE OBVIOUS SIGNAL IS THE WRONG ONE. `# skipped` counts skipped TESTS,
 * not skipped SUITES. Measured (node v22.23.2), both shapes in one run, so the
 * counter is known to work and the zero is its meaning rather than a failure:
 *
 *     describe("...", { skip: true })   ok 1 - MINDEN KIHAGYVA # SKIP
 *                                       # suites 2  # skipped 0   <- ZERO
 *     it("...", { skip: true })             ok 2 - kihagyott teszt # SKIP
 *                                       # skipped 1
 *
 * Every integration suite in this repository is gated at the DESCRIBE level
 * (`describe(name, { skip: !enabled }, ...)` via `integrationDatabaseGate`), so
 * a run without PostgreSQL reports `# skipped 0` while running nothing. That is
 * the exact case this gate exists for, and the counter is blind to it.
 *
 * WHAT IT READS INSTEAD, and both are needed because they fail differently:
 *
 *   the `# SKIP` directive on a TOP-LEVEL `ok` line
 *                           the suite was found and deliberately not run. It
 *                           says its own name, so the gate can too.
 *   a suite name that never appears at all
 *                           the file was never discovered, or its module threw
 *                           on load. Nothing in the output mentions it - the
 *                           only way to see it is to know what SHOULD be there.
 *
 * The expected names are not a hand-kept list: they are read from the sources,
 * one top-level `describe` per `*.integration.spec.ts`. A hand-kept list would
 * miss exactly the newest suite, which is the one nobody is watching yet.
 *
 * THIS CLOSES THE HOLE `tap-stream-gate.mjs` NAMES IN ITS OWN HEADER ("a suite
 * that was never discovered ... needs a count against an expected number").
 * It turned out a count is not enough and not the best available: a skipped
 * suite keeps the suite count (2 above, with one skipped), and a NAME can say
 * which one is missing where a number can only say that one is.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GYOKER_ALAP = "apps/api/src";

function hasznalat(uzenet) {
  console.error(`FAIL: ${uzenet}`);
  console.error(
    "HASZNALAT: node scripts/integration-suite-gate.mjs <tap-log> [--src <konyvtar>]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let gyoker = GYOKER_ALAP;
const pozicios = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--src") {
    gyoker = args[i + 1];
    if (!gyoker) hasznalat("a --src ertek nelkul all");
    i += 1;
    continue;
  }
  pozicios.push(args[i]);
}
const naploUt = pozicios[0];
if (!naploUt) hasznalat("hianyzik a TAP-naplo utja");

/** Minden `*.integration.spec.ts` a fa alatt. */
function specFajlok(konyvtar) {
  const ki = [];
  for (const nev of readdirSync(konyvtar)) {
    const ut = join(konyvtar, nev);
    if (statSync(ut).isDirectory()) ki.push(...specFajlok(ut));
    else if (nev.endsWith(".integration.spec.ts")) ki.push(ut);
  }
  return ki;
}

/**
 * A TOP-SZINTU `describe` NEVE, A FORRASBOL.
 *
 * Horgony a sor eleje: egy behuzott `describe` beagyazott, es a TAP-ban sem
 * top-szinten jelenik meg. A nyito idezojel harom alakja mind elofordul a
 * repoban (`"`, `'`, backtick), a backtick viszont CSAK akkor fogadhato el, ha
 * nincs benne behelyettesites: egy `${...}` nevet ez a gate nem tud elore
 * tudni, es ha csendben atengedne, pontosan egy nem figyelt suite keletkezne.
 */
function topDescribeNevek(forras) {
  const nevek = [];
  const minta = /^describe\(\s*\n?\s*(["'`])([\s\S]*?)\1/gm;
  let m;
  while ((m = minta.exec(forras)) !== null)
    nevek.push({ hatarolo: m[1], nev: m[2] });
  return nevek;
}

const fajlok = specFajlok(gyoker);
const varhato = new Map(); // nev -> fajl
const kinyerhetetlen = [];
for (const f of fajlok) {
  const nevek = topDescribeNevek(readFileSync(f, "utf8"));
  if (nevek.length === 0) {
    kinyerhetetlen.push(
      `${relative(process.cwd(), f)}: nincs top-szintu describe`,
    );
    continue;
  }
  for (const { hatarolo, nev } of nevek) {
    if (hatarolo === "`" && nev.includes("${")) {
      kinyerhetetlen.push(
        `${relative(process.cwd(), f)}: behelyettesitett describe-nev (${nev})`,
      );
      continue;
    }
    varhato.set(nev, relative(process.cwd(), f));
  }
}

/**
 * A HIANYZO NAPLO NEM HASZNALATI HIBA, HANEM LELET. Ha az elozo lepes elhasalt,
 * mielott barmit irt volna, akkor NULLA suite futott le -- pontosan az az eset,
 * amiert ez a kapu letezik. Egy `exit 2` (rossz hivas) itt elterelne: azt
 * sugallna, hogy a kapuval van baj, nem a futassal.
 */
let naplo;
try {
  naplo = readFileSync(naploUt, "utf8");
} catch (hiba) {
  console.error(`FAIL: a naplo nem olvashato (${naploUt}): ${hiba.message}`);
  console.error(
    "  Ha az elozo lepes irta volna, akkor el sem jutott odaig: nulla suite futott le.",
  );
  process.exit(1);
}

/**
 * A SZINKODOK ES A CI IDOBELYEG-ELOTAGJA LE. Enelkul a horgonyozott mintak
 * egyike sem illeszkedne: a GitHub minden sort `2026-09-15T15:15:18.1234567Z `
 * alakkal kezd, es a futtato szinez.
 */
const sorok = naplo
  .replace(/\x1b\[[0-9;]*m/g, "")
  .split("\n")
  .map((s) => s.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ""));

const TOP = /^(?:not )?ok \d+ - (.*?)\s*$/;
const futott = new Map(); // nev -> {skip}
for (const sor of sorok) {
  const m = TOP.exec(sor);
  if (!m) continue;
  let nev = m[1];
  let skip = false;
  const direktiva = / # (SKIP|TODO)\b.*$/.exec(nev);
  if (direktiva) {
    skip = direktiva[1] === "SKIP";
    nev = nev.slice(0, direktiva.index);
  }
  futott.set(nev.trim(), { skip });
}

const osszegzesek = [];
for (let i = 0; i < sorok.length; i += 1) {
  const m = /^# tests (\d+)$/.exec(sorok[i]);
  if (!m) continue;
  const blokk = sorok.slice(i, i + 8).join("\n");
  const szam = (kulcs) => {
    const t = new RegExp(`^# ${kulcs} (\\d+)$`, "m").exec(blokk);
    return t ? Number(t[1]) : null;
  };
  osszegzesek.push({
    tests: Number(m[1]),
    suites: szam("suites"),
    fail: szam("fail"),
    cancelled: szam("cancelled"),
    skipped: szam("skipped"),
  });
}

const bajok = [];
if (kinyerhetetlen.length > 0)
  bajok.push(
    `A gate nem tudja, mit kellene keresnie ${kinyerhetetlen.length} helyen:\n    ` +
      kinyerhetetlen.join("\n    ") +
      "\n  Egy suite, aminek a nevet nem lehet elore tudni, ELLENORIZETLEN lenne -- " +
      "ezert all meg itt, ahelyett hogy csendben kihagyna.",
  );

if (osszegzesek.length === 0)
  bajok.push(
    "A naploban EGYETLEN TAP-osszegzes sincs (`# tests`). A futtato el sem jutott odaig.",
  );

const hianyzo = [...varhato.entries()].filter(([nev]) => !futott.has(nev));
if (hianyzo.length > 0)
  bajok.push(
    `${hianyzo.length} suite NEM JELENT MEG a kimenetben (nem indult el, vagy a modulja betoltesnel dobott):\n    ` +
      hianyzo.map(([nev, f]) => `${nev}   (${f})`).join("\n    "),
  );

const kihagyott = [...varhato.entries()].filter(
  ([nev]) => futott.get(nev)?.skip,
);
if (kihagyott.length > 0)
  bajok.push(
    `${kihagyott.length} suite KIHAGYVA futott (# SKIP), tehat egyetlen allitasa sem mert semmit:\n    ` +
      kihagyott.map(([nev, f]) => `${nev}   (${f})`).join("\n    "),
  );

osszegzesek.forEach((o, i) => {
  if (o.skipped)
    bajok.push(
      `A(z) ${i + 1}. osszegzes ${o.skipped} KIHAGYOTT TESZTET jelent (# skipped).`,
    );
  if (o.cancelled)
    bajok.push(
      `A(z) ${i + 1}. osszegzes ${o.cancelled} MEGSZAKITOTT tesztet jelent (# cancelled).`,
    );
});

const futottVart = [...varhato.keys()].filter(
  (nev) => futott.has(nev) && !futott.get(nev).skip,
);
console.log(`INTEGRACIOS SUITE-KAPU  (${relative(process.cwd(), naploUt)})`);
console.log(
  `  forrasbol vart suite:  ${varhato.size}   (${fajlok.length} fajl a ${gyoker} alatt)`,
);
console.log(`  valoban lefutott:      ${futottVart.length}`);
console.log(`  TAP-osszegzes a naploban: ${osszegzesek.length}`);
for (const o of osszegzesek)
  console.log(
    `    tests ${o.tests}  suites ${o.suites}  fail ${o.fail}  cancelled ${o.cancelled}  skipped ${o.skipped}`,
  );

/**
 * A TOBBLET NEM HIBA, DE KIIRJUK. Egy atnevezett `describe` KETSZER jelenik meg
 * itt: hianyzokent a regi neven es tobbletkent az ujon -- a ket sor egyutt
 * mondja meg, hogy atnevezes tortent, nem eltunes.
 */
const tobblet = [...futott.keys()].filter((nev) => !varhato.has(nev));
if (tobblet.length > 0)
  console.log(`  a kimenetben, de nem a forrasban: ${tobblet.join(", ")}`);

if (bajok.length > 0) {
  console.error("");
  for (const b of bajok) console.error(`FAIL: ${b}`);
  process.exit(1);
}
console.log("  rendben: minden vart suite lefutott, egyik sem kihagyva.");

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A PARANCS EL TUD-E INDULNI -- ES EZ NEM UGYANAZ, MINT HOGY A TORZSE MUKODIK.
 *
 * === A MERT HIBA (acrobot, 2026-09-17 este, az ELES kontenerben) ===
 *
 *     node dist/imports/unas/unas-kapcsolat-ujraepites.cli.js
 *     -> Warning: Detected unsettled top-level await ... cli.js:221
 *     -> kilepesi kod 13, NULLA kimenet, nulla adatbazis-muvelet
 *
 * A parancs SOHA nem futott le. Az ok korkoros import volt: a belepesi pont
 * (`cli.ts`) egy top-level awaittel importalta a futtatot, a futtato pedig
 * STATIKUSAN importalta vissza a torzset ugyanabbol a fajlbol. Belepesi
 * pontkent a modul meg ertekeles alatt allt, tehat a masik oldal nem tudott
 * befejezodni: a ket varakozas egymasra mutatott, a hurok kiurult, a Node
 * kilepett.
 *
 * === AMIERT HAROM ZOLD PR ATMENT RAJTA (#802, #804, #819) ===
 *
 * A meglevo orzok a TORZSET merik (`runKapcsolatUjraepitesCli`), fixture-on
 * hivva. Egy fixture-on hivott fuggveny a modul-betoltesrol semmit nem tud. Az
 * utemezo utja kozben vegig ep volt, mert az kozvetlenul a futtatot importalja
 * -- vagyis a ket ut NEM volt egyenerteku, holott a kiemeles epp azert tortent,
 * hogy az legyen.
 *
 * Ezert ez a fajl KET dolgot mer, es a ketto MAS szintu:
 *
 *   a TUNET   a parancs kulon folyamatban elindul-e (kilepesi kod 0 es
 *             nem-ures kimenet)
 *   az OK     az import-iranyok egy iranyba mutatnak-e
 *
 * A tunet-meres akkor is elbukna, ha a kort valaki MAS alakban hozna vissza; az
 * ok-meres akkor is, ha a tunet epp elrejtozne egy masik Node-verzio alatt.
 */

/** A csomag gyokerehez kepest (`apps/api`), mert a teszt a `test-dist` alol fut. */
const FORDITOTT = "dist/imports/unas/unas-kapcsolat-ujraepites.cli.js";
const FORRAS = "src/imports/unas/unas-kapcsolat-ujraepites";

/**
 * A LEFORDITOTT PARANCS ALLAPOTA -- ES AMIERT EZ KULON LEPES.
 *
 * Ez a spec a `dist`-bol indit, a csomag `test` parancsa viszont a `test-dist`-et
 * torli es epiti ujra: a `dist`-hez SEM NEM NYUL, sem nem torli. Ez rendben van,
 * mert a repo sajat kapuja (`pnpm test`, illetve `turbo run test --filter=...`)
 * a `build` feladattol FUGG (`turbo.json`: test dependsOn ["build", "^build"]),
 * tehat ott a `dist` mindig friss.
 *
 * A RES A ROVIDITESBEN VAN: a `pnpm --filter @acropora/api test` a csomag nyers
 * npm-parancsat futtatja, kihagyva a fuggosegi grafot -- es akkor ez az allitas
 * egy HIANYZO vagy REGI `dist`-en fut.
 *
 * MERVE 2026-09-18, hianyzo `dist` mellett:
 *     pnpm --filter @acropora/api test              exit 1, "Cannot find module"
 *     turbo run test --filter=@acropora/api         exit 0, a build ujraepitette
 *
 * AMIERT EZ A NEHANY SOR MEGIS ITT ALL: a nyers hiba ROSSZ IRANYBA KULD. A
 * "Cannot find module" ugy nez ki, mint a sajat valtoztatasod hibaja, es ma ket
 * agens keresett tole nem letezo regressziot (nautilus es murena, fc174f47).
 * Nem uj vedelem tehat, hanem DIAGNOZIS: ugyanaz a bukas, megnevezett okkal.
 *
 * ES A HATARA: a repo sajat parancsaval ez az ag SOHA nem sul el, mert ott a
 * `dist` a futas elott epul. Ha megis elsul, az azt jelenti, hogy a hivas
 * kerulte meg a grafot -- nem azt, hogy a kod romlott el.
 */
function forditottAllapota(): string | null {
  if (!existsSync(FORDITOTT))
    return `a lefordított parancs NINCS MEG (${FORDITOTT})`;

  const forditottKora = statSync(FORDITOTT).mtimeMs;
  const regebbi = [".mag.ts", ".runner.ts", ".cli.ts"]
    .map((veg) => `${FORRAS}${veg}`)
    .filter((ut) => statSync(ut).mtimeMs > forditottKora);
  if (regebbi.length)
    return `a lefordított parancs RÉGEBBI, mint a forrása: ${regebbi.join(", ")}`;

  return null;
}

describe("a kapcsolat-újraépítés parancsa", () => {
  /**
   * A `--help` AZ EGYETLEN UT, amin az INDULAS adatbazis nelkul merheto. Minden
   * mas ag lekerdezessel kezd, es ebben a kontenerben nincs adatbazis -- egy
   * kapcsolati hiba pedig ELFEDNE azt, amit merni akarunk.
   */
  it("külön folyamatban elindul, és nem üres kimenettel tér vissza", () => {
    /*
      A DIAGNOZIS A FUTTATAS ELOTT All, nem utana: a `execFileSync` hibaja a
      LEFORDITOTT fajlrol szol, es elfedne, hogy a BUILD hianyzik.
    */
    const baj = forditottAllapota();
    assert.equal(
      baj,
      null,
      `${baj} -- ez NEM a kód hibája. A csomag \`test\` parancsa a \`dist\`-et nem építi; ` +
        "futtasd a repó saját alakjával: `turbo run test --filter=@acropora/api` (vagy `pnpm test`).",
    );

    const kimenet = execFileSync("node", [FORDITOTT, "--help"], {
      encoding: "utf8",
    });
    assert.ok(
      kimenet.trim().length > 0,
      "a parancs nulla kilépési kóddal, de ÜRESEN tért vissza",
    );
    assert.match(kimenet, /kapcsolat-ujraepites parancsa/);
  });

  /**
   * AZ OK, SZERKEZETILEG. A tunet-meres egy KONKRET Node-viselkedesen all (a
   * 13-as kilepes); ez a fuggetlen tole. Ha valaki barmelyik nyilat
   * megforditja, ez pirosodik -- meg akkor is, ha a `--help` veletlenul
   * mukodne.
   */
  it("az import-irányok egy irányba mutatnak", () => {
    const mag = readFileSync(`${FORRAS}.mag.ts`, "utf8");
    const futtato = readFileSync(`${FORRAS}.runner.ts`, "utf8");
    const parancs = readFileSync(`${FORRAS}.cli.ts`, "utf8");

    // POZITIV KONTROLL: rossz utvonalnal ures szovegen minden allitas zold.
    assert.ok(mag.length > 500 && futtato.length > 500 && parancs.length > 500);

    // A MAG nem tud sem a futtatorol, sem a parancsrol.
    assert.doesNotMatch(mag, /ujraepites\.(runner|cli)\.js/);
    // A FUTTATO a magbol vesz, a parancsrol nem tud.
    assert.match(futtato, /ujraepites\.mag\.js/);
    assert.doesNotMatch(futtato, /ujraepites\.cli\.js/);
    // A PARANCS a futtatot hivja, es nem exportal semmit (senki nem importalja).
    assert.match(parancs, /ujraepites\.runner\.js/);
    assert.doesNotMatch(parancs, /^export /m);

    /*
      ES A FUTTATO IMPORTJA STATIKUS, NEM `await import` -- ES EZT A SAJAT
      KALIBRACIOM KERTE.

      Visszaallitottam a kort ugy, ahogy eredetileg allt (a futtato importja
      DINAMIKUS, a `--help` elotte), es a fenti tunet-allitas ZOLD MARADT: a
      `--help` kilep, mielott a dinamikus import egyaltalan sorra kerulne.
      Vagyis a `--help` CSAK AKKOR bizonyit indulast, ha a modul betoltese maga
      feloldja a futtatot -- azt pedig a STATIKUS import teszi.

      Ket allitas tehat egymast tartja: a statikus import nelkul a tunet-meres
      disz lenne, a tunet-meres nelkul pedig ez csak egy stilus-szabaly.
    */
    assert.match(
      parancs,
      /^import \{ runKapcsolatUjraepites \} from "\.\/unas-kapcsolat-ujraepites\.runner\.js";$/m,
    );
    assert.doesNotMatch(parancs, /await import\(/);
  });
});

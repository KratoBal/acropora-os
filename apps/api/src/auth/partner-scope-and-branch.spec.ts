import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * EZ A TESZT A FORRAST OLVASSA, NEM A VISELKEDEST, es ez szandekos: az a hiba,
 * amit oriz, futasidoben NEM fogható meg fejlesztes kozben.
 *
 * A jogosultsagi szuronek `AND` agkent kell bekerulnie a lekerdezesbe, soha nem
 * kulcskent. Ket okbol (murena merese, 2026-08-27; nautilus merese, 2026-08-29):
 *
 * 1. A `where` objektumok literal-spreadekbol allnak, es a FELHASZNALOI szuro
 *    UGYANAZT a kulcsot hasznalja (`customerId` / `supplierId`). Egy
 *    objektum-literalban az azonos kulcs UTOLSO elofordulasa nyer, tehat egy
 *    kesobb spreadelt felhasznaloi szuro FELULIRNA a jogosultsagit -- es a hivo
 *    egy idegen `ownerId` parameterrel kikapcsolhatna a sajat szureset,
 *    hibauzenet nelkul.
 * 2. A listakban FELSO SZINTU `OR` is all (kereses). Egy `OR` ugyanazon a
 *    szinten azt jelenti, hogy a talalat barmelyik agtol atmegy: a jogosultsag
 *    "vagy" agga valna.
 *
 * Mindket hiba NEMA. A valasz szabalyos marad, csak tobb sort tartalmaz, mint
 * amirol barki tud.
 *
 * ES AMIT EZ A TESZT LAT, AMIT A FUTASIDEJU NEM (merve 2026-08-31, a
 * `partner-scope-endpoint.integration.spec.ts` kalibraciojaval). A futasideju
 * suite a kulcs-felulirast MEGFOGJA, de csak azokon a hivasokon, amik
 * felhasznaloi szurot is visznek: a szuro spreadkent PONTOSAN ket allitast
 * dont meg, es mind a ketto ilyen hivas. Ez a teszt ezzel szemben MINDEN
 * hivasi helyet nezi, akkor is, ha ma nincs ra olyan teszteset, ami a hibat
 * eloidezne.
 *
 * A KETTO TEHAT NEM DUPLIKACIO, hanem ket kulonbozo hatokor. Ha valaki az
 * egyiket folosleges masolatnak nezi es kiveszi, egy uj `where`-epito hely
 * orizetlenul marad.
 */

/**
 * A HALMAZ MINTA, NEM NEVSOR -- ES EZ A KULONBSEG A LENYEG (2026-09-22).
 *
 * Korabban harom fajlnev allt itt, kezzel. Egy nevsorra irt allitas a KOVETKEZO
 * uj fajlt nem latja, es pont az lesz az, ami kimarad: aki uj `where`-epito
 * helyet ir, nem ezt a specet olvassa eloszor.
 *
 * A glob ugyanazt a harom fajlt adja ma (merve), de holnap a negyediket is.
 */
async function forrasFajlok(): Promise<string[]> {
  const ki: string[] = [];
  for await (const entry of glob("src/**/*.ts"))
    if (!entry.endsWith(".spec.ts")) ki.push(entry);
  return ki.sort();
}

interface HivasiHely {
  fajl: string;
  helper: string;
  pozicio: number;
  elotte: string;
}

/**
 * A DEKLARACIOT NEM HIVASKENT SZAMOLJUK, ES EZT SEM NEVSORRAL OLDJUK MEG.
 *
 * A segedek sajat fajljaban (`partner-scope.util.ts`) a nevuk `export function
 * X(` alakban all. Kizarhatnam a fajlt NEV szerint, de azzal visszacsempesznem
 * ugyanazt a nevsort, amit az iment vettunk ki. Ehelyett az ALAKRA szurunk: amit
 * `function` vagy `const` elozi meg, az deklaracio, nem hivas.
 */
async function hivasiHelyek(): Promise<HivasiHely[]> {
  const ki: HivasiHely[] = [];
  for (const fajl of await forrasFajlok()) {
    const source = readFileSync(fajl, "utf8");
    for (const helper of SCOPE_HELPERS) {
      let from = 0;
      while (true) {
        const at = source.indexOf(`${helper}(`, from);
        if (at === -1) break;
        from = at + helper.length;
        const elotte = source.slice(Math.max(0, at - 120), at);
        if (/\b(function|const)\s+$/.test(elotte)) continue;
        ki.push({ fajl, helper, pozicio: at, elotte });
      }
    }
  }
  return ki;
}

/**
 * A DARABSZAM IS ALLITAS, A MERES DATUMAVAL -- nem `>=`, hanem PONTOS.
 *
 * UJRAMERVE 2026-09-22 (az egyseg-hatokor szelete): 14 hivasi hely
 * (service-assets 9, worksheets 4, suppliers 1). A definicios sorok NEM
 * szamitanak bele.
 *
 * MI JOTT AZ ELOZO MERES (13) OTA, ES MIERT -- nem elegendo a szamot atirni:
 *
 *   +1  `detailByQrToken`: a QR-ut 2026-09-22-ig NEM szurt sor-szinten. Balazs
 *       irta felul ("ne lassa", 2026-09-22 08:55:25 UTC); a reszletek a vegpont
 *       jegyzeteben allnak.
 *
 * ES AMI UGYANAZON A NAPON MEGJELENT, MAJD MERESRE ELTUNT: a cimke-ut egy
 * kulon helyszin-tengelyt kapott, aztan visszavettuk. Az indoka megdolt -- a
 * reszletek a tarolo `detailByLabelCode` jegyzeteben --, es vele egyutt a
 * `egysegTengelyAsset` seged is kikerult, mert nulla hivohelye maradt.
 *
 * MIERT PONTOS ES NEM ALSO KORLAT: egy `>=` alak nem veszi eszre, ha egy
 * hatokor-hivas ELTUNIK, amig a tobbi megvan. Es egy UJ hivas eseten sem szol,
 * pedig azt is meg kell nezni -- a szam atirasa az a pillanat, amikor valaki
 * ranez az uj helyre.
 *
 * HA EZ A SZAM VALTOZIK: ne csak ird at. Nezd meg, MELYIK hely jott vagy ment,
 * es a datumot is frissitsd, kulonben a kovetkezo olvaso egy regi merESre
 * hivatkozik.
 */
const VART_HIVASI_HELY = 14;

const SCOPE_HELPERS = [
  "scopeWhereForAndBranch",
  "scopeOwnWhereForAndBranch",
  // 2026-09-18: az eszkoz-lathatosag sajat fuggvenyt kapott (tulajdon VAGY sajat
  // helyszin). EZ A LISTA KEZZEL IRT, tehat egy uj hatokor-seged CSENDBEN kikerulne
  // az orzo alol -- ezert kerul ide ugyanabban a korben, amiben megszuletett.
  "assetVisibilityForAndBranch",
];

describe("a jogosultsági szűrő AND ágban áll, nem kulcsként", () => {
  it("MINDEN hatókör-hívás AND tömbön belül van, az egész fában", async () => {
    const hivasok = await hivasiHelyek();

    for (const { fajl, helper, pozicio, elotte } of hivasok) {
      // A hivast megelozo 120 karakterben ott kell allnia az `AND: [`
      // nyitasnak. Ha valaki spreadkent tenne be (`...scopeWhere(...)`),
      // ez a feltetel nem teljesul, es a teszt kiirja, melyik fajlban.
      assert.ok(
        /AND:\s*\[\s*$/.test(elotte.replace(/\s+$/, (m) => m)) ||
          elotte.includes("AND: ["),
        `${fajl}: a(z) ${helper} hívás nem AND ágban áll (pozíció ${pozicio})`,
      );
      assert.ok(
        !elotte.trimEnd().endsWith("..."),
        `${fajl}: a(z) ${helper} hívás SPREADELVE van, ami felülírható`,
      );
    }
  });

  /**
   * A DARABSZAM SAJAT ALLITAS, ES EZ TARTJA A FENTIT.
   *
   * A fenti ciklus URES halmazon ZOLDET adna: ha egy atnevezes utan a minta
   * nullat talal, az orzo sikert jelentene. Ez pontosan az a "meres, ami nem
   * tud elbukni", amit kerulunk -- es ez a sor az, ami elbuktatja.
   *
   * A masik irany ugyanennyire szamit: ha egy hatokor-hivas ELTUNIK, a szam
   * esik, es ez a sor pirosodik. Egy also korlat (`>= 3`) egyiket sem fogta meg.
   */
  it("a hívási helyek SZÁMA pontosan annyi, amennyit mértünk", async () => {
    const hivasok = await hivasiHelyek();

    assert.equal(
      hivasok.length,
      VART_HIVASI_HELY,
      `${hivasok.length} hatókör-hívást találtam, ${VART_HIVASI_HELY} a mért szám. ` +
        "Ha ez szándékos változás, nézd meg, MELYIK hely jött vagy ment, és " +
        "a mérés dátumát is írd át a konstans fölött.",
    );
  });

  /**
   * ES EGY KONTROLL A GLOBRA MAGARA: ha a fajl-gyujtes elromlik (rossz minta,
   * rossz munkakonyvtar), MINDEN fenti allitas ures halmazon futna. A
   * darabszam ezt mar megfogja, de ez a sor mondja meg az OKAT is -- kulonben
   * a "13 helyett 0" uzenetbol nem latszik, hogy a fajlok tuntek el, nem a
   * hivasok.
   */
  it("KONTROLL: a fájl-gyűjtés talál forrásfájlokat", async () => {
    const fajlok = await forrasFajlok();

    assert.ok(
      fajlok.length > 100,
      `csak ${fajlok.length} forrásfájlt találtam: a glob vagy a munkakönyvtár romlott el`,
    );
  });
});

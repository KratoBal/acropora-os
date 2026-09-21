import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A HELYSZIN-LETOLTO BEKOTESE -- FORRAS SZINTEN.
 *
 * MIERT NEM RENDERELESSEL: az `apps/mobile` alatt nincs komponens-teszt eszkoz.
 * Amit itt merunk, az a HIVAS ALAKJA; a MENET maga (lapozas, hibakezeles,
 * reszleges letoltes) valodi allitasokkal all a
 * `helyszin-letoltes-futtato.spec.ts`-ben.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "components",
  "offline",
  "HelyszinLetolto.tsx",
);
const FOKEPERNYO = join(__dirname, "..", "..", "..", "src", "app", "index.tsx");

const olvas = (ut: string) => readFileSync(ut, "utf8");
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("a helyszín-letöltő bekötése", () => {
  it("POZITÍV KONTROLL: a komponens olvasható és nem üres", () => {
    assert.ok(olvas(KEPERNYO).length > 2000);
  });

  /**
   * A KET LISTA A HELYSZINRE SZURVE, A SZERVEREN.
   *
   * MI PIROSIT: egy `departmentId` nelkuli hivas. Az eszkozoknel a partner
   * OSSZES eszkoze jonne le (idegen helyszinek adata a keszuleken), a
   * munkalapoknal ugyanez -- es a keszuleken levo masolat CSENDBEN tagabb
   * lenne, mint a felirata.
   */
  it("az eszköz- és a munkalap-lista a helyszínre szűrve kérdez", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /listAssets\(oldal, 50, "", departmentId\)/);
    assert.match(
      s,
      /listWorksheets\(\{\s*page: oldal,\s*pageSize: 100,\s*departmentId,?\s*\}\)/,
    );
  });

  /**
   * A TELJES ADATLAP AZ, AMIERT EZ A GOMB LETEZIK. Balazs szava: a kollega ma
   * "minden eszkoz adatlapjat meg kell nyitnia", mielott lemegy. A lista-sor
   * ehhez keves.
   *
   * MI PIROSIT: ha csak a listak mentodnek, reszletlap nelkul.
   */
  it("a részletlapok is lejönnek, nem csak a listasorok", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /eszkozReszlet: getAsset/);
    assert.match(s, /eszkozReszletMentese: rememberAssetDetail/);
    assert.match(s, /jegyReszlet: getServiceJob/);
    assert.match(s, /munkalapReszlet: getWorksheet/);
  });

  /**
   * GOMB, NEM VALTOKAPCSOLO -- es ez a kartya elso kikotese.
   *
   * Egy kezi Online/Offline kapcsolo BERAGAD: aki este elfelejti
   * visszabillenteni, annal napokig nem megy fel semmi, es errol nem tud.
   *
   * MI PIROSIT: egy `Switch` a komponensben, vagy a halozat-figyeles
   * atirasa. A masodik allitas ezert nezi a `connectivity` modult is.
   */
  it("gomb, nem váltókapcsoló, és a hálózat-figyelést nem bántja", () => {
    const s = kod(KEPERNYO);
    assert.ok(!/<Switch|from "@\/lib\/offline\/connectivity/.test(s));
    assert.match(s, /accessibilityRole="button"/);
  });

  /**
   * A VISSZAJELZES A FELADAT RESZE, ES A HIANYOS LETOLTES MAS SZINT KAP.
   *
   * MI PIROSIT: ha a ket ag ugyanazt a stilust hasznalja. Egy azonos kinezetu
   * doboz mellett a kulonbseget csak a SZOVEGBOL lehetne kiolvasni -- azt
   * pedig a pinceben siet az ember atsiklani.
   */
  it("a hiányos letöltés más dobozt kap, mint a kész", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /osszegzes\.teljes \? styles\.kesz : styles\.hianyos/);
    assert.match(s, /\{osszegzes\.cim\}/);
  });

  /**
   * ES A FOKEPERNYON TENYLEG OTT VAN, szervizes szemnek. Enelkul a fenti
   * allitasok egy olyan komponenst is zolden hagynanak, amit senki nem lat.
   */
  it("POZITÍV KONTROLL: a főképernyő kirajzolja, szervizes jogosultsággal", () => {
    assert.match(
      kod(FOKEPERNYO),
      /serviceCapabilities\.assetsView \? <HelyszinLetolto \/> : null/,
    );
  });
});

/**
 * A LETOLTES UTAN A KEPERNYOK UJRAOLVASSAK A MASOLATOT.
 *
 * A modul MEGLETE nem bizonyitja, hogy hivjak: a lista kulcsainak felsorolasa
 * onmagaban egy olyan valtozatban is ott allna, ami soha nem ervenytelenit.
 */
describe("a letöltés utáni újraolvasás", () => {
  it("a komponens VÉGIGMEGY a listán, nem egy kulcsot érvénytelenít", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /LETOLTES_UTAN_UJRAOLVASANDO\.map\(/);
    assert.match(
      s,
      /queryClient\.invalidateQueries\(\{ queryKey: \[\.\.\.queryKey\] \}\)/,
    );
  });

  /**
   * `onSettled`, NEM `onSuccess`: a RESZLEGES letoltes is hoz uj sorokat (egy
   * elhasalt reszletlap mellett a tobbi lement), es azokat ugyanugy latni kell.
   *
   * MI PIROSIT: az `onSuccess` alak. Az a valtozat a sikeres futasra jol
   * mukodne, es EPP a reszleges letoltesnel hagyna a kepernyot a regi
   * masolaton -- vagyis ott, ahol a szerelonek a legnagyobb szuksege van ra.
   */
  it("a részleges letöltés után IS újraolvas", () => {
    const s = kod(KEPERNYO);
    assert.match(s, /onSettled:/);
    assert.ok(
      !/onSuccess:/.test(s),
      "a részleges letöltés után nem olvasna újra",
    );
  });
});

/**
 * A LEHUZAS HIBAJA NE URESSEGET ADJON (Balazs merese, 2026-09-21).
 *
 * Ez a szakasz NEM a letoltot meri, hanem az ESZKOZ-LISTAT -- azert all itt,
 * mert ugyanannak a hibanak a masik fele: a letoltes feltolti a masolatot, a
 * lista pedig akkor is arra essen vissza, ha a halozati lekeres elhasal.
 *
 * A HATARA KIMONDVA: ez a forras szoveget olvassa. Azt NEM meri, hogy futas
 * kozben a `query.data` megmarad-e egy elbukott lehuzas utan -- azt csak
 * keszuleken lehet megnezni, es Balazstol kulon meres fut ra.
 */
describe("az eszköz-lista visszaesése a mentett másolatra", () => {
  const LISTA = join(
    __dirname,
    "..",
    "..",
    "..",
    "src",
    "app",
    "assets",
    "index.tsx",
  );

  it("a lista a MÁSOLATRA esik vissza, nem üresre", () => {
    assert.match(
      kod(LISTA),
      /const items = serverItems \?\? filterAssets\(cachedItems, search\)/,
    );
  });

  /**
   * ES A SAV KIMONDJA, HOGY A MASOLATOT LATJA. A `query.isError` beleszamit az
   * "online" megitelesbe: enelkul egy elhasalt lekeres utan a kepernyo
   * ONLINE-nak vallana magat, es a masolatbol jovo lista FRISS adatkent
   * latszana -- pontosan az a nema alak, ami miatt ez a kor letezik.
   */
  it("a sáv a hibás lekérést is offline-ként kezeli", () => {
    assert.match(kod(LISTA), /online: online && !query\.isError/);
  });
});

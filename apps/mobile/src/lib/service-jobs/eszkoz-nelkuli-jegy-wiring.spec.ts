import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * AZ ESZKÖZ NÉLKÜLI FELVITEL BEKÖTÉSE -- FORRÁS SZINTEN.
 *
 * MIÉRT NEM RENDERELÉSSEL: az `apps/mobile` alatt nincs komponens-teszt eszköz
 * (lásd a `new-service-job-screen.spec.ts` fejlécét). Amit itt mérünk, az a
 * HÍVÁS ALAKJA, nem a puszta név: egy nevet egy komment vagy egy `import` sor
 * is életben tartana.
 *
 * AMI NEM ITT DŐL EL: mit küldünk fel. Az a `uj-jegy-torzs.ts`-ben áll, és ott
 * VALÓDI állításokkal van mérve -- ez a fájl csak azt őrzi, hogy a képernyő
 * TÉNYLEG azt hívja.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "service-jobs",
  "new.tsx",
);

const forras = (() => {
  try {
    return readFileSync(KEPERNYO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESÉS hibája, nem a lefedettségé.`,
    );
  }
})();

describe("hibajegy gép nélkül: a képernyő bekötése", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(forras.length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  /**
   * A KORÁBBI ÁLLAPOT: `if (!assetId) return <Redirect href="/service-jobs" />;`
   * -- vagyis gép nélkül a képernyő VISSZADOBOTT. Ez volt az egyetlen ok, ami
   * miatt a telefonról nem lehetett gép nélküli jegyet nyitni; a szerver a
   * mérés szerint már fogadta.
   *
   * A NEGATÍV ÁLLÍTÁS MELLÉ POZITÍV IS JÁR: a másik két visszairányítás
   * (bejelentkezés, jogosultság) MEGMARAD, és ezt külön állítjuk -- különben
   * egy olyan változat is átmenne, ami az összes kaput kivette.
   */
  it("gép nélkül már nem dob vissza, de a jog-kapu megmarad", () => {
    assert.ok(
      !forras.includes(
        'if (!assetId) return <Redirect href="/service-jobs" />',
      ),
      "a gép nélküli visszairányítás még ott áll",
    );
    assert.match(
      forras,
      /!capabilities\?\.serviceJobsManage\)\s*\n?\s*return <Redirect href="\/" \/>/,
    );
  });

  it("a felküldött törzs a közös modulból jön", () => {
    /* A HÍVÁS ALAKJÁRA: a puszta nevet az `import` sor is életben tartaná. */
    assert.match(forras, /const torzs = ujJegyTorzse\(\{/);
    assert.match(forras, /const \{ operationId, payload \} = torzs;/);
  });

  /**
   * A PARTNER- ÉS HELYSZÍN-LEKÉRDEZÉS CSAK GÉP NÉLKÜL FUT. Gép mellől a
   * szerver vezeti le mindkettőt, tehát ott ez két fölösleges kör lenne --
   * térerő nélkül két fölösleges hiba.
   */
  it("a partner- és helyszín-lekérdezés a gép hiányához kötött", () => {
    assert.match(forras, /enabled: !assetId && status === "authenticated"/);
    assert.match(
      forras,
      /enabled:\s*\n?\s*!assetId && status === "authenticated" && Boolean\(partner\)/,
    );
  });

  /**
   * A HELYSZÍN-VÁLASZTÓ CSAK PARTNERREL EGYÜTT JELENIK MEG, mert a szerver is
   * ezt őrzi ("Helyszínt csak partnerrel együtt lehet megadni"). Egy mező,
   * amit úgyis elutasítanának, a helyszínen derülne ki.
   */
  it("a helyszín-választó a partner meglétéhez kötött", () => {
    assert.match(forras, /\{partner \? \(\s*\n\s*<>/);
  });
});

/**
 * AZ ESZKOZ-VALASZTO A GEP NELKULI UTON (9dfa03c7).
 *
 * Ugyanaz a hatar, mint fent: ezek a HIVAS ALAKJAT merik, nem a kepernyot.
 * Hogy MI megy fel, az a `uj-jegy-torzs.ts` valodi allitasaiban all.
 */
describe("hibajegy gép nélkül: az eszköz-választó", () => {
  /**
   * A SZURES A SZERVEREN FUT, A HELYSZINRE. A szerver a reszfat is beleveszi,
   * tehat egy nagyobb egyseget valasztva az alatta allo egysegek eszkozei is
   * jonnek -- ugyanaz a halmaz, amit a felvitel elfogad.
   *
   * MI PIROSIT: egy `departmentId` nelkuli hivas (a partner OSSZES eszkoze
   * jonne), vagy egy bongeszo-oldali szures a betoltott lista folott.
   */
  it("a lista a helyszínre szűrve, a szerverről jön", () => {
    assert.match(
      forras,
      /listAssets\(eszkozOldal, 50, eszkozKereses, departmentId\)/,
    );
  });

  /**
   * A VALASZTO CSAK HELYSZINNEL EGYUTT INDUL EL, es ez a szerver harmadik
   * orzojenek az alakja: az eszkoz csak helyszinnel egyutt ervenyes.
   */
  it("a lekérdezés a helyszín meglétéhez kötött", () => {
    assert.match(forras, /eszkozValasztoNyitva/);
    assert.match(forras, /Boolean\(departmentId\)/);
  });

  /**
   * A LAPOZO OTT ALL, ES EZ NEM DISZ.
   *
   * Elesen merve 2026-09-21: a legnagyobb reszfa 49 eszkoz, a lapmeret 50.
   * Ma befer -- es PONT EZERT veszelyes: egy uj eszkoz barmelyik alegysegbe
   * atviszi a hataron, es onnantol a valaszto CSENDBEN hianyos lenne.
   *
   * MI PIROSIT: a lapozo elhagyasa, vagy a lapszam elrejtese. Egy `1 / 2`
   * felirat az egyetlen jel, ami MEGELOZI a hianyt.
   */
  it("a választó lapozható, és a lapszám ki van írva", () => {
    assert.match(forras, /eszkozok\.data\?\.pagination\.totalPages/);
    assert.match(forras, /\{eszkozOldal\} \/ \{eszkozOldalakSzama\}/);
  });

  /**
   * A HELYSZIN VALTASA TORLI A VALASZTAST.
   *
   * A szerver a helyszin (reszfastul) eszkozeit fogadja el: egy ottfelejtett
   * valasztas a TELJES felvitelt elutasittatna, es a szerelo a helyszinen egy
   * olyan sor miatt allna meg, amit nem is lat.
   *
   * A SZAM SZAMIT: a torles MIND A NEGY helyen kell (partner-valtas,
   * partner-torles, helyszin-valtas, helyszin-torles). Egy jelenlet-illesztes
   * zolden atengedne, ha barmelyikbol kimaradna.
   */
  it("partner- vagy helyszín-váltásnál a választás törlődik", () => {
    const db = forras.split("setValasztottEszkozok([])").length - 1;
    assert.equal(
      db,
      4,
      `a törlés ${db} helyen áll; mind a négy váltásnál kell`,
    );
  });

  /**
   * A VALASZTOTT ESZKOZ A NEVET IS VISZI, NEM CSAK AZ AZONOSITOT.
   *
   * MIERT: a valasztott eszkoz egy KESOBBI lapon vagy egy szukebb keresesben
   * mar nem latszik a listaban. Ha csak az azonositot tartanank, a szerelo egy
   * szamot latna a valaszto feliratan, vagy semmit.
   */
  it("a választott eszközök neve is látszik a feliraton", () => {
    assert.match(forras, /valasztottEszkozok\s*\.map\(\(item\) => item\.nev\)/);
  });

  /**
   * ES A TORZS TENYLEG MEGKAPJA. Enelkul a fenti ot allitas egy olyan
   * valasztot is zolden hagyna, ami sehova nem kuldi el, amit kivalasztottak.
   */
  it("POZITÍV KONTROLL: a kiválasztott eszközök a törzsbe kerülnek", () => {
    assert.match(
      forras,
      /assetIds: valasztottEszkozok\.map\(\(item\) => item\.id\)/,
    );
  });
});

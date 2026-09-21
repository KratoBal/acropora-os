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

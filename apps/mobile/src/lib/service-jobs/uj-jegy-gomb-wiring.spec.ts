import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * AZ "ÚJ HIBAJEGY" GOMB BEKÖTÉSE -- FORRÁS SZINTEN.
 *
 * MIÉRT NEM RENDERELÉSSEL: az `apps/mobile` alatt nincs komponens-teszt eszköz,
 * a képernyő pedig `@/` alakú importokat használ, amiket a teszt-fordító nem
 * old fel. Ugyanaz a korlát, amit a `new-service-job-screen.spec.ts` fejléce
 * kimond -- és ugyanaz a válasz: a HÍVÁS ALAKJÁRA mérünk, nem a puszta névre,
 * mert azt egy komment vagy egy `import` sor is zölden tartaná.
 *
 * A teszt a `test-dist` alól fut, ezért lép ki hármat a csomag gyökeréig.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "service-jobs",
  "index.tsx",
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

describe("új hibajegy a Hibajegyek menüből", () => {
  /**
   * POZITÍV KONTROLL: a fájl olvasható és nem csonka. Enélkül minden lenti
   * állítás egy üres szövegen futna, és a hiányt sikernek olvasnánk.
   */
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(forras.length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  it("a gomb a felvitel ÚTJÁT hívja, nem beírt útvonalat", () => {
    /* A HÍVÁS ALAKJÁRA: a puszta nevet az `import` sor is életben tartaná. */
    assert.match(forras, /router\.push\(ujJegyEszkozzel\(asset\.id\)\)/);
  });

  /**
   * A GOMB CSAK ANNAK JELENIK MEG, AKI JEGYET IS NYITHAT.
   *
   * A felvitel képernyője `serviceJobsManage` nélkül visszairányít
   * (`new.tsx`), tehát egy mindenkinek mutatott gomb némán visszadobná a
   * szerelőt a kezdőlapra -- hibaüzenet nélkül, ami a helyszínen
   * megkülönböztethetetlen egy elromlott gombtól.
   */
  it("a gombot a jegy-nyitási jog kapuzza", () => {
    assert.match(forras, /capabilities\?\.serviceJobsManage \? \(/);
  });

  /**
   * A VÁLASZTÓ CSAK KINYITVA TÖLT BE LISTÁT. Egy alapból futó lekérdezés
   * minden lista-megnyitásnál egy fölösleges kört vinne, térerő nélkül pedig
   * egy fölösleges hibát.
   */
  it("az eszköz-lekérdezés a választó nyitott állapotához kötött", () => {
    assert.match(forras, /enabled:\s*\n?\s*ujJegyNyitva &&/);
  });

  /**
   * A RÉGI MONDAT NEM MARADHAT OTT, ÉS EZ NEM SZÉPÍTÉS: azt állította, hogy
   * új jegyet CSAK a gép adatlapjáról lehet nyitni. Egy felirat, ami
   * ellentmond a fölötte álló gombnak, rosszabb a hiányzó feliratnál.
   *
   * A NEGATÍV ÁLLÍTÁS MELLÉ POZITÍV IS KELL (a fenti kontroll a fájlra szól,
   * ez a MONDATRA): az új szöveg megléte bizonyítja, hogy a keresés meg tudja
   * találni ezt a bekezdést, amikor ott van.
   */
  it("a régi, kizáró mondat eltűnt, és az új a helyén van", () => {
    assert.ok(
      !forras.includes("Új jegyet a gép adatlapjáról nyithatsz"),
      "a régi, kizáró mondat még ott áll",
    );
    assert.match(forras, /és új jegy is nyitható/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A JEGY-KEPERNYO KET VARRATA -- FORRAS SZINTEN.
 *
 * MIERT NEM RENDERELESSEL: az `apps/mobile` alatt nincs komponens-teszt eszkoz,
 * a kepernyo pedig `@/` alaku importokat hasznal, amiket a teszt-fordito nem
 * old fel (`tsconfig.test.json`-ban nincs `paths`). Ami itt eldol es SEHOL
 * MASHOL nem merheto: hogy a fenykep a JEGY utjara megy-e.
 *
 * MIERT ER EZ BARMIT: a ket varrat mindegyike egy MASOLASSAL romlana el. A
 * kepernyo az eszkoz-felvitel kepernyojerol szuletett, ahol ugyanezen a ket
 * helyen `asset` all. Egy atvett sor, amit elfelejtenek atirni, a jegy kepeit
 * az ESZKOZ-vegpontra vinne -- es az a hiba akar 201-et is adhatna.
 */
/**
 * A TESZT A `test-dist` ALOL FUT, nem a forrasfabol: az ut ezert lep ki harmat
 * (a csomag gyokereig), es onnan megy be a `src` ala. A szomszed orzo
 * (`worksheet-line-offline.spec.ts`) ugyanezt az alakot hasznalja.
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
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
})();

describe("az új hibajegy képernyője és a fényképek", () => {
  it("a forrás betöltődött, és tényleg a jegy-nyitó képernyő", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy ures vagy masik fajl mellett is
    // zold lenne minden lenti allitas.
    assert.equal(forras.length > 2000, true);
    assert.match(forras, /saveOrQueue\(\{/);
    assert.match(forras, /enqueueServiceJobCreate\(\{/);
  });

  it("a sorba tett kép a JEGY fajtáját kapja, nem az eszközét", () => {
    /*
      MI PIROSIT: `entityType: "asset"` vagy a mezo elhagyasa. A sor ebbol
      tudja, melyik vegpontra kell kuldeni a kepet, amint a jegy megkapta az
      azonositojat.
    */
    assert.match(
      forras,
      /enqueuePhoto\(\{ \.\.\.input, entityType: "service-job" \}\)/,
    );
  });

  it("a MOST felmenő kép a jegy végpontjára megy", () => {
    /*
      A ket ut KULON allitast kap: a sorba tetel es az azonnali feltoltes ket
      kulon sor, es az egyik javitasa elfedne a masik hianyat.

      MI PIROSIT: `uploadAssetDocuments` vagy `uploadWorksheetDocuments` a
      `terv.ownerId` mellett.
    */
    assert.match(forras, /await uploadServiceJobPhotos\(\s*terv\.ownerId/);
  });

  it("az elbukott képfeltöltés ITT TARTJA a képernyőt", () => {
    /*
      A `saved` ag kulonben azonnal atlep a jegy lapjara, es a "a fenykep nem
      ment fel" mondat egy MAR ELHAGYOTT kepernyore kerulne -- a szerelo semmit
      nem latna abbol, hogy a kepe sehol nincs.

      MI PIROSIT: a `maradjunk` ag torlese az `onSuccess`-bol.
    */
    assert.match(
      forras,
      /if \(outcome\.type === "saved" && photo\.maradjunk\) return;/,
    );
  });
});

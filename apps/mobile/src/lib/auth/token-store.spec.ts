import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A TAROLO MAGA NEM UNIT-TESZTELHETO: az `expo-secure-store` natív runtime-ot
 * igenyel, es `node --test` alatt nem viselkedik sehogy. Amit MEG LEHET merni,
 * az a FORRASA -- es epp az az egy tulajdonsag, amin a kijelentkezes biztonsaga
 * all.
 */

/**
 * A FORRAS UTJA A LEFORDITOTT HELYROL VISSZAFELE.
 *
 * A spec `test-dist/lib/auth/` alol fut, a forras `src/lib/auth/` alatt all --
 * `__dirname` tehat a leforditott helyre mutat, es egy `join(__dirname, ...)`
 * alak a `.ts`-t ott keresi, ahol soha nincs. (Elsore pontosan igy irtam, es a
 * spec ENOENT-tel hasalt el.)
 */
const FORRAS_UT = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "auth",
  "token-store.ts",
);

function olvasForras(): string {
  try {
    return readFileSync(FORRAS_UT, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni a forrast: ${FORRAS_UT}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig nem mondanak semmit.`,
    );
  }
}

const forras = olvasForras();

describe("a munkamenet-tároló szerkezete", () => {
  it("a forrás betöltődött", () => {
    // ISMERT POZITIV KONTROLL: egy ures vagy rossz utrol olvasott fajl minden
    // lenti allitast teljesitene -- nulla kulcs, nulla minden.
    assert.equal(forras.length > 800, true);
    assert.match(forras, /SecureStore/);
  });

  it("PONTOSAN EGY SecureStore kulcsot használ", () => {
    /*
      EZ AZ ALLITAS A KIJELENTKEZES BIZTONSAGA.

      A `clearSession` egyetlen rekordot torol. Amig minden -- token, lejarat,
      profil, az ellenorzes ideje -- ebben az EGY rekordban all, a kijelentkezes
      mindet viszi, es ezt nem lehet elfelejteni.

      MI PIROSIT: egy masodik kulcs bevezetese. Az onmagaban nem hiba, de kulon
      torlest igenyel -- es ha az elmarad, a kovetkezo ember a telefonon az elozo
      kollega nevet es jogkoret latja, hibauzenet nelkul, ugy, mintha be lenne
      jelentkezve.
    */
    const kulcsok = [...forras.matchAll(/["'`]acropora\.[a-z-]+["'`]/g)].map(
      (m) => m[0],
    );
    assert.deepEqual(kulcsok, ['"acropora.auth-session"']);
  });

  it("a törlés ugyanazt a kulcsot törli, amit a mentés ír", () => {
    // Ket kulon konstans ugyanarra a nevre ugyanaz a csapda, csak lassabban:
    // az egyik atirasa a masikat nem koveti.
    const konstansok = [...forras.matchAll(/const\s+([A-Z_]+_KEY)\s*=/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(konstansok, ["SESSION_KEY"]);
    assert.match(forras, /deleteItemAsync\(SESSION_KEY\)/);
    assert.match(forras, /setItemAsync\(SESSION_KEY/);
  });
});

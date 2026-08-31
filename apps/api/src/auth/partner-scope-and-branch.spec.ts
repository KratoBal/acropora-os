import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
 * amirol barki tud -- ezert nem eleg egy futasideju teszt, ami a mai adaton zold.
 */

const FILES = [
  "src/service-assets/service-assets.repository.ts",
  "src/worksheets/worksheets.repository.ts",
  "src/suppliers/suppliers.repository.ts",
];

const SCOPE_HELPERS = ["scopeWhereForAndBranch", "scopeOwnWhereForAndBranch"];

describe("a jogosultsági szűrő AND ágban áll, nem kulcsként", () => {
  for (const file of FILES) {
    const source = readFileSync(file, "utf8");

    it(`${file}: minden hatókör-hívás AND tömbön belül van`, () => {
      for (const helper of SCOPE_HELPERS) {
        let from = 0;
        while (true) {
          const at = source.indexOf(`${helper}(`, from);
          if (at === -1) break;
          from = at + helper.length;

          // A hivast megelozo 120 karakterben ott kell allnia az `AND: [`
          // nyitasnak. Ha valaki spreadkent tenne be (`...scopeWhere(...)`),
          // ez a feltetel nem teljesul, es a teszt kiirja, melyik fajlban.
          const before = source.slice(Math.max(0, at - 120), at);
          assert.ok(
            /AND:\s*\[\s*$/.test(before.replace(/\s+$/, (m) => m)) ||
              before.includes("AND: ["),
            `${file}: a(z) ${helper} hívás nem AND ágban áll (pozíció ${at})`,
          );
          assert.ok(
            !before.trimEnd().endsWith("..."),
            `${file}: a(z) ${helper} hívás SPREADELVE van, ami felülírható`,
          );
        }
      }
    });
  }

  /**
   * A teszt sajat kontrollja: ha a haromból egyikben sem lenne hatokor-hivas,
   * a fenti ciklus URESEN futna le es zoldet adna. Ez pontosan az a "meres,
   * ami nem tud elbukni", amit kerulni akarunk.
   */
  it("a teszt talált is hatókör-hívást, nem üres halmazon futott", () => {
    const total = FILES.reduce((sum, file) => {
      const source = readFileSync(file, "utf8");
      return (
        sum +
        SCOPE_HELPERS.reduce(
          (inner, helper) => inner + source.split(`${helper}(`).length - 1,
          0,
        )
      );
    }, 0);
    // HAROM, NEM NEGY, es az indok nem szamtani: a negy listaszuro kozul a
    // `suppliers/:id/units` NEM `where`-rel szur, hanem az UTVONAL-parametert
    // egyezteti (`rowIsScopeOwner`), mert ott nincs mit szurni -- maga a
    // parameter a tulajdonos. Ha ez a szam valaha 4 lesz, az azt jelenti, hogy
    // valaki a `units`-ot is where-re vitte at: akkor ezt a sort ES az indokot
    // egyutt kell atirni.
    assert.ok(
      total >= 3,
      `csak ${total} hatókör-hívást találtam a where-építő helyeken, várhatóan 3-at`,
    );
  });
});

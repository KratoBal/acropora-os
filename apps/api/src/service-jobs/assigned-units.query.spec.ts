import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * EGY FORRAS A LATHATOSAGI EGYSEGEKRE.
 *
 * Ket taroló visel `assignedUnitIds` nevu metodust, es mind a ketto ugyanannak a
 * `serviceJobVisibilityFor` fuggvenynek a bemenete. 2026-09-22-ig KULONBOZTEK: az
 * egyik kibontotta a reszfat, a masik nem. A kulonbseget semmi nem merte, mert
 * minden spec DUPLAT ad az `assignedUnitIds` helyere -- egy dupla nem tud
 * kulonbseget tenni ket megvalositas kozott, amelyek egyiket sem futtatja.
 *
 * FORRAST OLVAS, NEM VISELKEDEST, es ez kimondott hatar: mindket metodus a
 * modul-szintu `prisma` peldanyt hasznalja, tehat adatbazis nelkul a
 * viselkedesuk nem merheto. A CI integracios keszlete meri; ez az allitas addig
 * azt tartja, hogy a ket torzs UGYANAZT a fuggvenyt hivja.
 */
describe("a láthatósági egységek egyetlen forrásból jönnek", () => {
  const API = join(new URL("../../", import.meta.url).pathname, "src");

  /** A METODUS TORZSE, NEM A FAJL. Enelkul egy barhol allo emlites is atmenne. */
  function metodusTorzse(forras: string, fejlec: string): string {
    const kommentNelkul = forras
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const kezdet = kommentNelkul.indexOf(fejlec);
    assert.notEqual(
      kezdet,
      -1,
      `nem találtam a metódust: ${fejlec} -- a horgony romlott el, nem a kód`,
    );
    let melyseg = 0;
    for (let i = kezdet; i < kommentNelkul.length; i += 1) {
      const ch = kommentNelkul[i];
      if (ch === "{") melyseg += 1;
      else if (ch === "}") {
        melyseg -= 1;
        if (melyseg === 0) return kommentNelkul.slice(kezdet, i + 1);
      }
    }
    assert.fail(
      "a metódus törzse nem záródik -- a kivágás kicsúszna a fájl végéig",
    );
  }

  const TAROLOK = [
    ["service-jobs.repository.ts", "async assignedUnitIds(userId: string)"],
    ["service-job-package.repository.ts", "assignedUnitIds(userId: string)"],
  ] as const;

  it("mindkét tároló a közös lekérdezést hívja, saját változat helyett", () => {
    for (const [fajl, fejlec] of TAROLOK) {
      const torzs = metodusTorzse(
        readFileSync(join(API, "service-jobs", fajl), "utf8"),
        fejlec,
      );
      assert.match(
        torzs,
        /assignedUnitIdsFor\(/,
        `${fajl}: a metódus nem a közös lekérdezést hívja`,
      );
      assert.doesNotMatch(
        torzs,
        /userWorksheetDepartment/,
        `${fajl}: saját lekérdezést épít a közös helyett -- a két törzs újra szétválhat`,
      );
    }
  });

  /**
   * ES A KIBONTAS ITT DOL EL, NEM A HIVOBAN.
   *
   * A kozos lekerdezes akkor er valamit, ha TENYLEG kibont: enelkul a ket taroló
   * ugyanazt a HIANYOS listat adna, es a parositas zolden allitana, hogy
   * rendben vannak.
   */
  it("a közös lekérdezés kibontja a részfát", () => {
    const forras = readFileSync(
      join(API, "service-jobs", "assigned-units.query.ts"),
      "utf8",
    );
    const kommentNelkul = forras
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.match(kommentNelkul, /expandAssignedUnits\(/);
  });
});

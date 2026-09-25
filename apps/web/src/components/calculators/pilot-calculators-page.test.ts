import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A "KALKULÁTOROK" OLDAL KÖTÉSE A BELSŐ WEBEN -- FORRÁS-SZÖVEG ALAPÚ MÉRÉS,
 * ugyanaz a minta, mint a `portal-wiring.spec.ts` "a Kalkulátorok kötése"
 * blokkja (`apps/partner`), csak itt vitest-tel fut (ld.
 * `pilot-worksheet-detail-page-edit-buttons.test.ts` fejlécét arról, hogy
 * ez az `apps/web` saját node:test helyetti egyenértékese).
 *
 * A `CalculatorCard` SAJÁT viselkedését (nincs-adagolás üzenet, nincs
 * `useAuth`/felület-specifikus API-hívás) a `packages/ui/src/calculator-
 * card.test.ts` méri -- ez a fájl csak azt, hogy EZ AZ OLDAL a HELYES
 * függvényt, a HELYES mezőkkel és a HELYES (belső, `aquariumsApi`) klienssel
 * hívja, a portál `partnerApi`-ja helyett.
 *
 * A KÉPLETEK SAJÁT, VISELKEDÉS-ALAPÚ TESZTJE a
 * `packages/aquarium-calc/src/reef-chemistry.test.ts`-ben áll.
 */

const OLDAL = join(
  process.cwd(),
  "src",
  "components",
  "calculators",
  "pilot-calculators-page.tsx",
);

function olvas(): string {
  return readFileSync(OLDAL, "utf8");
}

/** A megjegyzéseket kivágó forrás-szöveg, hogy egy komment ne adjon hamis találatot. */
function kod(): string {
  return olvas()
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

describe("a Kalkulátorok oldal kötése (apps/web)", () => {
  it("POZITÍV KONTROLL: a fájl olvasható és nem üres", () => {
    expect(olvas().length).toBeGreaterThan(500);
  });

  it("a belső, jogosultsághoz kötött aquariumsApi-t hívja, nem a portál partnerApi-ját", () => {
    const s = kod();
    expect(s).toMatch(/aquariumsApi\s*\n?\s*\.list\(/);
    expect(s).toMatch(/aquariumsApi\s*\n?\s*\.listMeasurements\(/);
    expect(s).not.toMatch(/partnerApi/);
  });

  it("a saját aquariums.view jogosultsággal véd, hasPermission(session.user, ...) mintán", () => {
    const s = kod();
    expect(s).toMatch(
      /hasPermission\(session\.user,\s*PERMISSIONS\.AQUARIUMS_VIEW\)/,
    );
    expect(s).toMatch(/if \(!canView\)/);
  });

  it("mindhárom kalkulátor a megfelelő @acropora/aquarium-calc függvényt hívja", () => {
    const s = kod();
    expect(s).toMatch(
      /import\s*\{\s*\n?\s*alkalinityElevation,\s*\n?\s*calciumElevation,\s*\n?\s*magnesiumElevation,?\s*\n?\s*\}\s*from\s*"@acropora\/aquarium-calc"/,
    );
    expect(s).toMatch(/calciumElevation\(\{/);
    expect(s).toMatch(/magnesiumElevation\(\{/);
    expect(s).toMatch(/alkalinityElevation\(\{/);
  });

  it("a magnézium kártya a választott só szerint MGCL2 vagy MGSO4 sót küld", () => {
    const s = kod();
    expect(s).toMatch(/"MGSO4_HEPTAHYDRATE"/);
    expect(s).toMatch(/"MGCL2_HEXAHYDRATE"/);
  });

  /**
   * A MÁRKÁS TERMÉKEK VÉGLEGESEN KIMARADNAK, ugyanúgy, mint a portálon --
   * ez a döntés az egész funkcióra szól, nem csak az első hívóra.
   */
  it("egyetlen márkás termék neve sem szerepel a kalkulátor-oldal kódjában", () => {
    const oldalNyers = olvas();
    for (const brandName of [
      "Kalkwasser",
      "B-Ionic",
      "Seachem",
      "Reef Builder",
    ]) {
      expect(oldalNyers).not.toMatch(new RegExp(brandName));
    }
  });

  it("mindhárom kalkulátor grammban ad eredményt", () => {
    const s = kod();
    const resultUnitMatches = [...s.matchAll(/resultUnit="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(resultUnitMatches.length).toBeGreaterThanOrEqual(3);
    for (const unit of resultUnitMatches) expect(unit).toBe("g");
  });

  /**
   * A TELJES AKVÁRIUM-LISTA, NEM A HÍVÓ SAJÁT LISTÁJA -- eltérés a
   * portáltól SZÁNDÉKOSAN: a belső felhasználó, aki `aquariums.view` jogot
   * kap, az Akváriumok listán is mindet látja, itt sem szűkebb.
   */
  it("a belső oldal a teljes, jogosultsághoz kötött akvárium-listát kéri le (nem a hívóra szűkített)", () => {
    const s = kod();
    expect(s).toMatch(/aquariumsApi\s*\n?\s*\.list\(token,\s*listQuery/);
  });
});

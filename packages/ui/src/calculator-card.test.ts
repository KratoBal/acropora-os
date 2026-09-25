import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A `CalculatorCard` FELÜLET-FÜGGETLENSÉGÉT MÉRŐ ÁLLÍTÁSOK -- áthozva
 * `apps/partner/src/lib/portal-wiring.spec.ts`-ből 2026-09-25-én, amikor a
 * komponens maga is ide (`packages/ui`) költözött, mert MÁR két felület
 * (`apps/partner`, `apps/web`) hívja ugyanazt a fájlt. A minta és az indok
 * ugyanaz, mint a portál saját forrás-szöveges specjeiben: a FORRÁS
 * SZÖVEGÉT olvassuk, nem futtatjuk a komponenst -- ehhez a csomaghoz nincs
 * DOM-os teszt-futtató (ld. a mobil forrás-olvasó specjeinek azonos
 * kikötését).
 */

const KARTYA = join(process.cwd(), "src", "calculator-card.tsx");

function olvas(ut: string): string {
  return readFileSync(ut, "utf8");
}

/** A megjegyzéseket kivágó forrás-szöveg, hogy egy komment ne adjon hamis találatot. */
function kod(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

describe("a CalculatorCard felület-függetlensége", () => {
  it("POZITÍV KONTROLL: a fájl olvasható és nem üres", () => {
    assert.ok(
      olvas(KARTYA).length > 500,
      `${KARTYA}: üres vagy gyanúsan rövid`,
    );
  });

  /**
   * A KÁRTYA NEM HÍV `useAuth`-OT ÉS NEM ISMER FELÜLET-SPECIFIKUS API-T --
   * Balázs kérése (2026-09-25): a kártya önmagában, jogosultság nélkül is
   * telepíthető legyen egy jövőbeli nyilvános felületre. Az OLDAL (mindkét
   * mai hívónál: `apps/partner/.../calculators-page.tsx` és az `apps/web`
   * párja) ismerheti a saját `useAuth`-ját és API-kliensét, a kártya NEM --
   * ezért az import-blokk csak `react`-ra, `@acropora/aquarium-calc`-ra és
   * a csomag saját, relatív fájljaira hivatkozhat, `@/`-os (alkalmazás-
   * specifikus alias) importra soha.
   */
  it("a kártya nem hív useAuth-ot és nem importál `@/`-os, felület-specifikus modult", () => {
    const s = kod(olvas(KARTYA));
    assert.doesNotMatch(s, /useAuth/);
    assert.doesNotMatch(s, /from\s+"@\//);
    assert.doesNotMatch(s, /partnerApi/);
  });

  it("a nincs-adagolás állapot a szükséges-mennyiség panelen kimondott üzenetet ad, nem üres számot", () => {
    const s = kod(olvas(KARTYA));
    assert.match(s, /"no-dosing-needed"/);
    assert.match(s, /nincs szükség\s+adagolásra/i);
  });
});

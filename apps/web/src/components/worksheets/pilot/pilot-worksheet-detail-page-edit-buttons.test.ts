import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A KÉT "SZERKESZTÉS" GOMB STÍLUSA (Figma-igazítás, 2026-09-25).
 *
 * A `pilot-worksheet-detail-page.tsx`-nek nincs saját render-alapú tesztje
 * (a fájl maga sem rendelkezik ilyennel -- ez korábbi hiány, nem ennek a
 * körnek a tárgya, és a teljes komponens felfuttatása több beágyazott
 * widget hívását igényelné, ami túlmutat egy kételemes gomb-stílus
 * javításán). Ez a spec ezért FORRÁS-SZÖVEG alapján méri a két érintett
 * gombot -- ugyanaz a minta, mint a `portal-wiring.spec.ts` családban
 * (`apps/partner`), csak itt vitest-tel, mert `apps/web` tesztje ezt fut.
 *
 * A terv (`exchange/figma-telefon-make-12/src/MunkalapokScreen.tsx`,
 * `MunkalapDetail`) a "Szerkesztés" gombot PRIMARY (teli teal) színnel és
 * ceruza-ikonnal adja, a régi kód `variant="secondary"`-vel, ikon nélkül.
 */

const FILE = join(
  process.cwd(),
  "src",
  "components",
  "worksheets",
  "pilot",
  "pilot-worksheet-detail-page.tsx",
);

function forras(): string {
  return readFileSync(FILE, "utf8");
}

describe("a munkalap adatlap Szerkesztés gombjai a terv szerinti stílust kapják", () => {
  it("POZITÍV KONTROLL: a fájl tényleg tartalmazza mindkét gomb szövegét", () => {
    const kod = forras();
    expect(kod).toMatch(/Szerkesztés/);
    expect(kod).toMatch(/Tételek szerkesztése/);
  });

  it("a fejléc melletti 'Szerkesztés' gomb primary, ceruza ikonnal", () => {
    const kod = forras();
    expect(kod).toMatch(
      /<Link href=\{`\/szerviz\/munkalapok\/\$\{worksheet\.id\}\/szerkesztes`\}>\s*<PilotButton variant="primary">\s*<Icon name="pencil"[^/]*\/>\s*Szerkesztés\s*<\/PilotButton>\s*<\/Link>/,
    );
  });

  it("a 'Tételek szerkesztése' gomb is primary, ceruza ikonnal", () => {
    const kod = forras();
    expect(kod).toMatch(
      /<PilotButton variant="primary">\s*<Icon name="pencil"[^/]*\/>\s*Tételek szerkesztése\s*<\/PilotButton>/,
    );
  });

  it("egyik Szerkesztés gomb sem maradt secondary", () => {
    const kod = forras();
    expect(kod).not.toMatch(/<PilotButton variant="secondary">\s*Szerkesztés/);
    expect(kod).not.toMatch(
      /<PilotButton variant="secondary">\s*Tételek szerkesztése/,
    );
  });
});

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
 * ceruza-ikonnal adta, a régi kód `variant="secondary"`-vel, ikon nélkül.
 *
 * 2026-11-26 ÓTA MINDKETTŐ SECONDARY, a ceruza marad (picasso képernyő-leltár 3.1, acrobot 62182): a lapon EGY fő gomb van, a
 * Következő lépés dobozé (piszkozatnál a Kiállítás és lezárás). Három teli gomb egy képernyőn nem mond fő irányt.
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

  it("a fejléc melletti 'Szerkesztés' gomb secondary, ceruza ikonnal", () => {
    const kod = forras();
    expect(kod).toMatch(
      /<Link href=\{`\/szerviz\/munkalapok\/\$\{worksheet\.id\}\/szerkesztes`\}>\s*<PilotButton variant="secondary">\s*<Icon name="pencil"[^/]*\/>\s*Szerkesztés\s*<\/PilotButton>\s*<\/Link>/,
    );
  });

  it("a 'Tételek szerkesztése' gomb is secondary, ceruza ikonnal", () => {
    const kod = forras();
    expect(kod).toMatch(
      /<PilotButton variant="secondary">\s*<Icon name="pencil"[^/]*\/>\s*Tételek szerkesztése\s*<\/PilotButton>/,
    );
  });

  it("egyik Szerkesztés gomb sem primary: a lap egyetlen fő gombja a Következő lépés dobozé", () => {
    const kod = forras();
    expect(kod).not.toMatch(
      /<PilotButton variant="primary">\s*(<Icon name="pencil"[^/]*\/>\s*)?Szerkesztés/,
    );
    expect(kod).not.toMatch(
      /<PilotButton variant="primary">\s*(<Icon name="pencil"[^/]*\/>\s*)?Tételek szerkesztése/,
    );
  });
});

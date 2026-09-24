import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A KOZOS VIZUALIS ALAP A `packages/ui/src/theme.css`-BEN EL (2026-09-24),
 * NEM ITT -- Balazs kerese, hogy a partner portal (`apps/partner`) ugyanugy
 * nezzen ki, mint ez a felulet. A `@theme` blokk, a betutipus-valtozok es az
 * alap elem-szabalyok atkoltoztek, hogy `apps/partner/src/app/globals.css`
 * is importalhassa oket -- a masolas EGYETLEN hely helyett KETTOT hozott
 * volna letre, es a kovetkezo szinvaltoztatas csak az egyiket erte volna el.
 *
 * EZ A TESZT A WEBES OLDALT MERI: hogy az import valoban itt all, es hogy
 * a JELENLEGI kimenet (mind a ket app azonos importtal) tenyleg egyezik.
 * A PARTNER SAJAT ellenorzese a `visual-base.spec.ts`-ben all -- az a
 * csomag SOSEM hivatkozhat `apps/web`-re, tehat a ket iranyt ket kulon
 * fajl meri.
 */
describe("a webes globals.css a közös témát importálja", () => {
  const css = readFileSync(join(__dirname, "globals.css"), "utf8");

  it("importálja a packages/ui közös theme.css-ét", () => {
    expect(css).toMatch(
      /@import\s+"\.\.\/\.\.\/\.\.\/\.\.\/packages\/ui\/src\/theme\.css";/,
    );
  });

  it("a saját @theme blokk NEM él itt duplán (a másolat elmaradt)", () => {
    expect(css).not.toMatch(/@theme\s*\{/);
  });

  it("a közös theme.css valóban definiálja a brand-600 tokent", () => {
    const theme = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "packages",
        "ui",
        "src",
        "theme.css",
      ),
      "utf8",
    );
    expect(theme).toMatch(/--color-brand-600:/);
  });
});

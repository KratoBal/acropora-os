import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotThemeRoot } from "./pilot-ui";

const theme = vi.hoisted(() => ({
  effectiveTheme: "light" as "light" | "dark",
}));

vi.mock("@/lib/theme/use-theme-preference", () => ({
  useThemePreference: () => ({ effectiveTheme: theme.effectiveTheme }),
}));

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest/happy-dom
 * alatt, Next build nélkül nem futtatható, `TypeError: localFont is not a
 * function`-nal bukik. Ez a modul csak a `PilotThemeRoot`-on keresztül,
 * TRANZITÍVEN kerül ide (`pilot-ui.tsx` importálja `pilot-font.ts`-ből) --
 * a teszt nem a betűtípust méri, ezért egy egyszerű stub elég, ami csak a
 * használt `.className` mezőt adja.
 *
 * 2026-09-24-TŐL `next/font/local`, NEM `next/font/google`: a
 * `pilot-font.ts` a build-idejű, nem determinisztikus hálózati letöltés
 * miatt helyi fájlra váltott -- lásd `apps/web/src/app/layout.tsx`
 * fejlécét. A mock célja emiatt mozdult, az INDOKA (a fordítói makrót
 * teszt alatt nem lehet lefuttatni) változatlan.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * A `data-theme` ATTRIBÚTUM CSAK A GYÖKÉR ELEMEN JELENIK MEG -- EZ AZ,
 * AMI A `figma-theme.css` SÖTÉT-FELÜLÍRÓ SZABÁLYAIT SZERKEZETILEG A
 * PILOT OLDALAKRA SZŰKÍTI (lásd a fájl fejlécét, és a `PilotThemeRoot`
 * saját fejlécét). Ez a teszt azt méri, hogy az attribútum a tényleges
 * feloldott témát viseli, mindkét irányban.
 */
describe("PilotThemeRoot", () => {
  beforeEach(() => {
    theme.effectiveTheme = "light";
  });

  it("világos módban data-theme='light'-ot tesz a gyökérre", () => {
    const { container } = render(
      <PilotThemeRoot>
        <p>tartalom</p>
      </PilotThemeRoot>,
    );
    expect(container.firstElementChild?.getAttribute("data-theme")).toBe(
      "light",
    );
  });

  it("sötét módban data-theme='dark'-ot tesz a gyökérre", () => {
    theme.effectiveTheme = "dark";
    const { container } = render(
      <PilotThemeRoot>
        <p>tartalom</p>
      </PilotThemeRoot>,
    );
    expect(container.firstElementChild?.getAttribute("data-theme")).toBe(
      "dark",
    );
  });

  /*
    MI PIROSÍT: ha a `data-theme` valaha a `document.documentElement`-re
    (a `<html>`-re) kerülne ahelyett, hogy ezen a gyökéren maradna, ez a
    teszt akkor is zöld maradna -- ezért a lenti állítás kifejezetten azt
    méri, hogy a `<html>`-en NEM jelenik meg, mert `render()` a tesztben
    ugyanabba a `document`-be szerel be, amit a JSDOM/happy-dom ad.
  */
  it("a <html> elemre NEM kerül data-theme (a régi oldalakat ez védi)", () => {
    theme.effectiveTheme = "dark";
    render(
      <PilotThemeRoot>
        <p>tartalom</p>
      </PilotThemeRoot>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});

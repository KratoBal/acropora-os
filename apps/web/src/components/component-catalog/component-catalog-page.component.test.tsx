import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentCatalogPage } from "./component-catalog-page";

afterEach(() => cleanup());

/*
  A KATALÓGUS ÉLŐ MARAD (T1.4, kártya 17cd4dbc). MI PIROSÍT: ha az `@acropora/ui` egy új `Pilot*` komponenst exportál,
  és a katalógus nem rajzolja (a kivételeken kívül), vagy egy kivétel megszűnt; ha a lap renderelése elhasal (egy
  közös komponens propja megváltozott, és a katalógus a régit adja); ha a párbeszédablak vagy a fiók nem nyílik.
*/
const INDEX = join(process.cwd(), "../../packages/ui/src/index.ts");
const KATALOGUS = join(
  process.cwd(),
  "src/components/component-catalog/component-catalog-page.tsx",
);

const KIVETELEK = new Map<string, string>([
  [
    "PilotPageHeader",
    "ugyanazt rajzolja, mint a PageHeader (PAGE_HEADER_CLASSES), ami a lap tetején áll",
  ],
]);

/** Az index értékként exportált `Pilot*` komponensei (típus és konstans nélkül). */
function pilotKomponensek(): string[] {
  const forras = readFileSync(INDEX, "utf8");
  const nevek: string[] = [];
  for (const m of forras.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (m[1]) continue;
    for (const resz of m[2]!.split(",")) {
      const nev = resz.trim();
      if (/^Pilot[A-Z][A-Za-z]*$/.test(nev)) nevek.push(nev);
    }
  }
  return [...new Set(nevek)].sort();
}

describe("komponens-katalógus", () => {
  it("a mérő az index pilot komponenseit látja (pozitív kontroll)", () => {
    const nevek = pilotKomponensek();
    expect(nevek.length).toBeGreaterThan(25);
    expect(nevek).toContain("PilotButton");
    expect(nevek).not.toContain("PilotTableColumn");
  });

  it("minden pilot komponenst rajzol, a kivételeken kívül", () => {
    const forras = readFileSync(KATALOGUS, "utf8");
    const hianyzik = pilotKomponensek().filter(
      (nev) => !KIVETELEK.has(nev) && !new RegExp(`<${nev}\\b`).test(forras),
    );
    expect(hianyzik).toEqual([]);
  });

  it("egy kivétel sem avult el", () => {
    const nevek = pilotKomponensek();
    const forras = readFileSync(KATALOGUS, "utf8");
    for (const nev of KIVETELEK.keys()) {
      expect(nevek).toContain(nev);
      expect(new RegExp(`<${nev}\\b`).test(forras)).toBe(false);
    }
  });

  it("renderel, és a rétegek kinyílnak", () => {
    render(<ComponentCatalogPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Komponens-katalógus" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Párbeszédablak megnyitása" }),
    );
    expect(screen.getByText("Egy párbeszédablak tartalma.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fiók megnyitása" }));
    expect(screen.getByText("A fiók tartalma.")).toBeTruthy();
  });
});

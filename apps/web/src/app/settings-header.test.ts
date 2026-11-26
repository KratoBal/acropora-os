import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A BEÁLLÍTÁSOK ALATTI LAPOK KÖZÖS FEJLÉCE (picasso leltár 3.24, acrobot döntése 2026-11-26).
 *
 * Ötféle felülcím állt a Beállítások almenü lapjain ("Integráció", "Fejlesztés", "Beállítások", "Beállítások / Árajánlatok", ...), a
 * legtöbbön egy sem. A szabály: minden `/beallitasok/*` lap fejlécének felülcíme "Beállítások" vagy "Beállítások / <al-terület>", ahogy a
 * rendszer többi modulja is a menü útját írja oda ("Értékesítés / Árajánlatok"). A Beállítások főoldala kivétel: ott a cím maga a
 * "Beállítások".
 *
 * MIT MÉR: a `/beallitasok` alatti útvonal-fájlokból a betöltött komponens forrását, és abban a fejléc felülcímét. MI PIROSÍT: egy új
 * Beállítások-lap felülcím nélkül, vagy egy más modul nevével. A HATÁR: forrást olvas; ha egy lap a fejlécét nem a közös `PageHeader`
 * (`PilotPageHeader`) komponenssel rajzolja, itt nem látszik, ezért azt is pirosnak veszi.
 */
const ROUTES = join(__dirname, "(shell)", "beallitasok");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

function componentOf(route: string): string {
  const match = readFileSync(route, "utf8").match(
    /from "@\/components\/([^"]+)"/,
  );
  if (!match) throw new Error(`no component import in ${route}`);
  return join(__dirname, "..", "components", `${match[1]}.tsx`);
}

describe("a Beállítások alatti lapok fejléce", () => {
  const routes = pages(ROUTES).filter(
    (route) => route !== join(ROUTES, "page.tsx"),
  );

  it("a mérés minden Beállítások-lapot lát (pozitív kontroll)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(20);
  });

  for (const route of routes) {
    const name = route.slice(ROUTES.length + 1);
    it(`${name}: a felülcím "Beállítások" vagy "Beállítások / ..."`, () => {
      const source = readFileSync(componentOf(route), "utf8");
      const headers = source.match(/<(?:Pilot)?PageHeader\b[\s\S]*?\/>/g);
      expect(headers, "a közös PageHeader").not.toBeNull();
      for (const header of headers!)
        expect(header).toMatch(/eyebrow="Beállítások(?: \/ [^"]+)?"/);
    });
  }
});

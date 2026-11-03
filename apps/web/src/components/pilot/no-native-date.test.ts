import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  NINCS ÚJ NATÍV DÁTUMMEZŐ (UI-áttekintés, 3. csomag, 2026-11-03). A natív `type="date"`
  és `type="month"` mező a böngésző nyelvén ír (`mm/dd/yyyy`, "August 2026"). A dátumot a `PilotInput type="date"` vagy a
  `PilotDateField` rajzolja magyarul; ez az őrző azt védi, hogy egy új natív dátummező
  csendben vissza ne csússzon. MI PIROSÍT: ha egy komponens-fájlban `<input>` vagy `<Input>`
  (nem `PilotInput`) áll `type="date"`-tel a kivételek listáján kívül; ha egy kivétel
  megszűnt (a lista nem avulhat el). A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src", "components");

const KIVETELEK = new Map<string, string>([
  [
    "billing/billing-receipts-view.tsx",
    "`required` mezőt használ, amit a magyar dátummező nem ad át (külön döntés kell hozzá)",
  ],
]);

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

function kod(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** Az a címke, amelyik a `type="date"`-et viseli: a legutolsó `<Név` előtte. */
function nativDatumHely(forras: string): boolean {
  for (const m of forras.matchAll(/type="(?:date|month)"/g)) {
    const elozo = forras.lastIndexOf("<", m.index);
    const nev = /^<(\w+)/.exec(forras.slice(elozo))?.[1];
    if (nev === "input" || nev === "Input") return true;
  }
  return false;
}

describe("natív dátummező a komponensekben", () => {
  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(100);
  });

  it("a mérő felismeri a natív és a közös alakot (önteszt)", () => {
    expect(nativDatumHely('<input\n type="date"\n />')).toBe(true);
    expect(nativDatumHely('<Input type="date" />')).toBe(true);
    expect(nativDatumHely('<input type="month" />')).toBe(true);
    expect(nativDatumHely('<PilotInput type="date" />')).toBe(false);
    expect(nativDatumHely('<PilotDateField value="" />')).toBe(false);
  });

  it("nincs natív dátummező a kivételek listáján kívül", () => {
    const talalat = fajlok(ROOT)
      .filter((ut) => nativDatumHely(kod(readFileSync(ut, "utf8"))))
      .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"))
      .filter((ut) => !KIVETELEK.has(ut));
    expect(talalat).toEqual([]);
  });

  it("minden kivétel még natív dátummező (nem avult a lista)", () => {
    for (const [ut, ok] of KIVETELEK) {
      const forras = readFileSync(join(ROOT, ut), "utf8");
      expect(nativDatumHely(kod(forras)), `${ut}: ${ok}`).toBe(true);
    }
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  NINCS ÚJ NATÍV <select> (UI-áttekintés, 3. csomag, 2026-11-03). A natív legördülő a böngésző
  fekete keretével és saját magasságával rajzol, eltér a közös választótól (`PilotSelect`).
  A lap többi választóját a közös elem rajzolja; ez az őrző azt védi, hogy egy új natív
  `<select>` csendben vissza ne csússzon. MI PIROSÍT: ha egy komponens-fájlban natív `<select>`
  jelenik meg a kivételek listáján kívül. A KIVÉTELEK nevesítve állnak, és mindegyiknek oka van.
  A megjegyzéseket kivágjuk (egy `<select>` említése magyarázatban nem találat).
*/
const ROOT = join(process.cwd(), "src", "components");
const UI = join(process.cwd(), "..", "..", "packages", "ui", "src");

// A kivételek (a fájl a komponens-gyökértől vagy a ui csomagtól számolva), és az okuk.
const KIVETELEK = new Map<string, string>([
  [
    "content/content-create-form.tsx",
    "`required` mezőt használ, amit a közös választó nem ad át (külön döntés kell hozzá)",
  ],
  [
    "service-jobs/partner-picker.tsx",
    "nem vezérelt (`defaultValue`) is lehet, a közös választó csak vezérelt",
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

const NATIV = /<select[\s>]/;

describe("natív <select> a komponensekben", () => {
  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(100);
  });

  it("nincs natív <select> a kivételek listáján kívül", () => {
    const talalat = fajlok(ROOT)
      .filter((ut) => NATIV.test(kod(readFileSync(ut, "utf8"))))
      .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"))
      .filter((ut) => !KIVETELEK.has(ut));
    expect(talalat).toEqual([]);
  });

  it("minden kivétel még létezik és még natív <select>-et használ (nem avult a lista)", () => {
    for (const [ut, ok] of KIVETELEK) {
      const forras = readFileSync(join(ROOT, ut), "utf8");
      expect(NATIV.test(kod(forras)), `${ut}: ${ok}`).toBe(true);
    }
  });

  it("a közös választó maga rajzol natív <select>-et (a kivétel a ui csomagban)", () => {
    expect(
      NATIV.test(kod(readFileSync(join(UI, "pilot-ui.tsx"), "utf8"))),
    ).toBe(true);
  });

  // A `<Select>` hívás nem natív `<select>` a fájlban, ezért a fenti keresés nem látja:
  // a /raktar állapot-szűrője emiatt maradt natív kinézetű. A közös elem maga őrzött:
  // ha a `appearance-none` vagy a nyíl kikerül belőle, mind a 48 hívása natívra vált.
  it("a form-oldali <Select> saját nyilat rajzol, nem a böngészőét", () => {
    const forras = kod(readFileSync(join(UI, "select.tsx"), "utf8"));
    expect(forras).toMatch(/appearance-none/);
    expect(forras).toMatch(/name="chevron-down"/);
  });
});

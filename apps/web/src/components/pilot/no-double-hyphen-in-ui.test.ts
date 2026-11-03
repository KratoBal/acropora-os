import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  NINCS DUPLA KÖTŐJEL A FELÜLETI SZÖVEGBEN (UI-áttekintés, 4. csomag, 2026-11-03). A " -- "
  gondolatjel-pótlék a képernyőn hibának látszik; kettőspont, vessző, zárójel vagy új mondat áll
  a helyén. MI PIROSÍT: ha egy komponens-fájl kódjában (megjegyzés nélkül) szóközök közt álló
  `--` jelenik meg: JSX-szövegben, sztringben, sablonban. A megjegyzések kivágva: ott a magyarázó
  szövegben a jelölés megengedett, nem látszik a felületen. A CSS-változók (`--pilot-...`)
  nem szóközzel körülvéve állnak, azok nem találatok.
*/
const ROOT = join(process.cwd(), "src", "components");

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx?$/.test(nev) && !/\.(test|spec)\./.test(nev) ? [ut] : [];
  });
}

/** A megjegyzések kivágva, a sorszámok megtartva. */
function kod(forras: string): string {
  const ures = (m: string) => m.replace(/[^\n]/g, " ");
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, ures)
    .replace(
      /(^|[^:\w"'`])(\/\/.*)$/gm,
      (_m, elo: string, jegyzet: string) => elo + ures(jegyzet),
    );
}

const DUPLA = /(^|\s)--(\s|$)/;

function talalatok(forras: string): number[] {
  return kod(forras)
    .split("\n")
    .flatMap((sor, i) => (DUPLA.test(sor) ? [i + 1] : []));
}

describe("dupla kötőjel a komponensek kódjában", () => {
  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(100);
  });

  it("a mérő megfogja a szöveget és a sablont, a megjegyzést és a CSS-változót nem (önteszt)", () => {
    expect(talalatok("<p>Ez -- az</p>")).toEqual([1]);
    expect(talalatok('const a = "ez -- az";')).toEqual([1]);
    expect(talalatok("const a = `${x} -- ${y}`;")).toEqual([1]);
    expect(talalatok("// ez -- megjegyzés")).toEqual([]);
    expect(talalatok("/* ez\n -- megjegyzés */\nconst a = 1;")).toEqual([]);
    expect(talalatok("style={{ ['--pilot-table-min' as string]: 1 }}")).toEqual(
      [],
    );
  });

  it("nincs dupla kötőjel a felületi szövegben", () => {
    const talalat = fajlok(ROOT).flatMap((ut) =>
      talalatok(readFileSync(ut, "utf8")).map(
        (sor) => `${relative(ROOT, ut).replaceAll("\\", "/")}:${sor}`,
      ),
    );
    expect(talalat).toEqual([]);
  });
});

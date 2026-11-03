import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  NINCS NYÍL NÉLKÜLI PILOT-VÁLASZTÓ (UI-áttekintés, 2026-11-03). A `PilotSelect` alapból nyilat rajzol (a `appearance-none`
  elrejti a böngészőét); a `chevron={false}` kikapcsolná, és a választó beviteli mezőnek látszana (az új eszköz űrlap hat
  választója így állt). Az őrző a forrásban keresi a kikapcsolást, a kivételek listáján kívül. MI PIROSÍT: ha egy hívás
  `chevron={false}`-t ad át; ha egy kivétel megszűnt (a lista nem avulhat el). A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

const KIVETELEK = new Map<string, string>();

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

const KIKAPCSOLT = /chevron=\{\s*false\s*\}/;

describe("nyíl nélküli PilotSelect a forrásban", () => {
  it("a mérő felismeri a kikapcsolást (önteszt)", () => {
    expect(KIKAPCSOLT.test("<PilotSelect chevron={false} />")).toBe(true);
    expect(KIKAPCSOLT.test("<PilotSelect chevron={ false }\n/>")).toBe(true);
    expect(KIKAPCSOLT.test("<PilotSelect chevron />")).toBe(false);
    expect(KIKAPCSOLT.test("<PilotSelect />")).toBe(false);
  });

  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(300);
  });

  it("nincs chevron={false} a kivételek listáján kívül", () => {
    const talalat = fajlok(ROOT)
      .filter((ut) => KIKAPCSOLT.test(kod(readFileSync(ut, "utf8"))))
      .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"))
      .filter((ut) => !KIVETELEK.has(ut));
    expect(talalat).toEqual([]);
  });
});

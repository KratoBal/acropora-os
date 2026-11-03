import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  NINCS LÁTHATÓ NATÍV FÁJLMEZŐ (UI-áttekintés, 3. csomag, 2026-11-03). A natív `<input type="file">` a böngésző
  nyelvén ír ("Choose File  No file chosen"). A fájlt a `PilotFileInput` kéri magyarul; a rejtett mező (egy
  saját gomb mögött, `hidden` vagy `sr-only`) rendben van. MI PIROSÍT: ha egy komponens-fájlban látható
  (nem rejtett) `<input>` vagy `<Input>` áll `type="file"`-lal a kivételek listáján kívül. Az eszköz-adatlapok
  "Fénykép vagy PDF" mezője pont így maradt natív (a stage-fotón angol felirattal). A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src", "components");

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

/**
 * A látható natív fájlmezők száma: a `<input|Input ... />` címkék, amiken `type="file"` áll, és nincs
 * `hidden` / `sr-only` osztály. A címke a `/>`-ig tart (egy `onChange={(e) => ...}` nyila nem zárja le).
 */
function lathatoNativFajlmezo(forras: string): number {
  let szam = 0;
  for (const m of forras.matchAll(/<(?:input|Input)\b[\s\S]*?\/>/g)) {
    if (!/type="file"/.test(m[0])) continue;
    if (!/className="[^"]*\b(?:hidden|sr-only)\b/.test(m[0])) szam++;
  }
  return szam;
}

describe("látható natív fájlmező a komponensekben", () => {
  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(100);
  });

  it("a mérő felismeri a látható és a rejtett alakot (önteszt)", () => {
    expect(lathatoNativFajlmezo('<Input type="file" accept="x" />')).toBe(1);
    expect(
      lathatoNativFajlmezo('<input\n  type="file"\n  onChange={f}\n/>'),
    ).toBe(1);
    expect(
      lathatoNativFajlmezo('<input type="file" className="hidden" />'),
    ).toBe(0);
    expect(
      lathatoNativFajlmezo('<input className="sr-only" type="file" />'),
    ).toBe(0);
    expect(lathatoNativFajlmezo('<PilotFileInput accept="x" />')).toBe(0);
    // A nyíl (`=>`) a tulajdonságban nem zárja le a címkét: a rejtett osztály utána áll.
    expect(
      lathatoNativFajlmezo(
        '<input type="file" onChange={(e) => go(e)} className="sr-only" />',
      ),
    ).toBe(0);
    expect(
      lathatoNativFajlmezo('<input type="file" onChange={(e) => go(e)} />'),
    ).toBe(1);
  });

  it("nincs látható natív fájlmező a kivételek listáján kívül", () => {
    const talalat = fajlok(ROOT)
      .filter((ut) => lathatoNativFajlmezo(kod(readFileSync(ut, "utf8"))) > 0)
      .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"))
      .filter((ut) => !KIVETELEK.has(ut));
    expect(talalat).toEqual([]);
  });
});

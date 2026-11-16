import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  EGY OLDALFEJLÉC (UI 2. csomag, 2026-11-03). A stage-söprés négy fejléc-változatot talált: mind kézzel írt `<h1>`
  volt, saját mérettel, színnel és morzsával. A lapcím innentől a közös `PageHeader` (`@acropora/ui`) dolga. MI PIROSÍT:
  ha egy lap a kivételeken kívül saját `<h1>`-et rajzol; ha egy kivétel megszűnt (a lista nem avulhat el). A
  megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

const KIVETELEK = new Map<string, string>([
  [
    "app/login/page.tsx",
    "a belépő lap a héjon kívül áll, saját kártyás elrendezéssel",
  ],
  [
    "components/quotes/public-quote-page.tsx",
    "a vevőnek szóló nyilvános árajánlat, nem az OS felülete",
  ],
  [
    "components/service-assets/asset-list-print-page.tsx",
    "nyomtatási nézet, papírra méretezett címmel",
  ],
  [
    "components/game/live-draw-page.tsx",
    "az élő sorsolás teljes képernyős adásnézete, a héjon kívül: a címe a látvány része, nem az OS fejléce",
  ],
  [
    "components/billing/billing-detail-header.tsx",
    "a számla-adatlapok fejléce: a PageHeader osztályait viseli (PAGE_HEADER_CLASSES), csak az elrendezése saját",
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
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const KEZI_CIM = /<h1[\s>]/;

const talalatok = () =>
  fajlok(ROOT)
    .filter((ut) => KEZI_CIM.test(kod(readFileSync(ut, "utf8"))))
    .map((ut) => relative(ROOT, ut).replaceAll("\\", "/"));

describe("kézzel írt lapcím a forrásban", () => {
  it("a mérő felismeri a kézi címet (önteszt)", () => {
    expect(KEZI_CIM.test('<h1 className="text-xl">Cím</h1>')).toBe(true);
    expect(KEZI_CIM.test("<h1>Cím</h1>")).toBe(true);
    expect(KEZI_CIM.test('<h1\n  className="x">')).toBe(true);
    expect(KEZI_CIM.test("<h2>Alcím</h2>")).toBe(false);
    expect(KEZI_CIM.test('<PageHeader title="Cím" />')).toBe(false);
    expect(KEZI_CIM.test(kod("// <h1>régi</h1>\n/* <h1> */"))).toBe(false);
  });

  it("a mérő olvasható fájlokat talál (pozitív kontroll)", () => {
    expect(fajlok(ROOT).length).toBeGreaterThan(300);
  });

  it("nincs kézi <h1> a kivételek listáján kívül", () => {
    expect(talalatok().filter((ut) => !KIVETELEK.has(ut))).toEqual([]);
  });

  it("minden kivétel még létezik és még kézi címet rajzol", () => {
    const most = new Set(talalatok());
    expect([...KIVETELEK.keys()].filter((ut) => !most.has(ut))).toEqual([]);
  });
});

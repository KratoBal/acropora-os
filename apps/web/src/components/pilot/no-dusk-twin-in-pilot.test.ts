import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A PILOT LAP CSAK A PILOT KÉSZLETET HASZNÁLJA (T1.3, kártya 0baba3b9, barracuda ötlete 2026-11-03). A régi (dusk) és az
  új (pilot) komponenskészlet egymás mellett él, és ugyanaz a beállítás a kettőben mást csinál: a dusk `Input` a
  `className`-et a belső mezőre teszi, a `PilotInput` a szélességet külön kezeli (#2083). Egy lap, ami a kettőt keveri,
  ezért két szabály szerint néz ki.

  PILOT FÁJL: amelyik egy `Pilot*` komponenst importál az `@acropora/ui`-ból (vagy a `pilot-ui`-ból), vagy
  `<PilotThemeRoot>`-ot rajzol. DUSK IKER: az a dusk komponens, aminek van pilot párja (`DUSK_IKREK`). A párja nélküliek
  (Alert, Skeleton, EmptyState, Icon, Textarea, ConfirmDialog, PageHeader) közösek, nem tartoznak ide.

  A HÁTRALÉVŐ LISTA (`HATRA`): a mai vegyes fájlok, mindegyik a benne maradt dusk ikrekkel. Csak fogyhat. MI PIROSÍT:
  ha egy pilot fájl a listán kívül dusk ikret importál; ha egy listás fájl új dusk ikret kap; ha egy listás fájl már
  nem vegyes, vagy megszűnt (akkor a sorát törölni kell, és a lista eggyel rövidebb). Fájl szintű mérés: a csak duskot
  használó, még át nem írt lapok nem ide tartoznak. A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

const DUSK_IKREK = [
  "Avatar",
  "Badge",
  "Button",
  "Card",
  "CardContent",
  "CardHeader",
  "FormField",
  "Input",
  "Select",
] as const;

const HATRA = new Map<string, string[]>([]);

/*
  A SZÁMLÁLÓK (barracuda, #2125): a pontos egyezés megfogja az új vegyes fájlt, de ha valaki ugyanabban a PR-ban a
  sorát is felveszi a listára, a teszt zöld maradna. A két szám ezért külön áll: a lista bővítése két helyen kér
  módosítást, és a reviewban látszik. Fogyáskor a számot is le kell írni (a lista története: 59 / 141 a #2125-ben, 47 / 129 a #2134-ben, 45 / 120 a #2137-ben, 36 / 96 a #2140-ben, 32 / 86 a #2229-ben, 29 / 76 a #2232-ben, 25 / 61 a 7. szeletben, a purchasing mappa, 8 / 30 a 13. szeletben: a termékek, a SEO landing és a levélkép-választó, 5 / 18 a 14. szeletben, a leltár két lapja és az adag-hatás kártya, 4 / 14 a 8. szeletben, az eszköz-szerkesztő, 1 / 4 a 15. szeletben, a webshop három lapja, 0 / 0 a 16. szeletben, a vevőlista).
*/
const HATRA_MERET = 0;
const HATRA_IKREK = 0;

/*
  A GYEREK-LISTA (barracuda, #2125): egy pilot fájl által importált, CSAK duskot használó .tsx (relatív vagy `@/`
  út, egy szint). A fájlszintű mérés ezt a pilot lapon rajzolt dusk elemet nem látja; itt látszik, ugyanazzal a
  csak-fogyhat szabállyal. Mélyebb gráf nem kell: a második szint már többnyire közös komponens.
*/
const GYEREK = new Map<string, string[]>([
  ["components/brands/catalog-actions-panel.tsx", ["Badge", "Button", "Card"]],
  ["components/content/article-revision-diff.tsx", ["Button"]],
  ["components/products/barcode-editor.tsx", ["Badge", "Button", "Input"]],
  [
    "components/products/product-basics-editor.tsx",
    ["Button", "Card", "FormField", "Input", "Select"],
  ],
]);
const GYEREK_MERET = 4;
const GYEREK_IKREK = 12;

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

/** Blokk-komment csak sor elején vagy szóköz, `{`, `(`, `;` után kezdődik (a `grid-base-track.test.ts` mintája). */
function kod(forras: string): string {
  return forras
    .replace(/(^|[\s{(;])\/\*[\s\S]*?\*\//gm, "$1 ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** A fájl `@acropora/ui`-ból és `pilot-ui`-ból importált, nem csak típusként használt nevei. */
function uiNevek(forras: string): Set<string> {
  const nevek = new Set<string>();
  for (const m of forras.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"(?:@acropora\/ui|[^"]*pilot-ui)"/g,
  )) {
    if (/^import\s+type\b/.test(m[0])) continue;
    for (const resz of m[1]!.split(",")) {
      const nev = resz.trim();
      if (!nev || nev.startsWith("type ")) continue;
      nevek.add(nev.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return nevek;
}

/** Egy forrás vegyes-e, és ha igen, melyik dusk ikrek vannak benne (rendezve); különben null. */
function vegyes(forras: string): string[] | null {
  const tiszta = kod(forras);
  const nevek = uiNevek(tiszta);
  const pilot =
    [...nevek].some((n) => n.startsWith("Pilot")) ||
    /<PilotThemeRoot\b/.test(tiszta);
  const dusk = DUSK_IKREK.filter((n) => nevek.has(n));
  return pilot && dusk.length ? [...dusk].sort() : null;
}

function pilotForras(tiszta: string): boolean {
  return (
    [...uiNevek(tiszta)].some((n) => n.startsWith("Pilot")) ||
    /<PilotThemeRoot\b/.test(tiszta)
  );
}

/** Egy import-specifikátor a `src` alatti .tsx fájlra (relatív vagy `@/`), vagy null. */
function felold(honnan: string, spec: string): string | null {
  const alap = spec.startsWith("@/")
    ? join(ROOT, spec.slice(2))
    : spec.startsWith(".")
      ? join(dirname(honnan), spec)
      : null;
  if (!alap) return null;
  for (const jelolt of [`${alap}.tsx`, join(alap, "index.tsx")])
    if (existsSync(jelolt)) return jelolt;
  return null;
}

/** A pilot fájlok egy szintű, csak duskot használó .tsx gyerekei, a bennük álló dusk ikrekkel. */
const gyerekek = () => {
  const talalt = new Map<string, string[]>();
  for (const ut of fajlok(ROOT)) {
    const tiszta = kod(readFileSync(ut, "utf8"));
    if (!pilotForras(tiszta)) continue;
    for (const m of tiszta.matchAll(
      /import\s+(type\s+)?(?:\w+\s*,\s*)?(?:\{[^}]*\}|\w+)\s*from\s*"([^"]+)"/g,
    )) {
      if (m[1]) continue;
      const gyerek = felold(ut, m[2]!);
      if (!gyerek || /\.test\./.test(gyerek)) continue;
      const gyerekKod = kod(readFileSync(gyerek, "utf8"));
      if (pilotForras(gyerekKod)) continue;
      const nevek = uiNevek(gyerekKod);
      const dusk = DUSK_IKREK.filter((n) => nevek.has(n));
      if (dusk.length) talalt.set(relative(ROOT, gyerek), [...dusk].sort());
    }
  }
  return new Map([...talalt].sort(([a], [b]) => a.localeCompare(b)));
};

const osszeg = (lista: Map<string, string[]>) =>
  [...lista.values()].reduce((n, ikrek) => n + ikrek.length, 0);

const mai = () =>
  new Map(
    fajlok(ROOT).flatMap((ut) => {
      const d = vegyes(readFileSync(ut, "utf8"));
      return d ? [[relative(ROOT, ut), d] as const] : [];
    }),
  );

describe("dusk iker a pilot lapon", () => {
  it("a mérő felismeri a vegyes fájlt (önteszt)", () => {
    expect(vegyes('import { Button, PilotCard } from "@acropora/ui";')).toEqual(
      ["Button"],
    );
    expect(
      vegyes(
        'import { Input } from "@acropora/ui";\nexport const X = () => <PilotThemeRoot />;',
      ),
    ).toEqual(["Input"]);
    expect(
      vegyes(
        'import {\n  Select,\n  Badge as B,\n  PilotInput,\n} from "@acropora/ui";',
      ),
    ).toEqual(["Badge", "Select"]);
    expect(
      vegyes('import { Alert, Skeleton, PilotButton } from "@acropora/ui";'),
    ).toBeNull();
    expect(vegyes('import { Button, Card } from "@acropora/ui";')).toBeNull();
    expect(
      vegyes('import { type Button, PilotCard } from "@acropora/ui";'),
    ).toBeNull();
    expect(
      vegyes(
        '// import { Button } from "@acropora/ui";\nimport { PilotCard } from "@acropora/ui";',
      ),
    ).toBeNull();
  });

  it("a mérő pilot fájlokat talál (pozitív kontroll)", () => {
    const pilot = fajlok(ROOT).filter((ut) =>
      [...uiNevek(kod(readFileSync(ut, "utf8")))].some((n) =>
        n.startsWith("Pilot"),
      ),
    );
    expect(pilot.length).toBeGreaterThan(100);
  });

  it("a vegyes fájlok pontosan a hátralévő lista, a benne maradt ikrekkel", () => {
    expect(Object.fromEntries(mai())).toEqual(Object.fromEntries(HATRA));
  });

  it("a lista mérete és az ikrek száma a kiírt számlálók (bővítés két helyen kér módosítást)", () => {
    expect([HATRA.size, osszeg(HATRA)]).toEqual([HATRA_MERET, HATRA_IKREK]);
    expect([GYEREK.size, osszeg(GYEREK)]).toEqual([GYEREK_MERET, GYEREK_IKREK]);
  });

  it("a pilot lapok csak duskot használó gyerekei pontosan a gyerek-lista", () => {
    expect(Object.fromEntries(gyerekek())).toEqual(Object.fromEntries(GYEREK));
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * /akvariumok/uj TELEFONON NEM LEHET SZELESEBB A KEPERNYONEL (acrobot merese,
 * 2026-11-03, stage 688b4b0a: lap 422 px 390 helyett, mindket oszlop 390 szeles).
 *
 * A TARTALMI OK: a ket oszlop kozos, `lg` alatt meghatarozatlan (`auto`) sav,
 * es egy auto savot a gyerekek legszukebb tartalma nyujt (egy `<select>` a
 * leghosszabb opcioja szelessegeig). A javitas: minden sav legyen
 * `minmax(0,1fr)`, igy a szazalekos szelessegek egy meghatarozott savhoz
 * viszonyulnak. A mero a KODRA megy (kommentek nelkul).
 */
const source = readFileSync(
  join(__dirname, "pilot-aquarium-editor-page.tsx"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

/** Az `sm:grid-cols-N` rács `grid-cols-1` alap nélkül auto sávot ad telefonon. */
function gridsWithoutBaseTrack(src: string): string[] {
  const classNames = [...src.matchAll(/className="([^"]*\bgrid\b[^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
  return classNames.filter((cls) => {
    const tokens = cls.split(/\s+/);
    const hasResponsive = tokens.some((t) => /^(sm|md|lg):grid-cols-/.test(t));
    const hasBase = tokens.some((t) => /^grid-cols-/.test(t));
    return hasResponsive && !hasBase;
  });
}

function outerGridDefinite(src: string): boolean {
  return /className="grid grid-cols-\[minmax\(0,1fr\)\][^"]*lg:grid-cols-\[minmax\(0,1fr\)_340px\]"/.test(
    src,
  );
}

describe("az akvárium-szerkesztő rácsai telefonon meghatározott sávot kapnak", () => {
  it("a mérő felismeri a hiányzó alap sávot és az auto külső rácsot (önteszt)", () => {
    expect(
      gridsWithoutBaseTrack('<div className="grid gap-3 sm:grid-cols-2">'),
    ).toHaveLength(1);
    expect(
      gridsWithoutBaseTrack(
        '<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">',
      ),
    ).toHaveLength(0);
    expect(
      outerGridDefinite(
        'className="grid items-start gap-6 lg:grid-cols-[1fr_340px]"',
      ),
    ).toBe(false);
  });

  it("minden reszponzív rácsnak van alap sávja", () => {
    expect(gridsWithoutBaseTrack(code)).toEqual([]);
  });

  it("a külső rács sávjai minmax(0,1fr)", () => {
    expect(outerGridDefinite(code)).toBe(true);
  });
});

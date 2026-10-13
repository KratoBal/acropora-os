import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A FIÓK TARTALMA GÖRGET (t17, Balázs 2026-10-13 07:24): a `PilotDrawer` a
 * gyerekeit görgető burok nélkül teszi a `flex-col h-full` panelbe, a görgetést
 * a hívó adja. A „Mérés és ajánlás” fiókban hosszú ajánlásnál a fiók alja nem
 * látszott, és nem lehetett görgetni; ugyanez állt három árajánlat-fiókban.
 *
 * Az őrző minden hívó ELSŐ gyerekét nézi, tehát egy új fiók is ide fut. MI
 * PIROSÍTJA: egy `PilotDrawer`, aminek a tartalma nem `flex-1 … overflow-y-auto`
 * burokban áll.
 */
const GYOKER = join(__dirname, "..");

function tsxFajlok(dir: string): string[] {
  return readdirSync(dir).flatMap((nev) => {
    const ut = join(dir, nev);
    if (statSync(ut).isDirectory()) return tsxFajlok(ut);
    return ut.endsWith(".tsx") && !ut.includes(".test.") ? [ut] : [];
  });
}

/** A `<PilotDrawer ...>` nyitótag utáni első elem nyitótagja. */
function elsoGyerekek(forras: string): string[] {
  const ki: string[] = [];
  const minta = /<PilotDrawer\b/g;
  let m: RegExpExecArray | null;
  while ((m = minta.exec(forras))) {
    let melyseg = 0;
    let j = m.index + m[0].length;
    for (; j < forras.length; j++) {
      const c = forras[j];
      if (c === "{") melyseg++;
      else if (c === "}") melyseg--;
      else if (c === ">" && melyseg === 0) break;
    }
    const elem = forras.slice(j + 1).match(/<[A-Za-z][^>]*>/);
    ki.push(elem ? elem[0] : "");
  }
  return ki;
}

describe("a PilotDrawer hívói görgető burkot adnak", () => {
  const hivok = tsxFajlok(GYOKER).filter((f) =>
    readFileSync(f, "utf-8").includes("<PilotDrawer"),
  );

  it("van mit mérni (a hívók listája nem üres)", () => {
    expect(hivok.length).toBeGreaterThanOrEqual(9);
  });

  it("minden hívó első gyereke flex-1 és overflow-y-auto", () => {
    const hibak = hivok.flatMap((f) =>
      elsoGyerekek(readFileSync(f, "utf-8"))
        .filter((g) => !/\bflex-1\b/.test(g) || !/\boverflow-y-auto\b/.test(g))
        .map((g) => `${f.replace(GYOKER, "")}: ${g.slice(0, 120)}`),
    );
    expect(hibak).toEqual([]);
  });
});

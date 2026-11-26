import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A PARTNER MENÜJÉNEK SORRENDJE A BELSŐ WEBÉ (picasso képernyő-leltár, 4. pont, P8; acrobot 62248): a partner menüjében a Karbantartás
 * a Munkalapok fölött állt, a belső weben a Munkalapok után. A közös három pont (Hibajegyek, Munkalapok, Karbantartás) mostantól
 * ugyanabban a sorrendben áll. A menü ÁTCSOPORTOSÍTÁSA (üzleti és műszaki oldal) döntés, nem ennek a specnek a tárgya.
 *
 * A HATÁR: forrást olvas, MINDKÉT oldalt (a belső web `navigation.ts`-ét is), így ha a belső sorrend változik, ez a spec a partnert
 * kéri igazítani. MI PIROSIT: a három pont sorrendje a két menüben eltér.
 */
const PARTNER = readFileSync("src/components/portal-shell.tsx", "utf8");
const OS = readFileSync("../web/src/components/navigation.ts", "utf8");

/** The order of the given labels as they first appear in the source after `href: "<prefix>/..."`. */
function order(source: string, prefix: string): string[] {
  const routes = ["hibajegyek", "munkalapok", "karbantartas"];
  return routes
    .map((route) => ({
      route,
      at: source.indexOf(`href: "${prefix}/${route}"`),
    }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.route);
}

describe("P8: a partner menüjének sorrendje", () => {
  it("a hibajegy, a munkalap és a karbantartás ugyanabban a sorrendben áll, mint a belső weben", () => {
    const os = order(OS, "/szerviz");
    // positive control: the OS menu holds all three
    assert.equal(os.length, 3, os.join(", "));
    assert.deepEqual(order(PARTNER, ""), os);
  });
});

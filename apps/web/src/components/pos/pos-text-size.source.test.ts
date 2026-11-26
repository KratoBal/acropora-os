import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A PÉNZTÁR BETŰMÉRETE LEGALÁBB 13 PX (Picasso 3.19, acrobot 62278: a fizetési mód felirata, a szürke figyelmeztetés és a mezőcímkék 11-12 px-esek voltak, ott, ahol gyorsan kell olvasni). A kirajzolt
  méretet a jsdom nem számolja, ezért a forrás osztályneveit olvassuk: ha a pénztár képernyőn újra `text-xs` vagy 10-12 px-es betű jelenik meg, ez pirosít.
*/
const source = readFileSync(
  join(process.cwd(), "src", "components", "pos", "pos-terminal-page.tsx"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

describe("POS terminal text size", () => {
  it("has no text-xs and no 10 to 12 px text", () => {
    expect(code.match(/\btext-xs\b/g) ?? []).toEqual([]);
    expect(code.match(/text-\[1[0-2]px\]/g) ?? []).toEqual([]);
  });

  it("the small labels are 13 px", () => {
    expect((code.match(/text-\[13px\]/g) ?? []).length).toBeGreaterThanOrEqual(
      10,
    );
  });
});

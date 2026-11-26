import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A PÉNZTÁR BETŰMÉRETE LEGALÁBB 13 PX (Picasso 3.19, acrobot 62278: a fizetési mód felirata, a szürke figyelmeztetés és a mezőcímkék 11-12 px-esek voltak, ott, ahol gyorsan kell olvasni). A kirajzolt
  méretet a jsdom nem számolja, ezért a forrás osztályneveit olvassuk: ha a pénztár képernyőn újra `text-xs` vagy 10-12 px-es betű jelenik meg, ez pirosít.
*/
// THE LIVE PAGE: `/pos` draws `PilotPosTerminalPage` (app/(shell)/pos/page.tsx). Until 2026-11-26 this read `pos-terminal-page.tsx`, which no
// route draws, so #2970's 13 px stood on a page nobody sees (nautilus's measurement, acrobot 62633).
const source = readFileSync(
  join(
    process.cwd(),
    "src",
    "components",
    "pos",
    "pilot",
    "pilot-pos-terminal-page.tsx",
  ),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

describe("POS terminal text size", () => {
  it("reads the page the /pos route draws", () => {
    const route = readFileSync(
      join(process.cwd(), "src", "app", "(shell)", "pos", "page.tsx"),
      "utf8",
    );
    expect(route).toContain("components/pos/pilot/pilot-pos-terminal-page");
  });

  it("has no text-xs and no 10 to 12 px text", () => {
    expect(code.match(/\btext-xs\b/g) ?? []).toEqual([]);
    expect(code.match(/text-\[1[0-2]px\]/g) ?? []).toEqual([]);
  });

  it("the small labels are 13 px", () => {
    expect((code.match(/text-\[13px\]/g) ?? []).length).toBeGreaterThanOrEqual(
      10,
    );
  });

  // Picasso 3.19 (acrobot 62633): the empty search, day's sales and internal uses are one line, not a py-8 box
  it("the empty states are one line", () => {
    expect(code.match(/px-5 py-8/g) ?? []).toEqual([]);
    expect((code.match(/px-5 py-3 text-\[13px\]/g) ?? []).length).toBe(3);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { menuEyebrow } from "./navigation";

/*
  THE LIST HEADERS FOLLOW THE MENU (Picasso's screen inventory 2026-11-25, R7; acrobot 62575). The grey line above a list's
  title is its menu entry ("Szerviz / Hibajegyek", "Értékesítés / Árajánlatok"), read from the menu (`menuEyebrow`), not
  written by hand: "Szerviz / Munkatér" stood over three lists, and the quotes kept "Pénzügy" after they moved under
  Értékesítés. And the "Új ..." button is the same height on every list (`size="regular"`, 40 px); the asset and the
  partner lists drew the smaller default. WHAT TURNS RED: a list writes its line by hand again, asks for another page's
  line, or its "Új ..." button loses the regular size.
*/
const here = __dirname;
const LISTS: [string, string, string][] = [
  [
    "service-jobs/pilot/pilot-service-job-list-page.tsx",
    "/szerviz/hibajegyek",
    "Szerviz / Hibajegyek",
  ],
  [
    "worksheets/pilot/pilot-worksheet-list-page.tsx",
    "/szerviz/munkalapok",
    "Szerviz / Munkalapok",
  ],
  [
    "service-jobs/pilot/pilot-maintenance-list-page.tsx",
    "/szerviz/karbantartas",
    "Szerviz / Karbantartás",
  ],
  [
    "service-assets/pilot/pilot-asset-list-page.tsx",
    "/szerviz/eszkozok",
    "Szerviz / Eszköznyilvántartás",
  ],
  ["quotes/quote-list-page.tsx", "/ajanlatok", "Értékesítés / Árajánlatok"],
  [
    "partner-orders/partner-order-list-page.tsx",
    "/megrendelesek",
    "Értékesítés / Megrendelések",
  ],
  [
    "suppliers/pilot/pilot-supplier-list-page.tsx",
    "/partnerek",
    "Értékesítés / Partnerek",
  ],
];

describe("the list headers follow the menu", () => {
  it("a page's line is its menu group and entry; a page under an entry has the entry's; elsewhere none", () => {
    for (const [, route, line] of LISTS)
      expect(menuEyebrow(route), route).toBe(line);
    expect(menuEyebrow("/ajanlatok/q1/szerkesztes")).toBe(
      "Értékesítés / Árajánlatok",
    );
    expect(menuEyebrow("/szerviz/hibajegyek/uj")).toBe("Szerviz / Hibajegyek");
    expect(menuEyebrow("/nincs-ilyen-lap")).toBeNull();
  });

  for (const [file, route] of LISTS)
    it(`${file}: the line from the menu, the "Új" button regular`, () => {
      const source = readFileSync(join(here, file), "utf8");
      expect(source).toContain(`menuEyebrow("${route}")`);
      expect(source).not.toMatch(/eyebrow="/);
      const newButtons = [
        ...source.matchAll(/<PilotButton([^>]*)>\s*(?:<Icon[^>]*\/>\s*)?Új /g),
      ];
      for (const [, props] of newButtons)
        expect(props).toContain('size="regular"');
    });
});

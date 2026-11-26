import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  THE LISTS' ONE TAB SHAPE (Picasso's screen inventory 2026-11-25, R9; acrobot 62497): the solid green pill (`sv.pillTab`), because
  Balázs said twice that the others did not show the active tab (2026-10-01: the underline; 2026-11-02: the pale green). Each list
  draws its tabs itself, so this reads the seven files: each one takes the shared pill (`sv.pillTabActive`, or the link tabs'
  `variant="solid"`), and none keeps a tab shape of its own. WHAT TURNS RED: a list goes back to the underline (`border-b-2` on a
  tab), the pale pill (`bg-pilot-aqua-50 font-semibold text-pilot-aqua-700`) or the framed button tab, or stops using the pill.
*/
const here = __dirname;
const LISTS: Record<string, string> = {
  Hibajegyek: "service-jobs/pilot/pilot-service-job-list-page.tsx",
  Munkalapok: "worksheets/pilot/pilot-worksheet-list-page.tsx",
  Karbantartás: "service-jobs/pilot/pilot-maintenance-list-page.tsx",
  Eszközök: "service-assets/pilot/pilot-asset-list-page.tsx",
  Számlázás: "billing/billing-view-tiles.tsx",
  Beszerzés: "purchasing/purchasing-pilot-shell.tsx",
  Tudásbázis: "knowledge-base/knowledge-base-tabs.tsx",
};

describe("the lists' one tab shape", () => {
  for (const [list, file] of Object.entries(LISTS))
    it(`${list}: the solid green pill, no tab shape of its own`, () => {
      const source = readFileSync(join(here, file), "utf8");
      expect(
        // the pill drawn here, the link tabs' solid variant, or the shared tab row in its pill variant (with the keyboard)
        source.includes("sv.pillTabActive") ||
          /variant="solid"/.test(source) ||
          /<ServiceListTabs[\s\S]{0,80}variant="pill"/.test(source),
      ).toBe(true);
      expect(source).not.toMatch(/whitespace-nowrap border-b-2/);
      expect(source).not.toContain(
        "bg-pilot-aqua-50 font-semibold text-pilot-aqua-700",
      );
      // the link tabs' old framed or underlined shapes (the shared tab row's "pill" IS the one shape)
      expect(source).not.toMatch(
        /<PilotLinkTabs[\s\S]{0,120}variant="(underline|pill)"/,
      );
    });
});

import { describe, expect, it } from "vitest";

import { screenFileName, shellRoutes } from "./shell-routes";

/*
  A KÉPERNYŐKÉP-ELLENŐRZÉS ÚTJAI (kártya 4cb013c3). MI PIROSÍT: ha egy dinamikus út bekerülne (azonosító nélkül hibalapot
  fotóznánk); ha a héjon kívüli lap (belépés, nyilvános ajánlat, nyomtatás) bekerülne; ha a route group a címbe szivárogna;
  ha két út ugyanazt a képfájl-nevet kapná.
*/
describe("a képernyőkép-ellenőrzés útjai", () => {
  it("a héj statikus lapjai, a dinamikusak és a héjon kívüliek nélkül", () => {
    expect(
      shellRoutes([
        "src/app/(shell)/page.tsx",
        "src/app/(shell)/penzugy/szamlazas/page.tsx",
        "src/app/(shell)/penzugy/szamlazas/[id]/page.tsx",
        "src/app/(shell)/[section]/page.tsx",
        "src/app/(shell)/szerviz/(lists)/eszkozok/page.tsx",
        "src/app/(shell)/szerviz/eszkozok/layout.tsx",
        "src/app/login/page.tsx",
        "src/app/ajanlat/[token]/page.tsx",
        "src/app/nyomtatas/eszkozok/page.tsx",
      ]),
    ).toEqual(["/", "/penzugy/szamlazas", "/szerviz/eszkozok"]);
  });

  it("a képfájl neve az útból, ütközés nélkül", () => {
    expect(screenFileName("/")).toBe("kezdolap");
    expect(screenFileName("/penzugy/szamlazas")).toBe("penzugy__szamlazas");
    expect(screenFileName("/admin/imports/unas")).toBe("admin__imports__unas");
    const names = ["/a/b", "/a_b", "/a-b"].map(screenFileName);
    expect(new Set(names).size).toBe(3);
  });
});

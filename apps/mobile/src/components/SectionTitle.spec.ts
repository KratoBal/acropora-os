import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KÖZÖS KÁRTYA-CÍMKE EGYSÉGES MARAD (Balázs döntése, 2026-09-25 19:02):
 * az öt érintett mobil adatlap (hibajegy, eszköz, munkalap, akvárium,
 * partner) mindegyike ugyanazt a `SectionTitle`-t használja a saját
 * `sectionTitle` stílusa helyett -- lásd a komponens fejlécét arról, miért
 * lett ez KÜLÖN KOMPONENS, nem csak közös stílus-konstans.
 *
 * A PARTNER ADATLAPON (`partners/[id].tsx`) NINCS kártya-csoport címke: a
 * lap egyetlen, cím nélküli adat-kártyát mutat. Ez a spec ezért NEM várja
 * el ott a `SectionTitle` importját -- egy ilyen elvárás egy nem létező
 * hiányt jelentene be.
 */
const COMPONENT = join("src", "components", "SectionTitle.tsx");

const ERINTETT_ADATLAPOK = [
  join("src", "app", "service-jobs", "[id].tsx"),
  join("src", "app", "assets", "[id].tsx"),
  join("src", "app", "worksheets", "[id].tsx"),
  join("src", "app", "aquariums", "[id].tsx"),
];

describe("a SectionTitle a terv szerinti kártya-címkét adja", () => {
  const forras = readFileSync(COMPONENT, "utf8");

  it("POZITÍV KONTROLL: a komponens fájlja olvasható és nem üres", () => {
    assert.ok(forras.length > 300, "üres vagy gyanúsan rövid");
  });

  it("a stílus a terv `MobileLabel`-jét adja: kicsi, nagybetűs, ritkított, szürke", () => {
    assert.match(forras, /textTransform:\s*"uppercase"/);
    assert.match(forras, /letterSpacing:\s*1\b/);
    assert.match(forras, /color:\s*t\.textMuted/);
    assert.match(forras, /fontSize:\s*12\b/);
  });

  for (const lap of ERINTETT_ADATLAPOK) {
    it(`${lap}: a SectionTitle közös komponenst használja, nem saját stílust`, () => {
      const s = readFileSync(lap, "utf8");
      assert.match(
        s,
        /from\s+"@\/components\/SectionTitle"/,
        `${lap} nem importálja a közös SectionTitle-t`,
      );
      assert.doesNotMatch(
        s,
        /sectionTitle:\s*\{/,
        `${lap} még mindig saját sectionTitle stílust visel`,
      );
    });
  }
});

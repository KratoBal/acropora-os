import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KÖZÖS ÁLLAPOT BEKÖTÉSE A HIBAJEGY-KÉPERNYŐKRE (kártya 7f23785c, 5. szelet). A telefonon nincs képernyő-kirajzoló, ezért a forrás van olvasva:
 * ezek azok a sorok, amiket egy átírás észrevétlenül visszacserélhet a régi, kézzel másolt felirat-hívásra. MI PIROSÍT: ha a lista sora vagy a lépés
 * értesítése a nyolc régi szóra tér vissza; ha a lépés-gomb ismét „Tovább → <állapotnév>" feliratot ír; ha a két végállapot megerősítés nélkül
 * indul (a gomb közvetlenül a mutációt hívja); ha a karbantartás jelvénye megint csak a régi „Kész / Folyamatban" szöveget írja.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const LIST = "src/app/service-jobs/index.tsx";
const DETAIL = "src/app/service-jobs/[id].tsx";
const MAINTENANCE = "src/app/maintenance/index.tsx";

describe("a közös állapot a hibajegy-képernyőkön", () => {
  it("a lista sora a közös állapotot az okkal írja, nem a régi felirat-hívást", () => {
    const s = code(LIST);
    assert.match(s, /serviceJobStateText\(item\)/);
    assert.doesNotMatch(s, /serviceJobStatusLabel/);
  });

  it("a lépés után az értesítés a válasz közös állapotát mondja", () => {
    assert.match(
      code(DETAIL),
      /A jegy állapota: \$\{serviceJobStateText\(moved\)\}/,
    );
  });

  it("a lépés-gomb ige, és a gomb a megerősítő kérdésen át indít (a két végállapot elé ablak)", () => {
    const s = code(DETAIL);
    assert.match(s, /serviceJobStepLabel\(from, to\)/);
    assert.match(s, /onPress=\{\(\) => askStep\(to\)\}/);
    assert.match(s, /stepConfirmation\(to, detail\.jobNumber, kind\)/);
    assert.match(s, /Alert\.alert\(confirmation\.title/);
    // a gomb nem hívja közvetlenül a mutációt, és nincs „Tovább →" állapotnév
    assert.doesNotMatch(s, /onPress=\{\(\) => step\.mutate\(to\)\}/);
    assert.doesNotMatch(s, /Tovább →/);
  });

  it("a karbantartás jelvénye egy helyről jön, a közös szavakkal", () => {
    const s = code(MAINTENANCE);
    assert.match(s, /maintenanceBadgeText\(item\)/);
    assert.doesNotMatch(s, /"Kész"/);
  });
});

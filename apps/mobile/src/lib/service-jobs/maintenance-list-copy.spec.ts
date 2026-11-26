import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { MAINTENANCE_LIST_COPY } from "./maintenance-list-copy";

/*
  A KARBANTARTÁS LISTA SZÖVEGEI ÉS BEKÖTÉSE (acrobot 56224; Balázs 2026-11-18 11:31: a karbantartási lap nem hibajegy). MI PIROSÍT: ha egy szöveg a hibajegy szavát hordozza; ha az ismeretlen készségű lapok száma nem
  jelenik meg a mondatban; ha a képernyő nem a karbantartási fajtát kéri (kind=MAINTENANCE, az összes hatókörrel), vagy a hibajegyek állapotát mutatja a karbantartási soron; ha a képernyő a mentett másolatot a MAINTENANCE-listával
  írná felül úgy, hogy a másolat összezsugorodna; ha a fülek nem a közös fül-függvényből dolgoznak; ha a csempe, az útvonal, a fejléc vagy a kezdőlapi sor hiányzik.
*/
const SRC = join(__dirname, "..", "..", "..", "src");
const olvas = (...ut: string[]) => readFileSync(join(SRC, ...ut), "utf8");

describe("a karbantartás lista szövegei", () => {
  it("egyik szöveg sem hibajegyet mond", () => {
    const szovegek: string[] = [
      MAINTENANCE_LIST_COPY.screenTitle,
      MAINTENANCE_LIST_COPY.noAccess,
      MAINTENANCE_LIST_COPY.tileDescription,
      MAINTENANCE_LIST_COPY.emptyOffline,
      MAINTENANCE_LIST_COPY.capabilities,
      MAINTENANCE_LIST_COPY.noticeListName,
      MAINTENANCE_LIST_COPY.truncatedNotice,
      MAINTENANCE_LIST_COPY.empty.progress,
      MAINTENANCE_LIST_COPY.empty.done,
      MAINTENANCE_LIST_COPY.empty.all,
      MAINTENANCE_LIST_COPY.unknownNotice(3),
    ];
    for (const szoveg of szovegek) {
      assert.ok(szoveg.length > 10, szoveg);
      assert.doesNotMatch(szoveg, /hibajegy|jegy/i, szoveg);
    }
  });

  it("a cím Karbantartás, a mondatok a karbantartási lapot nevezik meg", () => {
    assert.equal(MAINTENANCE_LIST_COPY.screenTitle, "Karbantartás");
    assert.match(MAINTENANCE_LIST_COPY.noAccess, /karbantartási lap/);
    assert.match(MAINTENANCE_LIST_COPY.emptyOffline, /karbantartási lap/);
    assert.match(
      MAINTENANCE_LIST_COPY.capabilities,
      /nincs állapotváltás: az aláírt munkalap a kész\./,
    );
  });

  it("az ismeretlen lapok számát kimondja, és a hozzá tartozó fület is megnevezi", () => {
    const szoveg = MAINTENANCE_LIST_COPY.unknownNotice(2);
    assert.match(szoveg, /2 /);
    assert.match(szoveg, /Összes/);
    assert.match(MAINTENANCE_LIST_COPY.unknownNotice(1), /1 /);
  });
});

describe("a karbantartás lista képernyője", () => {
  const kep = olvas("app", "maintenance", "index.tsx");

  it("a karbantartási fajtát kéri az összes hatókörrel: a fül szerver-állapotával, és a másolatnak a teljes listát", () => {
    assert.match(
      kep,
      /listServiceJobs\(\s*"all",\s*"MAINTENANCE",\s*undefined,\s*maintenanceStateOf\(tab\),?\s*\)/,
    );
    assert.match(kep, /listServiceJobs\("all", "MAINTENANCE"\)/);
    assert.equal(
      (kep.match(/listServiceJobs\(/g) ?? []).length,
      2,
      "két hívás: a fül, és (ha a fül nem az Összes) a másolat teljes listája",
    );
    assert.doesNotMatch(kep, /listServiceJobs\([^)]*"ALL"/);
  });

  it("a fül száma a szerver számlálójából jön, és a vágást kimondja", () => {
    assert.match(kep, /maintenanceTabLabel\(/);
    assert.match(kep, /maintenanceCounts/);
    assert.match(kep, /MAINTENANCE_LIST_COPY\.truncatedNotice/);
  });

  it("a fülek a közös függvényből jönnek, a mentett ág az ismeretlent számolja", () => {
    assert.match(kep, /maintenanceItemsForTab\(/);
    assert.match(kep, /cachedMaintenanceForTab\(/);
    assert.match(kep, /MAINTENANCE_TABS\.map/);
    assert.match(kep, /DEFAULT_MAINTENANCE_TAB/);
    assert.match(kep, /MAINTENANCE_LIST_COPY\.unknownNotice/);
  });

  it("a választott fül a munkamenetben marad", () => {
    assert.match(kep, /useSessionState<MaintenanceTab>/);
    assert.match(kep, /sessionKey\(user\?\.id, "maintenance", "tab"\)/);
  });

  it("a hibajegy állapotát nem mutatja, a készséget igen", () => {
    assert.doesNotMatch(kep, /serviceJobStatusLabel/);
    assert.doesNotMatch(kep, /partnerStatusLabel/);
    // a jelvény a közös állapotból vagy a készségből (`maintenanceDone`) jön, egy helyen: `maintenanceBadgeText` (kártya 7f23785c, 5. szelet)
    assert.match(kep, /maintenanceBadgeText\(item\)/);
  });

  it("a mentett másolatba csak a szerver válasza kerül, a lap megnyitása a közös adatlapra visz", () => {
    assert.match(kep, /rememberServiceJobs\(copySource\.items\)/);
    // a másolat az Összes fül válaszából, különben a teljes listából íródik (egy szűrt fül válaszából egy már kész lap folyamatban maradna)
    assert.match(
      kep,
      /const copySource = tab === "all" \? query\.data : fullList\.data;/,
    );
    assert.equal(
      (kep.match(/rememberServiceJobs\(/g) ?? []).length,
      1,
      "a másolatot egyetlen hely írja, a szerver válaszából",
    );
    assert.match(kep, /router\.push\(`\/service-jobs\/\$\{item\.id\}`\)/);
  });

  it("minden szöveg a közös szövegtárból jön", () => {
    for (const kulcs of [
      "noAccess",
      "emptyOffline",
      "capabilities",
      "noticeListName",
      "empty",
    ])
      assert.match(kep, new RegExp(`MAINTENANCE_LIST_COPY\\.${kulcs}`), kulcs);
  });
});

describe("a kliens a fül állapotát küldi", () => {
  it("a lista-hívás a negyedik paraméterként viszi a szerver-állapotot, csak ha van", () => {
    const kliens = olvas("lib", "api", "service-jobs.ts");
    assert.match(kliens, /maintenanceState\?: "progress" \| "done"/);
    assert.match(
      kliens,
      /if \(maintenanceState\) query\.set\("maintenanceState", maintenanceState\);/,
    );
  });
});

describe("a csempe és a fejléc", () => {
  it("az útvonal, a fejléc cím és a kezdőlapi sor a Karbantartás szövegeit használja", () => {
    assert.match(
      olvas("app", "_layout.tsx"),
      /name="maintenance\/index"[\s\S]{0,120}MAINTENANCE_LIST_COPY\.screenTitle/,
    );
    const modulok = olvas("lib", "home", "modules.ts");
    assert.match(
      modulok,
      /KT: \{[\s\S]{0,200}MAINTENANCE_LIST_COPY\.tileDescription[\s\S]{0,120}route: "\/maintenance"/,
    );
    assert.match(
      olvas("lib", "auth", "tile-visibility.ts"),
      /KT: "maintenance"/,
    );
  });
});

describe("a mentett listasor készsége", () => {
  it("a részletlap mentése a lap munkalapjaiból számolt készséget írja a listasorra", () => {
    const cache = olvas("lib", "offline", "service-job-cache.ts");
    assert.match(
      cache,
      /maintenanceDoneFromDetail\(detail, korabbi\?\.maintenanceDone\)/,
    );
    assert.match(
      cache,
      /\.\.\.\(kesz === undefined \? \{\} : \{ maintenanceDone: kesz \}\)/,
    );
  });
});

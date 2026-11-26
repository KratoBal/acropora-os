import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  commonServiceReasonLabel,
  commonServiceStatusLabel,
  commonWorksheetStatus,
  type WorksheetVersionStatus,
} from "@acropora/types";

/**
 * A MOBIL KÖZÖS ÁLLAPOT FELIRATAI EGYEZZENEK A KÖZÖS CSOMAGÉVAL (kártya 7f23785c, 5. szelet, acrobot 62389).
 *
 * Az Expo app nem húzhatja be a munkatér csomagjait, ezért az öt állapot és a hét ok feliratát MÁSOLJA (`common-status.ts`). Ezek SZAVAK, de itt a
 * szó a közös lista maga: egy elcsúszott felirat azt mondaná a szerelőnek, amit az irodás már nem. Az `ServiceJobStatusValue` tükre mellett nincs
 * ilyen őrző (ott a szöveg nem szabály), ez a mostani másolat viszont a döntés maga. MI PIROSÍT: ha a telefon egy állapot vagy ok feliratát
 * átírja, kihagyja vagy újat vesz fel a közös csomag nélkül; ha a lépés-gomb igéi eltérnek a webes lépés-gombokétól.
 */
const MOBIL = "../mobile/src/lib/service-jobs/common-status.ts";
const WEB = "../web/src/components/service-jobs/common-status-view.ts";
const MOBIL_LAP = "../mobile/src/lib/worksheets/worksheet-state.ts";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  // POZITÍV KONTROLL A BEOLVASÁSRA: rossz útvonalnál a lenti állítások két ÜRES halmazt vetnének össze, zölden.
  assert.ok(s.length > 1000, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** Egy `export const NEV ... = { KULCS: "érték", ... }` objektum kulcs-érték párjai, ahogy a fájlban állnak. */
function szotar(s: string, nev: string): Record<string, string> {
  const start = s.indexOf(`export const ${nev}`);
  assert.notEqual(start, -1, `nem találtam: ${nev}`);
  const kezd = s.indexOf("= {", start);
  const veg = s.indexOf("\n};", kezd);
  assert.ok(kezd !== -1 && veg !== -1, `nem találtam a törzsét: ${nev}`);
  return Object.fromEntries(
    [...s.slice(kezd, veg).matchAll(/^\s+([A-Z_]+): "([^"]*)",?$/gm)].map(
      (m) => [m[1]!, m[2]!],
    ),
  );
}

/** A `serviceJobStepLabel` szavai, sorrendben: minden idézett szöveg, a nagybetűs állapot-kódok (`case "WAITING_FOR_PARTS"`, `"IN_PROGRESS"`) nélkül. */
function igek(s: string): string[] {
  const start = s.indexOf("export function serviceJobStepLabel");
  assert.notEqual(start, -1, "nem találtam a lépés-feliratot");
  const veg = s.indexOf("\n}", start);
  return [...s.slice(start, veg).matchAll(/"([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((szo) => !/^[A-Z_]+$/.test(szo));
}

describe("a mobil közös-állapot feliratai a közös csomaghoz mérve", () => {
  it("POZITÍV KONTROLL: a kiolvasás nem üres halmazt ad", () => {
    assert.equal(
      Object.keys(szotar(forras(MOBIL), "COMMON_STATUS_LABELS")).length,
      5,
    );
    assert.equal(
      Object.keys(szotar(forras(MOBIL), "COMMON_REASON_LABELS")).length,
      7,
    );
  });

  it("az öt állapot felirata és sorrendje pontosan a közös", () => {
    assert.deepEqual(
      szotar(forras(MOBIL), "COMMON_STATUS_LABELS"),
      commonServiceStatusLabel,
    );
    assert.deepEqual(
      Object.keys(szotar(forras(MOBIL), "COMMON_STATUS_LABELS")),
      Object.keys(commonServiceStatusLabel),
    );
  });

  it("a hét ok felirata pontosan a közös", () => {
    assert.deepEqual(
      szotar(forras(MOBIL), "COMMON_REASON_LABELS"),
      commonServiceReasonLabel,
    );
  });

  it("a lépés-gombok igéi ugyanazok, mint a belső weben, ugyanabban a sorrendben", () => {
    const mobil = igek(forras(MOBIL));
    assert.ok(mobil.length >= 5, "gyanúsan kevés ige");
    assert.deepEqual(mobil, igek(forras(WEB)));
  });

  /**
   * A MUNKALAP MEGJELENÍTETT ÁLLAPOTÁBÓL A KÖZÖS ÁLLAPOT (kártya 7f23785c, acrobot 62402): a telefon a megjelenített állapot kulcsából (a hibajegy
   * alatti lapok sora, az üzenetek kártyája) a `WORKSHEET_DISPLAY_COMMON` táblával jut a közös állapothoz; ezt a közös csomag
   * `commonWorksheetStatus` függvénye ellen méri ez az állítás, a megjelenített állapot két bemenetén (a változat-állapot és a tételszám).
   */
  it("a telefon megjelenített-állapot táblája pontosan a közös csomag függvénye", () => {
    const src = forras(MOBIL_LAP);
    const start = src.indexOf("export const WORKSHEET_DISPLAY_COMMON");
    assert.notEqual(start, -1);
    const kezd = src.indexOf("= {", start);
    const veg = src.indexOf("\n};", kezd);
    const tabla = Object.fromEntries(
      [
        ...src
          .slice(kezd, veg)
          .matchAll(
            /^\s+([A-Z_]+): \{ status: "([A-Z_]+)", reason: (null|"[A-Z_]+") \},?$/gm,
          ),
      ].map((m) => [
        m[1]!,
        { status: m[2]!, reason: m[3] === "null" ? null : m[3]!.slice(1, -1) },
      ]),
    );
    // POZITÍV KONTROLL: nem üres halmaz
    assert.equal(Object.keys(tabla).length, 5);
    const bemenet: Record<string, [WorksheetVersionStatus, number]> = {
      NEW: ["DRAFT", 0],
      IN_PROGRESS: ["DRAFT", 1],
      COMPLETED: ["AWAITING_SIGNATURE", 1],
      CLOSED: ["SIGNED", 1],
      REJECTED: ["REJECTED", 1],
    };
    for (const [kulcs, [allapot, tetelek]] of Object.entries(bemenet))
      assert.deepEqual(
        tabla[kulcs],
        commonWorksheetStatus(allapot, tetelek),
        kulcs,
      );
  });
});

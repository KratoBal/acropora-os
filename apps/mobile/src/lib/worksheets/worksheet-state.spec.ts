import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  WORKSHEET_DISPLAY_COMMON,
  worksheetCommonState,
  worksheetStateText,
  worksheetStateTone,
  worksheetVersionLabel,
} from "./worksheet-state";

/*
  A MUNKALAP ÁLLAPOTA A TELEFONON A KÖZÖS SZAVAKKAL (kártya 7f23785c, acrobot 62402). MI PIROSÍT: ha az aláírt lap Lezárva (a közös: Lezárt); ha az
  elutasított lap külön állapot, „elutasítva" ok és piros szín nélkül; ha az aláírásra váró lap az ok nélkül Elkészült; ha a válasz saját közös
  állapota nem előz a levezetésnek; ha tételszám nélkül „Új" lesz az összevont név helyett; ha egy ismeretlen vagy prototípus-kulcs szót kap; ha a
  szűrő-gomb, a csempe és a verziótörténet szava eltér a sor jelvényétől; ha a képernyők a régi felirat-hívásra térnek vissza.
*/
describe("worksheetStateText", () => {
  it("a megjelenített állapotból (régi szerver vagy a tételszám alapján): a közös szavak az okkal", () => {
    const text = (status: string, lineCount: number) =>
      worksheetStateText({ status, lineCount });
    assert.equal(text("DRAFT", 0), "Új");
    assert.equal(text("DRAFT", 3), "Folyamatban");
    assert.equal(text("AWAITING_SIGNATURE", 3), "Elkészült · aláírásra vár");
    assert.equal(text("SIGNED", 3), "Lezárt");
    assert.equal(text("REJECTED", 3), "Folyamatban · elutasítva");
  });

  it("a válasz saját közös állapota előz, az okkal együtt", () => {
    assert.equal(
      worksheetStateText({
        status: "DRAFT",
        lineCount: 0,
        commonStatus: "DONE",
        commonReason: "AWAITING_HANDOVER",
      }),
      "Elkészült · átadásra vár",
    );
  });

  it("tételszám nélkül a mai összevont név áll, nem Új; ismeretlen állapotnál a nyers kód", () => {
    assert.equal(worksheetStateText({ status: "DRAFT" }), "Új és folyamatban");
    assert.equal(worksheetStateText({ status: "SIGNED" }), "Lezárva");
    assert.equal(worksheetStateText({ status: "BRAND_NEW" }), "BRAND_NEW");
    assert.equal(
      worksheetCommonState({ status: "toString", lineCount: 1 }),
      null,
    );
  });

  it("ismeretlen közös állapotnál a megjelenített állapot áll", () => {
    assert.equal(
      worksheetStateText({
        status: "SIGNED",
        lineCount: 2,
        commonStatus: "constructor",
      }),
      "Lezárt",
    );
  });
});

describe("worksheetStateTone", () => {
  it("az elutasított piros, az Elkészült a pozitív hang, a többi semleges (közös állapot nélkül a mai szín)", () => {
    assert.equal(
      worksheetStateTone({ status: "REJECTED", lineCount: 1 }),
      "danger",
    );
    assert.equal(
      worksheetStateTone({ status: "AWAITING_SIGNATURE", lineCount: 1 }),
      "accent",
    );
    assert.equal(
      worksheetStateTone({ status: "SIGNED", lineCount: 1 }),
      "neutral",
    );
    assert.equal(
      worksheetStateTone({ status: "DRAFT", lineCount: 0 }),
      "neutral",
    );
    assert.equal(
      worksheetStateTone({ status: "DRAFT", lineCount: 2 }),
      "neutral",
    );
    assert.equal(
      worksheetStateTone({
        status: "DRAFT",
        lineCount: 2,
        commonStatus: "WAITING",
      }),
      "warning",
    );
    // tételszám nélkül: a mai szín (a SIGNED a mobil „accent"-je)
    assert.equal(worksheetStateTone({ status: "SIGNED" }), "accent");
  });
});

describe("worksheetVersionLabel", () => {
  it("a szűrő-gombok, a csempe és a verziótörténet szava: az aláírt Lezárt, a piszkozat összevont, az elutasított szűrő Elutasítva", () => {
    assert.deepEqual(worksheetVersionLabel, {
      DRAFT: "Új és folyamatban",
      AWAITING_SIGNATURE: "Elkészült",
      SIGNED: "Lezárt",
      REJECTED: "Elutasítva",
    });
  });
});

describe("WORKSHEET_DISPLAY_COMMON", () => {
  it("mind az öt megjelenített állapot megvan (a közös csomaggal az API őrző veti össze)", () => {
    assert.deepEqual(Object.keys(WORKSHEET_DISPLAY_COMMON), [
      "NEW",
      "IN_PROGRESS",
      "COMPLETED",
      "CLOSED",
      "REJECTED",
    ]);
  });
});

/*
  A KÉPERNYŐK BEKÖTÉSE (nincs képernyő-kirajzoló, a forrás van olvasva): MI PIROSÍT, ha a lista, az adatlap, a hibajegy alatti lapok sora, az aláíró
  képernyő vagy a verziótörténet a régi felirat-hívásra tér vissza.
*/
const src = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

describe("a munkalap-képernyők a közös állapotot használják", () => {
  it("a lista sora és az adatlap jelvénye a közös állapotot rajzolja", () => {
    assert.match(
      src("src/app/worksheets/index.tsx"),
      /worksheetStateText\(item\)/,
    );
    assert.match(
      src("src/app/worksheets/index.tsx"),
      /worksheetStateTone\(item\)/,
    );
    const adatlap = src("src/app/worksheets/[id].tsx");
    assert.match(adatlap, /commonStatus:\s*data\?\.commonStatus/);
    assert.match(adatlap, /worksheetStateText\(state\)/);
    assert.match(adatlap, /worksheetVersionLabel\[version\.status\]/);
    assert.doesNotMatch(adatlap, /worksheetStatusLabel\[version\.status\]/);
  });

  it("a hibajegy alatti lapok sora és az aláíró képernyő a közös szavakat mondja", () => {
    assert.match(
      src("src/app/service-jobs/[id].tsx"),
      /worksheetStateText\(\{ \.\.\.sheet/,
    );
    assert.match(
      src("src/app/worksheets/sign/[id].tsx"),
      /worksheetVersionLabel\[current\.status\]/,
    );
  });
});

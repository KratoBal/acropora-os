import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  worksheetDeleteRefusal,
  worksheetDeleteWarnings,
  type WorksheetDeleteFacts,
} from "./worksheet-delete.rules.js";

/*
  AZ ÖNÁLLÓ, NEM LEZÁRT MUNKALAP TÖRLÉSÉNEK SZABÁLYA (a hibajegy-törlés 2. szelete; Balázs 2026-11-18; acrobot 55770: "az 1. szelet után a 2., önálló, nem lezárt munkalap törlése").
  Csak a jegyhez NEM tartozó munkalap törölhető innen (a jegy alatti lapot a jegy törlése viszi, vagy előbb le kell választani). Nem törölhető az aláírt, a lezárt
  (számozott), az ügyfélnek átadott lap; a másik lap által folytatott lap; a beszerzésig jutott anyagigény vagy készletmozgás mellett.
  MI PIROSÍT: ha a jegy alatti lap törölhető; ha egy tiltó tény nem tilt; ha a tiszta lap tiltást kap; ha az aláírásra váró lap nem figyelmeztet; ha a sorrend elmozdul.
*/
const CLEAN: WorksheetDeleteFacts = {
  hasServiceJob: false,
  number: null,
  handedOver: false,
  signed: false,
  awaitingSignature: false,
  continuedByOther: false,
  procuredMaterialRequests: 0,
  stockMovements: 0,
};
const facts = (over: Partial<WorksheetDeleteFacts>): WorksheetDeleteFacts => ({
  ...CLEAN,
  ...over,
});

describe("az önálló munkalap törlésének tiltásai", () => {
  it("a tiszta, önálló piszkozat törölhető", () => {
    assert.equal(worksheetDeleteRefusal(CLEAN), null);
  });

  it("a jegy alatti lap nem törölhető innen, a mondat megmondja a teendőt", () => {
    const refusal =
      worksheetDeleteRefusal(facts({ hasServiceJob: true })) ?? "";
    assert.match(refusal, /hibajegyhez tartozik/);
    assert.match(refusal, /le kell választani|jegyet kell törölni/);
  });

  // a karbantartási lap nem hibajegy, és a lapról nem választható le (acrobot 56118): a mondat a lapot nevezi meg, és nem ad lehetetlen tanácsot
  it("a karbantartási lap alatti lap nem törölhető innen, és a mondat a lapot nevezi meg", () => {
    const refusal =
      worksheetDeleteRefusal(
        facts({ hasServiceJob: true, serviceJobKind: "MAINTENANCE" }),
      ) ?? "";
    assert.match(refusal, /karbantartási laphoz tartozik/);
    assert.doesNotMatch(refusal, /hibajegy|le kell választani/);
  });

  it("az aláírt, a lezárt (számozott) és az átadott lap tilt", () => {
    for (const over of [
      { signed: true },
      { number: "BIO-2026-001" },
      { handedOver: true },
    ])
      assert.match(
        worksheetDeleteRefusal(facts(over)) ?? "",
        /munkalap/i,
        JSON.stringify(over),
      );
  });

  it("a folytatott lap, a beszerzésig jutott anyagigény és a készletmozgás tilt", () => {
    assert.match(
      worksheetDeleteRefusal(facts({ continuedByOther: true })) ?? "",
      /folytat/i,
    );
    assert.match(
      worksheetDeleteRefusal(facts({ procuredMaterialRequests: 1 })) ?? "",
      /anyagigény/i,
    );
    assert.match(
      worksheetDeleteRefusal(facts({ stockMovements: 1 })) ?? "",
      /készletmozgás/i,
    );
  });

  it("az aláírásra váró lap nem tilt, de figyelmeztet; a tiszta nem", () => {
    const waiting = facts({ awaitingSignature: true });
    assert.equal(worksheetDeleteRefusal(waiting), null);
    assert.match(worksheetDeleteWarnings(waiting)[0] ?? "", /aláírásra vár/);
    assert.deepEqual(worksheetDeleteWarnings(CLEAN), []);
  });
});

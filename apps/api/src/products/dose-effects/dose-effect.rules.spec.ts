import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  doseEffectRefusals,
  type DoseEffectRuleRow,
  jevEffectState,
} from "./dose-effect.rules.js";

const USABLE: DoseEffectRuleRow = {
  parameterCode: "KH",
  direction: "EMEL",
  source: "https://gyarto.example.invalid/kh",
  maxDailyDosePer100L: 10,
  recordedById: "rogzito",
  verifiedById: "ellenorzo",
  archivedAt: null,
};
const JEV_KH_UP = jevEffectState({
  status: "VERIFIED",
  value: "KALCIUM:EMEL;KH:EMEL",
  currentValue: null,
});

describe("termék-adag sor: használható-e (terv 6.2)", () => {
  it("minden feltétel teljesül: nincs elutasítás", () => {
    assert.deepEqual(
      doseEffectRefusals(USABLE, { jev: JEV_KH_UP, purchasable: true }),
      [],
    );
  });

  it("minden feltétel külön elbuktatja, a saját okával", () => {
    const cases: [Partial<DoseEffectRuleRow>, string][] = [
      [{ archivedAt: new Date() }, "ARCHIVED"],
      [{ source: "  " }, "NO_SOURCE"],
      [{ verifiedById: null }, "NOT_VERIFIED"],
      [{ verifiedById: "rogzito" }, "SAME_COLLEAGUE"],
      [{ maxDailyDosePer100L: null }, "NO_MAX_DAILY"],
      [{ direction: "CSOKKENT" }, "JEV_DISAGREES"],
      [{ parameterCode: "MAGNEZIUM" }, "JEV_DISAGREES"],
    ];
    for (const [change, refusal] of cases)
      assert.deepEqual(
        doseEffectRefusals(
          { ...USABLE, ...change },
          { jev: JEV_KH_UP, purchasable: true },
        ),
        [refusal],
        refusal,
      );
    assert.deepEqual(
      doseEffectRefusals(USABLE, { jev: JEV_KH_UP, purchasable: false }),
      ["NOT_PURCHASABLE"],
    );
  });

  it("a JEV ütközése vagy hiánya nem egyezés", () => {
    for (const row of [
      { status: "CONFLICTING_SOURCES", value: null, currentValue: null },
      { status: "MISSING", value: null, currentValue: null },
      null,
    ])
      assert.deepEqual(
        doseEffectRefusals(USABLE, {
          jev: jevEffectState(row),
          purchasable: true,
        }),
        ["JEV_DISAGREES"],
      );
    assert.equal(
      jevEffectState({
        status: "CONFLICTING_SOURCES",
        value: null,
        currentValue: null,
      }).status,
      "CONFLICTING",
    );
  });

  it("a csak saját adatból állított (UNVERIFIED) halmaz a saját értékből olvasódik, és jelölve marad", () => {
    const state = jevEffectState({
      status: "UNVERIFIED",
      value: null,
      currentValue: "KH:EMEL",
    });
    assert.equal(state.status, "UNVERIFIED");
    assert.deepEqual(
      doseEffectRefusals(USABLE, { jev: state, purchasable: true }),
      [],
    );
  });
});

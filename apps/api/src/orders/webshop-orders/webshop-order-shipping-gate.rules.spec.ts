import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shippingGateDecision,
  shippingGateMissing,
  shippingGateRefusal,
  type ShippingGateFacts,
} from "./webshop-order-shipping-gate.rules.js";

const ready: ShippingGateFacts = {
  storePickup: false,
  invoiceNumber: "ACRW-2026/00600",
  hasParcel: true,
};

describe("shippingGateRefusal", () => {
  it("lets shipping through with an issued invoice and a confirmed parcel", () => {
    assert.equal(shippingGateRefusal("out_for_delivery", ready), null);
  });

  it("names exactly what is missing", () => {
    assert.match(
      shippingGateRefusal("out_for_delivery", {
        ...ready,
        invoiceNumber: null,
        hasParcel: false,
      }) ?? "",
      /Hiányzik: kiállított számla, feladott csomag\./,
    );
    assert.match(
      shippingGateRefusal("out_for_delivery", {
        ...ready,
        invoiceNumber: null,
      }) ?? "",
      /Hiányzik: kiállított számla\./,
    );
    assert.match(
      shippingGateRefusal("out_for_delivery", { ...ready, hasParcel: false }) ??
        "",
      /Hiányzik: feladott csomag\./,
    );
  });

  it("says why: the order of the steps, and that the card is charged on shipping", () => {
    assert.match(
      shippingGateRefusal("out_for_delivery", { ...ready, hasParcel: false }) ??
        "",
      /a kártyás levonás a Kiszállításra fut/,
    );
  });

  it("a store pickup is not gated, whatever it has", () => {
    assert.equal(
      shippingGateRefusal("out_for_delivery", {
        storePickup: true,
        invoiceNumber: null,
        hasParcel: false,
      }),
      null,
    );
  });

  it("no other step is gated", () => {
    for (const to of [
      "confirmed",
      "stocking",
      "ready_for_pickup",
      "closed",
      "closed_unsuccessfully",
    ] as const)
      assert.equal(
        shippingGateRefusal(to, {
          storePickup: false,
          invoiceNumber: null,
          hasParcel: false,
        }),
        null,
        to,
      );
  });
});

/*
  A FELÜLBÍRÁLÁS DÖNTÉSE (kártya 33a0d3c7, acrobot döntése: szerveroldali kapu naplózott felülbírálással). MI PIROSÍT: ha az indok nélküli
  kérés átmegy a kapun; ha az indok a JOG helyett elég (jog nélkül is megy); ha a jog hiánya mellett az indok formai hibája kerül elő
  (a jog előbb); ha egy üres vagy túl rövid vagy túl hosszú indok átmegy; ha egy NEM szükséges felülbírálás is felülbírálásnak
  számít (hamis nyom a naplóban); ha a megkerült kapu hiányzó listája nem kerül a döntésbe (a naplóba az kell).
*/
describe("shippingGateDecision", () => {
  const gated: ShippingGateFacts = {
    storePickup: false,
    invoiceNumber: null,
    hasParcel: false,
  };
  const decide = (
    facts: ShippingGateFacts,
    overrideReason: string | undefined,
    canOverride: boolean,
    to: "out_for_delivery" | "closed" = "out_for_delivery",
  ) => shippingGateDecision({ to, facts, overrideReason, canOverride });

  it("the gate holds and there is no reason: refuse, with the sentence that names what is missing", () => {
    const out = decide(gated, undefined, true);
    assert.equal(out.kind, "refuse");
    if (out.kind === "refuse")
      assert.match(
        out.sentence,
        /Hiányzik: kiállított számla, feladott csomag\./,
      );
  });

  it("a reason without the right is forbidden: the reason does not stand in for the right", () => {
    assert.deepEqual(
      decide(gated, "Papíron feladtuk, a szállító API kiesett", false),
      {
        kind: "forbidden",
      },
    );
  });

  it("the right comes before the reason's form: a user without it never learns the reason's rules", () => {
    assert.deepEqual(decide(gated, "x", false), { kind: "forbidden" });
  });

  it("an empty, too short or too long reason is refused even with the right", () => {
    for (const reason of ["", "   ", "x", "kilenc ka", "y".repeat(501)])
      assert.deepEqual(
        decide(gated, reason, true),
        { kind: "bad-reason" },
        JSON.stringify(reason),
      );
  });

  it("the limits are inclusive: 10 and 500 characters pass", () => {
    assert.equal(decide(gated, "tíz karakt", true).kind, "override");
    assert.equal(decide(gated, "z".repeat(500), true).kind, "override");
  });

  it("with the right and a reason: override, carrying the trimmed reason and exactly what was missing", () => {
    assert.deepEqual(
      decide(gated, "  A csomagot a GLS portálján adtuk fel kézzel  ", true),
      {
        kind: "override",
        reason: "A csomagot a GLS portálján adtuk fel kézzel",
        missing: ["kiállított számla", "feladott csomag"],
      },
    );
    assert.deepEqual(
      decide(
        { ...gated, invoiceNumber: "ACRW-1" },
        "Csomag a portálon feladva",
        true,
      ),
      {
        kind: "override",
        reason: "Csomag a portálon feladva",
        missing: ["feladott csomag"],
      },
    );
  });

  it("when the gate does not hold, the reason is ignored and nothing counts as an override (no false trace)", () => {
    assert.deepEqual(decide(ready, "Felesleges indoklás szöveg", true), {
      kind: "go",
    });
    assert.deepEqual(decide(ready, "x", false), { kind: "go" });
    assert.deepEqual(decide(gated, "Indok egy másik lépésre", true, "closed"), {
      kind: "go",
    });
    assert.deepEqual(
      decide({ ...gated, storePickup: true }, "Bolti átvétel indok", true),
      { kind: "go" },
    );
  });

  it("shippingGateMissing names the missing parts in the order invoice, parcel, and nothing for an ungated step", () => {
    assert.deepEqual(shippingGateMissing("out_for_delivery", gated), [
      "kiállított számla",
      "feladott csomag",
    ]);
    assert.deepEqual(shippingGateMissing("out_for_delivery", ready), []);
    assert.deepEqual(shippingGateMissing("closed", gated), []);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aquariumCustomerRequirementProblem,
  aquariumEquipmentProblem,
  aquariumMeasurementTargetRangeInvalid,
} from "./aquarium-validation.js";

describe("aquariumCustomerRequirementProblem", () => {
  it("CUSTOMER tulajdonnál, ügyfél nélkül, kötelezőséget jelez", () => {
    assert.equal(
      aquariumCustomerRequirementProblem({
        ownershipType: "CUSTOMER",
        customerId: null,
        hasNewCustomer: false,
      }),
      "CUSTOMER_REQUIRED",
    );
  });

  it("CUSTOMER tulajdonnál, meglévő ügyféllel, rendben van", () => {
    assert.equal(
      aquariumCustomerRequirementProblem({
        ownershipType: "CUSTOMER",
        customerId: "cust-1",
        hasNewCustomer: false,
      }),
      null,
    );
  });

  it("CUSTOMER tulajdonnál, új ügyfél felvitelével, rendben van", () => {
    assert.equal(
      aquariumCustomerRequirementProblem({
        ownershipType: "CUSTOMER",
        customerId: null,
        hasNewCustomer: true,
      }),
      null,
    );
  });

  it("OWN tulajdonnál ügyfél nélkül rendben van", () => {
    assert.equal(
      aquariumCustomerRequirementProblem({
        ownershipType: "OWN",
        customerId: null,
        hasNewCustomer: false,
      }),
      null,
    );
  });

  // TESTVÉR-KONTROLL: a fenti "OWN rendben van" állítás nem magától zöld --
  // ha OWN mellett mégis érkezik ügyfél, azt is meg kell fogni.
  it("OWN tulajdonnál, mégis megadott ügyféllel, ellentmondást jelez", () => {
    assert.equal(
      aquariumCustomerRequirementProblem({
        ownershipType: "OWN",
        customerId: "cust-1",
        hasNewCustomer: false,
      }),
      "OWN_CANNOT_HAVE_CUSTOMER",
    );
  });
});

describe("aquariumEquipmentProblem", () => {
  it("nyomelem-adagolónál csatornaszám nélkül kötelezőséget jelez", () => {
    assert.equal(
      aquariumEquipmentProblem({
        kind: "NYOMELEM_ADAGOLO",
        channelCount: null,
      }),
      "CHANNEL_COUNT_REQUIRED",
    );
  });

  it("nyomelem-adagolónál csatornaszámmal rendben van", () => {
    assert.equal(
      aquariumEquipmentProblem({ kind: "NYOMELEM_ADAGOLO", channelCount: 4 }),
      null,
    );
  });

  // TESTVÉR-KONTROLL: a másik irány -- más fajtánál a csatornaszám nem
  // engedett, még ha valaki mégis megadná.
  it("más fajtánál a csatornaszám NEM engedett", () => {
    assert.equal(
      aquariumEquipmentProblem({ kind: "VILAGITAS", channelCount: 2 }),
      "CHANNEL_COUNT_NOT_ALLOWED",
    );
  });

  it("más fajtánál, csatornaszám nélkül, rendben van", () => {
    assert.equal(
      aquariumEquipmentProblem({ kind: "FUTES", channelCount: null }),
      null,
    );
  });
});

describe("aquariumMeasurementTargetRangeInvalid", () => {
  it("min > max esetén érvénytelen", () => {
    assert.equal(
      aquariumMeasurementTargetRangeInvalid({ min: 10, max: 5 }),
      true,
    );
  });

  it("min <= max esetén rendben van", () => {
    assert.equal(
      aquariumMeasurementTargetRangeInvalid({ min: 5, max: 10 }),
      false,
    );
  });

  // TESTVÉR-KONTROLL: egyenlő határ NEM hiba -- egy szűk, egypontos
  // tartomány (min === max) érvényes bemenet, nem elírás.
  it("min === max esetén rendben van", () => {
    assert.equal(
      aquariumMeasurementTargetRangeInvalid({ min: 8, max: 8 }),
      false,
    );
  });

  // A KÉT EGYOLDALÚ ESET -- csak alsó vagy csak felső határ önmagában
  // sosem lehet "fordított", mert nincs mihez hasonlítani.
  it("csak alsó határral rendben van", () => {
    assert.equal(aquariumMeasurementTargetRangeInvalid({ min: 10 }), false);
  });

  it("csak felső határral rendben van", () => {
    assert.equal(aquariumMeasurementTargetRangeInvalid({ max: 5 }), false);
  });

  it("mindkét határ hiányában rendben van", () => {
    assert.equal(aquariumMeasurementTargetRangeInvalid({}), false);
  });
});

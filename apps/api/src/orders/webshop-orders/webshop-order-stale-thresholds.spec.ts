// a DTO dekorátorai `Reflect`-en át olvasnak; az importnak a DTO modul előtt kell állnia
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
  staleHoursOf,
} from "@acropora/types";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { WebshopStaleThresholdsDto } from "./dto/webshop-order-stale-thresholds.dto.js";

/*
  AZ ELAVULÁSI KÜSZÖBÖK ALAKJA. MI PIROSÍT: a nap nem 24 óra; a kikapcsolt
  státusz bekerül a figyelésbe; a nulla vagy egy ismeretlen státusz átmegy
  (Balázs: „nem kell nulla”, a figyelést a kapcsoló kapcsolja ki).
*/
describe("stale thresholds", () => {
  it("the defaults are the prompt's: 4 h, 8 h, 3 days, 5 days", () => {
    assert.deepEqual(staleHoursOf(WEBSHOP_STALE_THRESHOLD_DEFAULTS), {
      pending_processing: { hours: 4 },
      stocking: { hours: 8 },
      out_for_delivery: { hours: 72 },
      ready_for_pickup: { hours: 120 },
    });
  });

  it("a switched-off status is left out, its value kept in the setting", () => {
    assert.deepEqual(
      staleHoursOf([
        { status: "stocking", value: 2, unit: "DAY", enabled: true },
        {
          status: "pending_processing",
          value: 6,
          unit: "HOUR",
          enabled: false,
        },
      ]),
      { stocking: { hours: 48 } },
    );
  });

  it("the body refuses zero, an unknown status and an unknown unit", async () => {
    const errors = async (thresholds: unknown[]) =>
      (
        await validate(
          plainToInstance(WebshopStaleThresholdsDto, { thresholds }),
        )
      ).length;
    assert.equal(
      await errors([
        { status: "stocking", value: 8, unit: "HOUR", enabled: false },
      ]),
      0,
    );
    for (const bad of [
      { status: "stocking", value: 0, unit: "HOUR", enabled: true },
      { status: "confirmed", value: 2, unit: "HOUR", enabled: true },
      { status: "stocking", value: 2, unit: "WEEK", enabled: true },
    ])
      assert.ok((await errors([bad])) > 0, JSON.stringify(bad));
  });
});

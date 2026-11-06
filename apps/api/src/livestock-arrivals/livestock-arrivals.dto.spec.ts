import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  CreateLivestockArrivalDto,
  LivestockArrivalListQueryDto,
  UpdateLivestockArrivalDto,
} from "./dto/livestock-arrival.dto.js";

/*
  WHAT TURNS THIS RED. The list's `?preorderable=false` or `?upcoming=false` read as true (a query string is text: the cast
  that makes every non-empty text true would show exactly what the caller asked to hide); a kind, a status or a day shape
  that is not one accepted; a label over the limit or empty; a quantity of zero or a million; an explicit null refused where
  it means "clear it" (the update's link, quantity, note); an explicit null accepted on a create's required fields.
*/
const errors = <T extends object>(cls: new () => T, plain: unknown) =>
  validateSync(plainToInstance(cls, plain)).flatMap((e) =>
    Object.keys(e.constraints ?? {}).map((c) => `${e.property}:${c}`),
  );

describe("the list query", () => {
  it("reads the two booleans from text, false included", () => {
    const query = plainToInstance(LivestockArrivalListQueryDto, {
      preorderable: "false",
      upcoming: "true",
    });
    assert.equal(query.preorderable, false);
    assert.equal(query.upcoming, true);
    assert.deepEqual(validateSync(query), []);
  });

  it("refuses an unknown status or kind", () => {
    assert.ok(
      errors(LivestockArrivalListQueryDto, { status: "ON_THE_WAY" }).length > 0,
    );
    assert.ok(
      errors(LivestockArrivalListQueryDto, { kind: "BIRD" }).length > 0,
    );
    assert.deepEqual(errors(LivestockArrivalListQueryDto, {}), []);
  });
});

describe("the create body", () => {
  const ok = {
    kind: "CORAL",
    label: "Zoanthus csoport",
    expectedOn: "2026-11-20",
  };

  it("takes the minimal body and the full one", () => {
    assert.deepEqual(errors(CreateLivestockArrivalDto, ok), []);
    assert.deepEqual(
      errors(CreateLivestockArrivalDto, {
        ...ok,
        productId: "p1",
        quantity: 12,
        status: "IN_TRANSIT",
        preorderable: true,
        note: "futár",
      }),
      [],
    );
  });

  it("refuses a wrong kind, a missing or empty label, an over-long label and a day of the wrong shape", () => {
    assert.ok(
      errors(CreateLivestockArrivalDto, { ...ok, kind: "BIRD" }).some((e) =>
        e.startsWith("kind"),
      ),
    );
    assert.ok(
      errors(CreateLivestockArrivalDto, { ...ok, label: undefined }).some((e) =>
        e.startsWith("label"),
      ),
    );
    assert.ok(
      errors(CreateLivestockArrivalDto, { ...ok, label: "" }).some((e) =>
        e.startsWith("label"),
      ),
    );
    assert.ok(
      errors(CreateLivestockArrivalDto, { ...ok, label: "x".repeat(121) }).some(
        (e) => e.startsWith("label"),
      ),
    );
    for (const bad of [
      "2026-11-6",
      "20261106",
      "2026-11-06T10:00:00Z",
      "holnap",
      undefined,
    ])
      assert.ok(
        errors(CreateLivestockArrivalDto, { ...ok, expectedOn: bad }).some(
          (e) => e.startsWith("expectedOn"),
        ),
        String(bad),
      );
  });

  it("refuses a quantity outside 1 to 100000 and a fraction", () => {
    for (const bad of [0, -3, 100001, 1.5])
      assert.ok(
        errors(CreateLivestockArrivalDto, { ...ok, quantity: bad }).some((e) =>
          e.startsWith("quantity"),
        ),
        String(bad),
      );
    for (const fine of [1, 100000, "12"])
      assert.deepEqual(
        errors(CreateLivestockArrivalDto, { ...ok, quantity: fine }),
        [],
        String(fine),
      );
  });

  it("refuses a note over 500 characters", () => {
    assert.ok(
      errors(CreateLivestockArrivalDto, { ...ok, note: "n".repeat(501) }).some(
        (e) => e.startsWith("note"),
      ),
    );
  });
});

describe("the update body", () => {
  it("takes an empty body (nothing to change)", () => {
    assert.deepEqual(errors(UpdateLivestockArrivalDto, {}), []);
  });

  it("takes an explicit null for the link, the quantity and the note: it clears them", () => {
    assert.deepEqual(
      errors(UpdateLivestockArrivalDto, {
        productId: null,
        quantity: null,
        note: null,
      }),
      [],
    );
  });

  it("takes the version the form was loaded from as an ISO time, and refuses null or a non-time", () => {
    assert.deepEqual(
      errors(UpdateLivestockArrivalDto, {
        expectedUpdatedAt: "2026-11-06T08:00:00.000Z",
      }),
      [],
    );
    for (const bad of [null, "tegnap", "2026-13-40", 5])
      assert.ok(
        errors(UpdateLivestockArrivalDto, { expectedUpdatedAt: bad }).some(
          (e) => e.startsWith("expectedUpdatedAt"),
        ),
        String(bad),
      );
  });

  it("does not take a null for what is not clearable: the kind, the label, the day, the status, the tick", () => {
    for (const field of [
      "kind",
      "label",
      "expectedOn",
      "status",
      "preorderable",
    ])
      assert.ok(
        errors(UpdateLivestockArrivalDto, { [field]: null }).some((e) =>
          e.startsWith(field),
        ),
        field,
      );
    assert.ok(
      errors(UpdateLivestockArrivalDto, { label: "" }).some((e) =>
        e.startsWith("label"),
      ),
    );
  });

  it("refuses a bad status, a bad day and a quantity of zero", () => {
    assert.ok(
      errors(UpdateLivestockArrivalDto, { status: "GONE" }).some((e) =>
        e.startsWith("status"),
      ),
    );
    assert.ok(
      errors(UpdateLivestockArrivalDto, { expectedOn: "2026-1-1" }).some((e) =>
        e.startsWith("expectedOn"),
      ),
    );
    assert.ok(
      errors(UpdateLivestockArrivalDto, { quantity: 0 }).some((e) =>
        e.startsWith("quantity"),
      ),
    );
  });
});

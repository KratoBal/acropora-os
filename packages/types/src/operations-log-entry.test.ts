import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationsTaskFieldDto } from "./operations-log.js";
import {
  operationsEntryErrors,
  operationsEntryValueFilled,
} from "./operations-log-entry.js";

/*
  MI PIROSIT: ha egy kivezetett mező értéke elutasítódna (az offline rögzítés közben kivezetett mező bejegyzése elveszne); ha egy
  kötelező, de a rögzítéskor még nem létező mező elutasítaná a régi bejegyzést; ha a fénykép mezőre szám érték átmenne; ha a
  vége a kezdet előtt lehetne; ha a rendellenesség leírás nélkül átmenne.
*/
const NOW = new Date("2026-11-13T10:00:00.000Z");

function field(
  key: string,
  type: OperationsTaskFieldDto["type"],
  extra: Partial<OperationsTaskFieldDto> = {},
): OperationsTaskFieldDto {
  return {
    id: `id-${key}`,
    key,
    label: key,
    type,
    unit: null,
    required: false,
    meterRole: null,
    sortOrder: 0,
    removedAt: null,
    ...extra,
  };
}

const FIELDS = [
  field("elotte", "NUMBER", { required: true }),
  field("rendben", "BOOLEAN"),
  field("megjegyzes", "TEXT"),
  field("kep", "PHOTO", { required: true }),
  field("regi", "NUMBER", { removedAt: "2026-11-01T00:00:00.000Z" }),
];

const BASE = {
  startedAt: "2026-11-13T09:00:00.000Z",
  finishedAt: "2026-11-13T09:30:00.000Z",
  values: { elotte: 12.5 },
  templateFieldKeys: ["elotte", "rendben", "megjegyzes", "kep"],
};

test("a rendes bejegyzés hibátlan, a fényképes kötelező mező nem tartozik ide", () => {
  assert.deepEqual(operationsEntryErrors(BASE, FIELDS, NOW), []);
});

test("az idők: érvénytelen, fordított, jövőbeli és túl hosszú", () => {
  const run = (patch: object) =>
    operationsEntryErrors({ ...BASE, ...patch }, FIELDS, NOW);
  assert.match(run({ startedAt: "nem-ido" })[0]!, /kezdés időpontja/);
  assert.match(
    run({ finishedAt: "2026-11-13T08:00:00.000Z" })[0]!,
    /nem lehet a kezdés előtt/,
  );
  assert.ok(
    run({ finishedAt: "2026-11-13T10:30:00.000Z" }).some((e) =>
      /jövőben/.test(e),
    ),
  );
  assert.ok(
    run({
      startedAt: "2026-11-11T09:00:00.000Z",
      finishedAt: "2026-11-13T09:30:00.000Z",
    }).some((e) => /24 óráig/.test(e)),
  );
  // a telefon órája pár percet előrejárhat
  assert.deepEqual(run({ finishedAt: "2026-11-13T10:03:00.000Z" }), []);
});

test("az értékek: ismeretlen kulcs, rossz típus, fénykép mező, kivezetett mező", () => {
  const run = (values: Record<string, number | boolean | string>) =>
    operationsEntryErrors({ ...BASE, values }, FIELDS, NOW);
  assert.ok(
    run({ elotte: 1, nincs: 1 }).some((e) => /Ismeretlen mező/.test(e)),
  );
  assert.ok(run({ elotte: "x" }).some((e) => /érvényes számot/.test(e)));
  assert.ok(
    run({ elotte: Number.POSITIVE_INFINITY }).some((e) =>
      /érvényes számot/.test(e),
    ),
  );
  assert.ok(
    run({ elotte: 1, rendben: 1 }).some((e) => /igen vagy nem/.test(e)),
  );
  assert.ok(
    run({ elotte: 1, megjegyzes: 5 }).some((e) => /szöveget kell/.test(e)),
  );
  assert.ok(
    run({ elotte: 1, megjegyzes: "x".repeat(2001) }).some((e) =>
      /legfeljebb 2000/.test(e),
    ),
  );
  assert.ok(
    run({ elotte: 1, kep: 3 }).some((e) => /külön kell feltölteni/.test(e)),
  );
  // a kivezetett mező értéke még érvényes
  assert.deepEqual(run({ elotte: 1, regi: 4 }), []);
});

test("a kötelező mező: a látottra szól, a kivezetettre és az újra nem", () => {
  const without = (templateFieldKeys: string[]) =>
    operationsEntryErrors(
      { ...BASE, values: {}, templateFieldKeys },
      FIELDS,
      NOW,
    );
  assert.ok(without(["elotte"]).some((e) => /„elotte”: kötelező/.test(e)));
  // a rögzítéskor még nem létező kötelező mező nem utasítja el a régi bejegyzést
  assert.deepEqual(without(["rendben"]), []);
  const retired = [
    field("x", "NUMBER", {
      required: true,
      removedAt: "2026-11-01T00:00:00.000Z",
    }),
  ];
  assert.deepEqual(
    operationsEntryErrors(
      { ...BASE, values: {}, templateFieldKeys: ["x"] },
      retired,
      NOW,
    ),
    [],
  );
  // üres szöveg nem töltés
  const text = [field("t", "TEXT", { required: true })];
  assert.ok(
    operationsEntryErrors(
      { ...BASE, values: { t: "  " }, templateFieldKeys: ["t"] },
      text,
      NOW,
    ).length === 1,
  );
  assert.equal(operationsEntryValueFilled(false), true);
  assert.equal(operationsEntryValueFilled(0), true);
  assert.equal(operationsEntryValueFilled(" "), false);
  assert.equal(operationsEntryValueFilled(undefined), false);
});

test("rendellenesség: leírás kötelező, leírás nélküli rendellenesség nincs; résztvevők", () => {
  const run = (patch: object) =>
    operationsEntryErrors({ ...BASE, ...patch }, FIELDS, NOW);
  assert.ok(run({ anomaly: true }).some((e) => /leírás kötelező/.test(e)));
  assert.ok(run({ anomaly: true, anomalyNote: "  " }).length === 1);
  assert.deepEqual(run({ anomaly: true, anomalyNote: "Szivárog" }), []);
  assert.ok(
    run({ anomaly: false, anomalyNote: "Szivárog" }).some((e) =>
      /nem adható meg/.test(e),
    ),
  );
  assert.ok(
    run({ participantIds: Array.from({ length: 21 }, (_, i) => `u${i}`) }).some(
      (e) => /Legfeljebb 20/.test(e),
    ),
  );
  assert.ok(
    run({ participantIds: ["a", "a"] }).some((e) => /csak egyszer/.test(e)),
  );
});

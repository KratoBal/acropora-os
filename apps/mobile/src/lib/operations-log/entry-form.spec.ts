import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OperationsTemplate } from "./types";
import {
  buildOperationsEntry,
  emptyOperationsEntryForm,
  parseOperationsNumber,
  type OperationsEntryForm,
} from "./entry-form";

/*
  MI PIROSIT: ha a telefon olyan bejegyzést küldene a sorba, amelyet a szerver elutasít (a sorban állva `conflict`-ba esne, és emberre
  várna); ha a Kezdés gomb nélkül is mehetne a rögzítés; ha a tizedesvesszős szám elveszne; ha az érintetlen igen/nem mező „nem”
  értékként menne (a hiány nem érték); ha a kötelező fénykép mező kép nélkül átmenne; ha az idempotencia-kulcs nem a kezdésből
  készülne (két külön rögzítés egybeesne, vagy ugyanaz kétfelé válna).
*/
const NOW = new Date("2026-11-13T10:00:00.000Z");
const STARTED = new Date("2026-11-13T09:30:00.000Z");

function field(
  key: string,
  type: OperationsTemplate["fields"][number]["type"],
  extra: Partial<OperationsTemplate["fields"][number]> = {},
): OperationsTemplate["fields"][number] {
  return {
    id: `f-${key}`,
    key,
    label: `Címke ${key}`,
    type,
    unit: null,
    required: false,
    meterRole: null,
    sortOrder: 0,
    ...extra,
  };
}

const TEMPLATE: OperationsTemplate = {
  id: "tmpl00000000000000000001",
  name: "Homokszűrő visszamosás",
  description: null,
  frequency: "WEEKLY",
  updatedAt: "2026-11-01T00:00:00.000Z",
  fields: [
    field("elotte", "NUMBER", { required: true, unit: "m3" }),
    field("rendben", "BOOLEAN"),
    field("megjegyzes", "TEXT"),
    field("kep", "PHOTO"),
  ],
};

const FILE = { uri: "file:///cache/a.jpg", name: "a.jpg", type: "image/jpeg" };

function form(patch: Partial<OperationsEntryForm> = {}): OperationsEntryForm {
  return {
    ...emptyOperationsEntryForm(),
    startedAt: STARTED,
    values: { elotte: "12,5" },
    ...patch,
  };
}

function build(
  patch: Partial<OperationsEntryForm> = {},
  template: OperationsTemplate = TEMPLATE,
) {
  return buildOperationsEntry({
    template,
    assetId: "asset0000000000000000001",
    assetLabel: "Szűrő 1",
    form: form(patch),
    now: NOW,
  });
}

function problem(
  patch: Partial<OperationsEntryForm> = {},
  template?: OperationsTemplate,
) {
  const result = build(patch, template);
  assert.equal(result.ok, false);
  return result.ok ? null : result;
}

describe("a szám beolvasása", () => {
  it("tizedesvesszővel és ponttal is, a hibás szöveg és az üres null", () => {
    assert.equal(parseOperationsNumber("12,5"), 12.5);
    assert.equal(parseOperationsNumber(" 12.5 "), 12.5);
    assert.equal(parseOperationsNumber("0"), 0);
    assert.equal(parseOperationsNumber("-3"), -3);
    for (const bad of [
      "",
      "  ",
      "abc",
      "1,2,3",
      "12 5",
      "1e5",
      "1000000000000",
    ])
      assert.equal(parseOperationsNumber(bad), null, bad);
  });
});

describe("a rögzítés törzse", () => {
  it("a rendes űrlap szerver-kész törzs, a kulcs a kezdésből, a mezők a LÁTOTT sablonból", () => {
    const result = build({
      participantIds: ["u2", "u2", "u3"],
      internalNote: "  belső  ",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.operationId,
      `operations-entry:asset0000000000000000001:tmpl00000000000000000001:${STARTED.toISOString()}`,
    );
    assert.equal(result.payload.clientOperationId, result.operationId);
    assert.deepEqual(result.payload.templateFieldKeys, [
      "elotte",
      "rendben",
      "megjegyzes",
      "kep",
    ]);
    assert.equal(result.payload.startedAt, STARTED.toISOString());
    assert.equal(result.payload.finishedAt, NOW.toISOString());
    assert.deepEqual(result.payload.values, { elotte: 12.5 });
    assert.deepEqual(result.payload.participantIds, ["u2", "u3"]);
    assert.equal(result.payload.internalNote, "belső");
    assert.equal(result.payload.anomaly, false);
    assert.equal(result.payload.anomalyNote, null);
    assert.equal(result.payload.queueTitle, "Homokszűrő visszamosás: Szűrő 1");
  });

  it("a Kezdés gomb nélkül nincs rögzítés; a fordított és a túl hosszú idő is hiba", () => {
    assert.match(problem({ startedAt: null })!.message, /Kezdés gombot/);
    assert.equal(problem({ startedAt: null })!.field, "startedAt");
    assert.match(
      problem({ startedAt: new Date("2026-11-13T10:30:00.000Z") })!.message,
      /nem lehet a kezdés előtt/,
    );
    assert.match(
      problem({ startedAt: new Date("2026-11-11T09:00:00.000Z") })!.message,
      /24 óráig/,
    );
  });

  it("a kötelező mező, a hibás szám és a hosszú szöveg megnevezett hiba", () => {
    const missing = problem({ values: {} })!;
    assert.equal(missing.field, "field:elotte");
    assert.match(missing.message, /„Címke elotte”: kötelező/);
    assert.match(
      problem({ values: { elotte: "abc" } })!.message,
      /érvényes számot/,
    );
    assert.match(
      problem({ values: { elotte: "1", megjegyzes: "x".repeat(2001) } })!
        .message,
      /legfeljebb 2000/,
    );
  });

  it("az érintetlen igen/nem mező hiány, az érintett `false` érték; az üres szöveg nincs", () => {
    const untouched = build();
    assert.ok(untouched.ok && !("rendben" in untouched.payload.values));
    const touched = build({
      values: { elotte: "1", rendben: false, megjegyzes: "   " },
    });
    assert.ok(touched.ok);
    if (!touched.ok) return;
    assert.deepEqual(touched.payload.values, { elotte: 1, rendben: false });
  });

  it("a nulla szám érték (nem hiány)", () => {
    const result = build({ values: { elotte: "0" } });
    assert.ok(result.ok);
    if (result.ok) assert.deepEqual(result.payload.values, { elotte: 0 });
  });

  it("a kötelező fénykép mező kép nélkül hiba, képpel a lista a mező kulcsával", () => {
    const required: OperationsTemplate = {
      ...TEMPLATE,
      fields: [field("kep", "PHOTO", { required: true })],
    };
    assert.match(
      problem({ values: {} }, required)!.message,
      /kötelező kitölteni/,
    );
    const ok = build({ values: {}, photos: { kep: [FILE] } }, required);
    assert.ok(ok.ok);
    if (!ok.ok) return;
    assert.deepEqual(ok.photos, [{ fieldKey: "kep", file: FILE }]);
    assert.deepEqual(ok.payload.values, {});
    assert.match(
      problem({ values: {}, photos: { kep: Array(11).fill(FILE) } }, required)!
        .message,
      /legfeljebb 10 kép/,
    );
  });

  it("a rendellenességhez leírás kell, anélkül nem megy leírás", () => {
    assert.equal(problem({ anomaly: true })!.field, "anomalyNote");
    const ok = build({ anomaly: true, anomalyNote: "  Szivárog  " });
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.payload.anomaly, true);
      assert.equal(ok.payload.anomalyNote, "Szivárog");
    }
    const hidden = build({ anomaly: false, anomalyNote: "Mégis" });
    assert.ok(hidden.ok);
    if (hidden.ok) assert.equal(hidden.payload.anomalyNote, null);
  });

  it("két külön kezdés két külön kulcs, ugyanaz a kezdés ugyanaz a kulcs", () => {
    const a = build();
    const b = build({ startedAt: new Date("2026-11-13T09:31:00.000Z") });
    const again = build();
    assert.ok(a.ok && b.ok && again.ok);
    if (a.ok && b.ok && again.ok) {
      assert.notEqual(a.operationId, b.operationId);
      assert.equal(a.operationId, again.operationId);
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GROUP_MAX_ASSETS,
  assetEntryForm,
  buildGroupEntries,
  commonTemplates,
  emptyGroupForm,
  operationsGroupId,
  perAssetFields,
  sharedFields,
  sharedSectionTitle,
} from "./group-form";
import type { OperationsTemplate, OperationsTemplateField } from "./types";

/*
  A CSOPORTOS RÖGZÍTÉS ŰRLAPJA (kártya 1a35e8f3). MI PIROSIT: ha a közös sablon nem MINDEN eszköz sablonja; ha a közös mezők nem a vízórák
  (vagy a többi mező is közös lenne); ha a közös vízóra nem kerül MINDEN eszköz bejegyzésére (egy eszköz előzménye csonka); ha az
  eszközönkénti mező egy másik eszköz értékét kapná; ha a csoport-azonosító nem minden bejegyzésen azonos, vagy ugyanarra az űrlapra
  más és más (a duplán megnyomott „Kész” második csoportot hozna); ha egy eszköz hibája miatt részleges csoport küldődne; ha a közös mező
  hibája az első eszköz nevével jönne; ha a rendellenesség közössé válna (egy hibajegy eszközönként nyílik).
*/
function field(
  key: string,
  type: OperationsTemplateField["type"],
  over: Partial<OperationsTemplateField> = {},
): OperationsTemplateField {
  return {
    id: `f-${key}`,
    key,
    label: key,
    type,
    unit: null,
    required: false,
    meterRole: null,
    sortOrder: 0,
    ...over,
  };
}

const template = (
  id = "t1",
  over: Partial<OperationsTemplate> = {},
): OperationsTemplate => ({
  id,
  name: "Homokszűrő visszamosás",
  description: null,
  frequency: "WEEKLY",
  fields: [
    field("elotte", "NUMBER", {
      unit: "m3",
      meterRole: "BEFORE",
      required: true,
    }),
    field("utana", "NUMBER", {
      unit: "m3",
      meterRole: "AFTER",
      required: true,
    }),
    field("visszamosas", "NUMBER", { unit: "perc", required: true }),
    field("oblites", "NUMBER", { unit: "perc" }),
  ],
  updatedAt: "2026-11-15T10:00:00.000Z",
  ...over,
});

const assets = [
  { id: "a1", label: "Homokszűrő 1" },
  { id: "a2", label: "Homokszűrő 2" },
  { id: "a3", label: "Homokszűrő 3" },
];
const NOW = new Date("2026-11-15T10:30:00.000Z");
const STARTED = new Date("2026-11-15T10:00:00.000Z");

function filledForm() {
  const form = emptyGroupForm(assets);
  form.startedAt = STARTED;
  form.shared = { elotte: "100", utana: "112,5" };
  form.participantIds = ["u2"];
  form.internalNote = "közös megjegyzés";
  form.perAsset.a1!.values = { visszamosas: "6", oblites: "2" };
  form.perAsset.a2!.values = { visszamosas: "8" };
  form.perAsset.a3!.values = { visszamosas: "7" };
  return form;
}

describe("a közös sablon és a közös mezők", () => {
  it("csak az a sablon közös, amely MINDEN eszköznél elérhető, az első eszköz sorrendjében", () => {
    const a = template("t1");
    const b = template("t2", { name: "Egyéb" });
    assert.deepEqual(
      commonTemplates([[a, b], [b, a], [a]]).map((t) => t.id),
      ["t1"],
    );
    assert.deepEqual(
      commonTemplates([
        [a, b],
        [b, a],
      ]).map((t) => t.id),
      ["t1", "t2"],
    );
  });

  it("nincs közös sablon: üres lista, sablon nélküli eszköz, üres kiválasztás", () => {
    assert.deepEqual(commonTemplates([[template("t1")], []]), []);
    assert.deepEqual(commonTemplates([]), []);
    assert.deepEqual(commonTemplates([[template("t1")], [template("t2")]]), []);
  });

  it("a közös mezők a vízórák, a többi eszközönként áll", () => {
    const t = template();
    assert.deepEqual(
      sharedFields(t).map((f) => f.key),
      ["elotte", "utana"],
    );
    assert.deepEqual(
      perAssetFields(t).map((f) => f.key),
      ["visszamosas", "oblites"],
    );
  });
});

describe("az eszközönkénti űrlap", () => {
  it("a közös rész és a saját rész együtt, a másik eszköz értéke nélkül, a rendellenesség eszközönként", () => {
    const form = filledForm();
    form.perAsset.a2!.anomaly = true;
    form.perAsset.a2!.anomalyNote = "szivárog";
    const one = assetEntryForm(form, "a1");
    assert.deepEqual(one.values, {
      visszamosas: "6",
      oblites: "2",
      elotte: "100",
      utana: "112,5",
    });
    assert.equal(one.anomaly, false);
    const two = assetEntryForm(form, "a2");
    assert.deepEqual(two.values, {
      visszamosas: "8",
      elotte: "100",
      utana: "112,5",
    });
    assert.equal(two.anomaly, true);
    assert.equal(two.anomalyNote, "szivárog");
  });
});

describe("a csoport bejegyzései", () => {
  it("minden eszközre külön bejegyzés, ugyanazzal a csoport-azonosítóval, a közös vízóra mindegyiken", () => {
    const built = buildGroupEntries({
      template: template(),
      assets,
      form: filledForm(),
      now: NOW,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.entries.length, 3);
    for (const entry of built.entries) {
      assert.equal(entry.payload.groupId, built.groupId);
      assert.equal(entry.payload.values.elotte, 100);
      assert.equal(entry.payload.values.utana, 112.5);
      assert.deepEqual(entry.payload.participantIds, ["u2"]);
      assert.equal(entry.payload.internalNote, "közös megjegyzés");
      assert.equal(entry.payload.startedAt, STARTED.toISOString());
    }
    // az eszközönkénti mező a SAJÁT értéke, és a művelet-azonosító eszközönként különbözik
    assert.deepEqual(
      built.entries.map((entry) => entry.payload.values.visszamosas),
      [6, 8, 7],
    );
    assert.equal(
      new Set(built.entries.map((entry) => entry.operationId)).size,
      3,
    );
    assert.match(built.groupId, /^[A-Za-z0-9_.:-]{8,64}$/);
  });

  it("ugyanarra az űrlapra ugyanaz a csoport-azonosító (a duplán megnyomott Kész nem hoz másodikat), más kezdésre más", () => {
    const first = buildGroupEntries({
      template: template(),
      assets,
      form: filledForm(),
      now: NOW,
    });
    const again = buildGroupEntries({
      template: template(),
      assets: [...assets].reverse(),
      form: filledForm(),
      now: new Date(NOW.getTime() + 5000),
    });
    assert.equal(first.ok && again.ok, true);
    if (!first.ok || !again.ok) return;
    assert.equal(first.groupId, again.groupId);
    const later = filledForm();
    later.startedAt = new Date(STARTED.getTime() + 1000);
    const other = buildGroupEntries({
      template: template(),
      assets,
      form: later,
      now: NOW,
    });
    assert.equal(other.ok, true);
    if (other.ok) assert.notEqual(other.groupId, first.groupId);
    assert.notEqual(
      operationsGroupId({
        templateId: "t1",
        startedAt: STARTED.toISOString(),
        assetIds: ["a1", "a2"],
      }),
      operationsGroupId({
        templateId: "t1",
        startedAt: STARTED.toISOString(),
        assetIds: ["a1", "a3"],
      }),
    );
  });

  it("egy eszköz hibája miatt SEMMI nem megy: az eszköz nevével, a közös hiba közös helyen, név nélkül", () => {
    const missing = filledForm();
    missing.perAsset.a2!.values = {};
    const asset = buildGroupEntries({
      template: template(),
      assets,
      form: missing,
      now: NOW,
    });
    assert.equal(asset.ok, false);
    if (!asset.ok) {
      assert.equal(asset.field, "asset:a2:visszamosas");
      assert.match(asset.message, /^Homokszűrő 2: /);
    }
    const noMeter = filledForm();
    noMeter.shared = { elotte: "100" };
    const common = buildGroupEntries({
      template: template(),
      assets,
      form: noMeter,
      now: NOW,
    });
    assert.equal(common.ok, false);
    if (!common.ok) {
      assert.equal(common.field, "shared:utana");
      assert.doesNotMatch(common.message, /Homokszűrő/);
    }
    const notStarted = filledForm();
    notStarted.startedAt = null;
    const start = buildGroupEntries({
      template: template(),
      assets,
      form: notStarted,
      now: NOW,
    });
    assert.equal(start.ok === false && start.field === "startedAt", true);
  });

  it("legalább két, legfeljebb tizenkét eszköz", () => {
    const one = buildGroupEntries({
      template: template(),
      assets: [assets[0]!],
      form: filledForm(),
      now: NOW,
    });
    assert.equal(one.ok === false && one.field === "group", true);
    const many = Array.from({ length: GROUP_MAX_ASSETS + 1 }, (_, index) => ({
      id: `x${index}`,
      label: `Eszköz ${index}`,
    }));
    const tooMany = buildGroupEntries({
      template: template(),
      assets: many,
      form: emptyGroupForm(many),
      now: NOW,
    });
    assert.equal(tooMany.ok === false && tooMany.field === "group", true);
  });

  it("a rendellenesség eszközönként: csak a megjelölt eszköz bejegyzésén van, és leírás nélkül hibás, az eszköz nevével", () => {
    const form = filledForm();
    form.perAsset.a3!.anomaly = true;
    form.perAsset.a3!.anomalyNote = "kopog";
    const built = buildGroupEntries({
      template: template(),
      assets,
      form,
      now: NOW,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual(
      built.entries.map((entry) => entry.payload.anomaly),
      [false, false, true],
    );
    form.perAsset.a3!.anomalyNote = "";
    const missing = buildGroupEntries({
      template: template(),
      assets,
      form,
      now: NOW,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.field, "asset:a3:anomalyNote");
      assert.match(missing.message, /^Homokszűrő 3: /);
    }
  });
});

/*
  EGYSÉGES RÖGZÍTÉS (kártya d2222173; Balázs, 2026-11-18 08:42 UTC: a csoportos bejegyzésnél az időpontokat egyszer kelljen beírni, minden
  eszköz megkapja). A sablon `uniformRecording` kapcsolója. MI PIROSIT: ha bekapcsolva egy szám, igen/nem vagy szöveg mező eszközönként
  maradna; ha a fénykép vagy a rendellenesség közössé válna (egy kép egy eszközt mutat, egy hibajegy egy eszközhöz tartozik); ha a közös
  érték nem kerülne MINDEN bejegyzésre; ha a közös kötelező mező hibája eszköz-névvel jönne; ha kikapcsolva vagy HIÁNYZÓ mezővel (régebbi
  szerver, régi gyorsítótár a telefonon) bármi másképp menne, mint eddig.
*/
const uniform = (on: boolean | undefined): OperationsTemplate => {
  const base = template("t1", {
    fields: [
      field("elotte", "NUMBER", {
        unit: "m3",
        meterRole: "BEFORE",
        required: true,
      }),
      field("utana", "NUMBER", {
        unit: "m3",
        meterRole: "AFTER",
        required: true,
      }),
      field("visszamosas", "NUMBER", { unit: "perc", required: true }),
      field("rendben", "BOOLEAN"),
      field("megjegyzes", "TEXT"),
      field("kep", "PHOTO"),
    ],
  });
  return on === undefined ? base : { ...base, uniformRecording: on };
};
const FILE = { uri: "file:///k.jpg", name: "k.jpg", type: "image/jpeg" };

describe("egységes rögzítés: a sablon kapcsolója", () => {
  it("bekapcsolva minden szám, igen/nem és szöveg mező közös, a fénykép eszközönként marad", () => {
    const t = uniform(true);
    assert.deepEqual(
      sharedFields(t).map((f) => f.key),
      ["elotte", "utana", "visszamosas", "rendben", "megjegyzes"],
    );
    assert.deepEqual(
      perAssetFields(t).map((f) => f.key),
      ["kep"],
    );
    assert.equal(sharedSectionTitle(t), "Közös értékek");
  });

  it("kikapcsolva és HIÁNYZÓ mezővel ugyanúgy, mint eddig: csak a vízóra közös", () => {
    for (const t of [uniform(false), uniform(undefined)]) {
      assert.deepEqual(
        sharedFields(t).map((f) => f.key),
        ["elotte", "utana"],
      );
      assert.deepEqual(
        perAssetFields(t).map((f) => f.key),
        ["visszamosas", "rendben", "megjegyzes", "kep"],
      );
      assert.equal(sharedSectionTitle(t), "Közös vízóra");
    }
  });

  it("bekapcsolva a közös érték egyszer beírva MINDEN bejegyzésre rákerül; a fénykép és a rendellenesség eszközönként", () => {
    const form = emptyGroupForm(assets);
    form.startedAt = STARTED;
    form.shared = {
      elotte: "100",
      utana: "112,5",
      visszamosas: "6",
      rendben: true,
      megjegyzes: "mindhárom egyszerre",
    };
    form.perAsset.a2!.photos = { kep: [FILE] };
    form.perAsset.a3!.anomaly = true;
    form.perAsset.a3!.anomalyNote = "kopog";
    const built = buildGroupEntries({
      template: uniform(true),
      assets,
      form,
      now: NOW,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    for (const entry of built.entries) {
      assert.equal(entry.payload.values.visszamosas, 6);
      assert.equal(entry.payload.values.rendben, true);
      assert.equal(entry.payload.values.megjegyzes, "mindhárom egyszerre");
      assert.equal(entry.payload.values.elotte, 100);
    }
    assert.deepEqual(
      built.entries.map((entry) => entry.photos.length),
      [0, 1, 0],
    );
    assert.deepEqual(
      built.entries.map((entry) => entry.payload.anomaly),
      [false, false, true],
    );
  });

  it("bekapcsolva a hiányzó közös kötelező mező hibája közös helyen jön, eszköz-név nélkül; kikapcsolva eszközönként, a névvel", () => {
    const form = emptyGroupForm(assets);
    form.startedAt = STARTED;
    form.shared = { elotte: "100", utana: "112,5" };
    const on = buildGroupEntries({
      template: uniform(true),
      assets,
      form,
      now: NOW,
    });
    assert.equal(on.ok, false);
    if (!on.ok) {
      assert.equal(on.field, "shared:visszamosas");
      assert.doesNotMatch(on.message, /^Homokszűrő/);
    }
    const off = buildGroupEntries({
      template: uniform(undefined),
      assets,
      form,
      now: NOW,
    });
    assert.equal(off.ok, false);
    if (!off.ok) {
      assert.equal(off.field, "asset:a1:visszamosas");
      assert.match(off.message, /^Homokszűrő 1: /);
    }
  });
});

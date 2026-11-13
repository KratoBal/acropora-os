import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PhotoPayload } from "../offline/queue-order";
import type { SaveOutcome } from "../offline/save-or-queue";
import { handleEntryPhotos, type EntryPhotoDeps } from "./entry-photos";

/*
  MI PIROSIT: ha egy kép a „felment" ágon elveszne a feltöltés hibájakor (a sorba kellene kerülnie); ha a kép a mező kulcsa nélkül
  kerülne a sorba (a szerver 400-at adna); ha a „nem jött létre" ágon a kép csendben eltűnne; ha ugyanaz a fájl két mezőhöz egy
  sorra esne össze; ha az online feltöltés és a sorba tett kép KÜLÖNBÖZŐ sor-azonosítót kapna (a már felment kép másodszor is
  elmenne).
*/
const A = { uri: "file:///c/a.jpg", name: "a.jpg", type: "image/jpeg" };
const B = { uri: "file:///c/b.png", name: "b.png", type: "image/png" };

function deps(over: { failUpload?: boolean; failEnqueue?: boolean } = {}) {
  const uploaded: { entryId: string; fieldKey: string; rowId: string }[] = [];
  const queued: {
    id: string;
    payload: PhotoPayload;
    ownerId?: string;
  }[] = [];
  const value: EntryPhotoDeps = {
    upload: async (entryId, photo, rowId) => {
      if (over.failUpload) throw new Error("nincs térerő");
      uploaded.push({ entryId, fieldKey: photo.fieldKey, rowId });
    },
    enqueue: async (item) => {
      if (over.failEnqueue) return { ok: false, error: "tele a lemez" };
      queued.push({
        id: item.id,
        payload: item.payload,
        ownerId: item.ownerId,
      });
      return { ok: true, operationId: item.id };
    },
  };
  return { value, uploaded, queued };
}

const photos = [
  { fieldKey: "elotte_kep", file: A },
  { fieldKey: "utana_kep", file: A },
  { fieldKey: "utana_kep", file: B },
];

const run = (outcome: SaveOutcome, d = deps()) =>
  handleEntryPhotos({
    outcome,
    photos,
    createdAt: "2026-11-13T10:00:00.000Z",
    deps: d.value,
  });

describe("a fénykép mezők képei a rögzítés után", () => {
  it("kép nélkül nincs teendő és nincs mit mondani", async () => {
    assert.equal(
      await handleEntryPhotos({
        outcome: { type: "saved", id: "e1" },
        photos: [],
        createdAt: "x",
        deps: deps().value,
      }),
      null,
    );
  });

  it("felment: a képek azonnal mennek, a sor-azonosító közös a sorba tett alakkal", async () => {
    const d = deps();
    assert.equal(
      await run({ type: "saved", id: "e1" }, d),
      "3 fénykép feltöltve.",
    );
    assert.equal(d.queued.length, 0);
    assert.deepEqual(
      d.uploaded.map((u) => [u.entryId, u.fieldKey]),
      [
        ["e1", "elotte_kep"],
        ["e1", "utana_kep"],
        ["e1", "utana_kep"],
      ],
    );
    // ugyanaz a fájl két mezőhöz két külön sor, és mind a három azonosító különbözik
    assert.equal(new Set(d.uploaded.map((u) => u.rowId)).size, 3);
  });

  it("felment, de a feltöltés bukik: a kép a sorba megy a bejegyzés alá, ugyanazzal az azonosítóval", async () => {
    const ok = deps();
    await run({ type: "saved", id: "e1" }, ok);
    const failing = deps({ failUpload: true });
    const message = await run({ type: "saved", id: "e1" }, failing);
    assert.match(message ?? "", /3 fénykép is vár feltöltésre/);
    assert.deepEqual(
      failing.queued.map((q) => q.id),
      ok.uploaded.map((u) => u.rowId),
    );
    for (const q of failing.queued) {
      assert.equal(q.ownerId, "e1");
      assert.ok(q.payload.fieldKey);
      assert.equal(q.payload.recordingOperationId, undefined);
    }
  });

  it("a rögzítés a sorban vár: a képek a műveletazonosító alá kerülnek, a mező kulcsával", async () => {
    const d = deps();
    const message = await run(
      { type: "queued", operationId: "operations-entry:a:b:c", message: "m" },
      d,
    );
    assert.match(message ?? "", /3 fénykép is vár feltöltésre/);
    assert.equal(d.uploaded.length, 0);
    assert.deepEqual(
      d.queued.map((q) => q.payload.fieldKey),
      ["elotte_kep", "utana_kep", "utana_kep"],
    );
    for (const q of d.queued) {
      assert.equal(q.payload.recordingOperationId, "operations-entry:a:b:c");
      assert.equal(q.ownerId, undefined);
    }
    assert.equal(new Set(d.queued.map((q) => q.id)).size, 3);
  });

  it("a sorba tétel hibája kimondva marad, nem tűnik el", async () => {
    const message = await run(
      { type: "queued", operationId: "operations-entry:a:b:c", message: "m" },
      deps({ failEnqueue: true }),
    );
    assert.match(message ?? "", /3 fényképet NEM sikerült a telefonra menteni/);
  });

  it("ha a rögzítés nem jött létre, a képekről szól a mondat", async () => {
    for (const outcome of [
      { type: "rejected", message: "m" },
      { type: "lost", message: "m" },
    ] as const) {
      const d = deps();
      assert.match(
        (await run(outcome, d)) ?? "",
        /3 fényképet nem tudtuk hova tenni/,
      );
      assert.equal(d.uploaded.length + d.queued.length, 0);
    }
  });
});

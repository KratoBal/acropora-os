import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describePhotoQueueing,
  planPhotosAfterRecord,
  queuePhotosForRecording,
} from "./photo-after-record";
import type { SaveOutcome } from "../offline/save-or-queue";

/**
 * A ROGZITESNEK NEGY VEGE VAN, ES A KEP SORSA MIND A NEGYNEL MAS.
 *
 * A ket utolso (`rejected`, `lost`) a veszelyes: ott a kep a kezunkben marad,
 * es ha hallgatunk rola, a szerelo azt hiszi, felment.
 */

const kep = (nev: string) => ({
  uri: `file:///${nev}`,
  name: nev,
  type: "image/jpeg",
});

describe("mi lesz a helyszíni képpel", () => {
  it("MENTETT rögzítésnél a kép MOST megy fel", () => {
    const terv = planPhotosAfterRecord({ type: "saved", id: "eszkoz-1" }, [
      kep("a.jpg"),
    ]);
    assert.deepEqual(terv, {
      type: "upload",
      ownerId: "eszkoz-1",
      files: [kep("a.jpg")],
    });
  });

  it("SORBA KERÜLT rögzítésnél a kép a MŰVELET-AZONOSÍTÓ alá megy", () => {
    /*
      Nem a szerver-oldali eszkoz-azonosito ala: az a felvitel felmenetelekor
      keletkezik, es itt MEG NEM LETEZIK. A muvelet-azonosito koti ossze a
      kettot, amig a szerver-azonosito nincs meg.
    */
    const terv = planPhotosAfterRecord(
      { type: "queued", operationId: "asset-create:V2196:t", message: "" },
      [kep("a.jpg")],
    );
    assert.deepEqual(terv, {
      type: "queue",
      recordingOperationId: "asset-create:V2196:t",
      files: [kep("a.jpg")],
    });
  });

  for (const outcome of [
    { type: "rejected", message: "a szerver elutasította" },
    { type: "lost", message: "a felvitel elveszett" },
  ] as SaveOutcome[]) {
    it(`${outcome.type} rögzítésnél KIMONDJUK, hogy a képnek nincs gazdája`, () => {
      /*
        MI PIROSIT: egy csendes eldobas. A kep ilyenkor sehova nem kerul, es ha
        nem szolunk rola, a szerelo azt hiszi, felment -- a hiba pedig napokkal
        kesobb, mashol derul ki.
      */
      const terv = planPhotosAfterRecord(outcome, [kep("a.jpg")]);
      assert.equal(terv.type, "dropped");
      assert.match(
        terv.type === "dropped" ? terv.message : "",
        /nem jött létre/,
      );
    });
  }

  it("kép NÉLKÜL nincs teendő és nincs mit mondani", () => {
    // ISMERT POZITIV KONTROLL a fentiekhez: e nelkul egy "mindig szol"
    // valtozat is atmenne rajtuk.
    assert.deepEqual(
      planPhotosAfterRecord({ type: "saved", id: "eszkoz-1" }, []),
      { type: "none" },
    );
    assert.deepEqual(
      planPhotosAfterRecord({ type: "lost", message: "elveszett" }, []),
      { type: "none" },
    );
  });
});

describe("a sorba tétel eredménye", () => {
  it("teljes sikernél egy mondat, panasz nélkül", () => {
    assert.match(
      describePhotoQueueing({ queued: 2, failed: 0 }) ?? "",
      /2 fénykép is vár feltöltésre/,
    );
  });

  it("RÉSZLEGES sikernél a kimaradt képet KÜLÖN mondja", () => {
    /*
      EZ AZ ALLITAS A FUGGVENY LETEZESENEK OKA. Egy "3 kep var feltoltesre"
      mondat egy negyedik, elveszett kep mellett is IGAZ lenne -- es epp az a
      kep veszne el csendben, amirol a szerelo azt hiszi, megvan.
    */
    const s = describePhotoQueueing({ queued: 3, failed: 1 });
    assert.match(s ?? "", /3 fénykép vár feltöltésre/);
    assert.match(s ?? "", /1 viszont NEM került a sorba/);
  });

  it("ha EGY sem került be, az nem részleges siker", () => {
    const s = describePhotoQueueing({ queued: 0, failed: 2 });
    assert.match(s ?? "", /2 fényképet NEM sikerült/);
    assert.doesNotMatch(s ?? "", /vár feltöltésre/);
  });

  it("nulla képnél nincs mondat", () => {
    assert.equal(describePhotoQueueing({ queued: 0, failed: 0 }), null);
  });
});

describe("a képek sorba tétele", () => {
  it("minden kép a ROGZITES azonosítója alá kerül, tartalomból képzett kulccsal", async () => {
    /*
      A payload a rogzites MUVELET-azonositojat viszi, nem a szerver-oldali
      eszkoz-azonositot: az a felvitel felmenetelekor keletkezik, es itt meg
      nem letezik. A sor KULCSA a tartalombol szuletik, tehat a ketszer
      megnyomott gomb ugyanazt a sort adja.
    */
    const sorok: { id: string; recording: string }[] = [];
    const r = await queuePhotosForRecording({
      recordingOperationId: "asset-create:V2196:t",
      files: [kep("a.jpg"), kep("b.jpg")],
      createdAt: "2026-09-03T09:00:00Z",
      enqueue: async (input) => {
        sorok.push({
          id: input.id,
          recording: input.payload.recordingOperationId,
        });
        return { ok: true, operationId: input.id };
      },
    });
    assert.deepEqual(r, { queued: 2, failed: 0 });
    assert.deepEqual(
      sorok.map((s) => s.recording),
      ["asset-create:V2196:t", "asset-create:V2196:t"],
    );
    // A ket kulcs KULONBOZIK (a fajl utja is benne van), es UGYANAZ a kep
    // ugyanahhoz a rogziteshez ugyanazt adna.
    assert.equal(new Set(sorok.map((s) => s.id)).size, 2);
    assert.match(sorok[0]?.id ?? "", /^asset-photo:asset-create:V2196:t:/);
  });

  it("egy elbukott beszúrás NEM állítja meg a többit, de MEGSZÁMOLJUK", async () => {
    /*
      MI PIROSIT: ha a ciklus az elso hibanal kilepne, vagy ha a bukast
      elnyelnenk. Az elso ket kepet vinne el, a masodik egyet -- es mindketto
      CSENDBEN: a szerelo egy zold mondatot latna.
    */
    const r = await queuePhotosForRecording({
      recordingOperationId: "r1",
      files: [kep("a.jpg"), kep("b.jpg"), kep("c.jpg")],
      createdAt: "2026-09-03T09:00:00Z",
      enqueue: async (input) =>
        input.payload.name === "b.jpg"
          ? { ok: false, error: "tele a lemez" }
          : { ok: true, operationId: input.id },
    });
    assert.deepEqual(r, { queued: 2, failed: 1 });
  });

  it("kép nélkül nem hív semmit", async () => {
    // ISMERT POZITIV KONTROLL a fentiekhez: e nelkul egy "mindig hiv egyet"
    // valtozat is atmenne rajtuk.
    let hivas = 0;
    const r = await queuePhotosForRecording({
      recordingOperationId: "r1",
      files: [],
      createdAt: "2026-09-03T09:00:00Z",
      enqueue: async (input) => {
        hivas += 1;
        return { ok: true, operationId: input.id };
      },
    });
    assert.equal(hivas, 0);
    assert.deepEqual(r, { queued: 0, failed: 0 });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PickedFile } from "../api/picked-image";
import {
  describePhotoSend,
  uploadOrQueuePhotos,
  type PhotoSendOutcome,
} from "./photo-upload-or-queue";

const kep = (nev: string): PickedFile => ({
  uri: `file:///${nev}`,
  name: nev,
  type: "image/jpeg",
});

const alap = {
  upload: async () => ({ count: 0 }),
  enqueue: async () => true,
  statusOf: () => null,
  describeRejection: () => "elutasítva",
};

describe("uploadOrQueuePhotos", () => {
  it("does nothing when there is nothing to send", async () => {
    assert.deepEqual(await uploadOrQueuePhotos({ ...alap, files: [] }), {
      type: "none",
    });
  });

  /**
   * A SZERVER SZÁMA MEGY TOVÁBB, NEM AMIT KÜLDTÜNK. Ha hármat küldünk és a
   * szerver kettőt fogad el, a „3 kép feltöltve" HAZUDNA -- és épp a harmadikról,
   * amiről a szerelő azt hinné, megvan.
   */
  it("reports the count the server gave back", async () => {
    const r = await uploadOrQueuePhotos({
      ...alap,
      files: [kep("a.jpg"), kep("b.jpg"), kep("c.jpg")],
      upload: async () => ({ count: 2 }),
    });
    assert.deepEqual(r, { type: "uploaded", count: 2 });
  });

  /**
   * EGY VÁLASZOLT HIBA NEM SORBÓL VALÓ. Egy 413 vagy egy 400 ugyanúgy jönne a
   * sorból is, ÖRÖKRE -- és a szerelő azt látná, hogy „vár feltöltésre".
   */
  it("does not queue what the server answered and refused", async () => {
    let sorba = 0;
    const r = await uploadOrQueuePhotos({
      ...alap,
      files: [kep("a.jpg")],
      upload: async () => {
        throw new Error("túl nagy");
      },
      statusOf: () => 413,
      enqueue: async () => {
        sorba += 1;
        return true;
      },
    });
    assert.deepEqual(r, { type: "rejected", message: "elutasítva" });
    assert.equal(sorba, 0, "egy elutasított kép NEM kerülhet a sorba");
  });

  it("queues every file when the server was not reached", async () => {
    const r = await uploadOrQueuePhotos({
      ...alap,
      files: [kep("a.jpg"), kep("b.jpg")],
      upload: async () => {
        throw new Error("nincs hálózat");
      },
    });
    assert.deepEqual(r, { type: "queued", queued: 2, failed: 0 });
  });

  /**
   * EGY BUKÁS NEM ÁLLÍTJA MEG A TÖBBIT, DE MEGSZÁMOLJUK. A kimaradt kép SEHOL
   * nincs meg, és csak újrafényképezéssel pótolható.
   */
  it("counts the ones that could not be written, and keeps going", async () => {
    const r = await uploadOrQueuePhotos({
      ...alap,
      files: [kep("a.jpg"), kep("b.jpg"), kep("c.jpg")],
      upload: async () => {
        throw new Error("nincs hálózat");
      },
      enqueue: async (f) => f.name !== "b.jpg",
    });
    assert.deepEqual(r, { type: "queued", queued: 2, failed: 1 });
  });
});

describe("describePhotoSend", () => {
  const eset = (o: PhotoSendOutcome) => describePhotoSend(o, []);

  it("says nothing when nothing happened at all", () => {
    assert.equal(describePhotoSend({ type: "none" }, []), null);
  });

  /**
   * A HÁROM SORBA-TÉTEL ÁG HÁROM KÜLÖN MONDAT, mert a teendőjük más: a sorba
   * KERÜLT kép magától felmegy, a KIMARADT viszont elveszett.
   */
  it("tells the three queued cases apart", () => {
    const mind = [
      eset({ type: "queued", queued: 2, failed: 0 }),
      eset({ type: "queued", queued: 0, failed: 2 }),
      eset({ type: "queued", queued: 1, failed: 1 }),
    ];
    assert.equal(new Set(mind).size, 3, `nem három külön mondat: ${mind}`);
    // AMI ELVESZETT, AZT KI KELL MONDANI, es a teendot is.
    assert.match(mind[1] ?? "", /fényképezd újra/);
    assert.match(mind[2] ?? "", /fényképezd újra/);
    // AMI A SORBAN VAR, ARROL viszont NE mondjuk, hogy elveszett.
    assert.doesNotMatch(mind[0] ?? "", /elvesz|fényképezd újra/);
  });

  /**
   * A SORBAN VÁRÓ KÉP MONDATA MEGMONDJA, HOGY MAGÁTÓL FELMEGY. Enélkül a
   * szerelő azt hinné, neki kell újra megnyomnia -- és a második megnyomás egy
   * második sort adna.
   */
  it("says the queued photo goes up by itself", () => {
    assert.match(
      eset({ type: "queued", queued: 1, failed: 0 }) ?? "",
      /magától felmegy/,
    );
  });

  /**
   * A KIHAGYOTT FÁJLOK MINDEN ÁGON MEGJELENNEK, mert azok a VÁLASZTÁSNÁL estek
   * ki, nem a küldésnél -- és egy csendben eldobott HEIC ugyanúgy néz ki, mint
   * egy sikeres választás.
   */
  it("names the skipped files on every branch", () => {
    const agak: PhotoSendOutcome[] = [
      { type: "uploaded", count: 1 },
      { type: "queued", queued: 1, failed: 0 },
      { type: "rejected", message: "túl nagy" },
      { type: "none" },
    ];
    for (const ag of agak)
      assert.match(
        describePhotoSend(ag, ["IMG_1.HEIC"]) ?? "",
        /IMG_1\.HEIC/,
        `a(z) ${ag.type} ág elhallgatja a kihagyott fájlt`,
      );
  });
});

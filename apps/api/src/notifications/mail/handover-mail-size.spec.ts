import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  base64Meret,
  handoverAttachmentVerdict,
  handoverMailMaxAttachmentBytes,
  HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT,
} from "./handover-mail-size.js";

describe("handoverMailMaxAttachmentBytes", () => {
  it("beállítás nélkül az alapértelmezés áll", () => {
    assert.equal(
      handoverMailMaxAttachmentBytes({}),
      HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT,
    );
  });

  it("a beállított érték felülírja", () => {
    assert.equal(
      handoverMailMaxAttachmentBytes({
        HANDOVER_MAIL_MAX_ATTACHMENT_BYTES: "1000",
      }),
      1000,
    );
  });

  /**
   * EZ A KESZLET LEGFONTOSABB ALLITASA.
   *
   * Egy elgepelt kornyezeti valtozotol a kapu NEM nyilhat ki. `NaN` mellett
   * MINDEN osszehasonlitas hamis, tehat a `kodolt <= limit` is -- ami onmagaban
   * meg jo iranyba tevedne --, DE egy `0` vagy egy negativ ertek mellett a kapu
   * minden csomagot megtagadna, es a kuldes NEMAN allna le.
   *
   * Mindket iranyra kell allitas, mert a ket hiba ARA MAS: a tul szigoru
   * hangos (senki nem tud kuldeni), a tul megengedo NEMA (kimegy, amit nem
   * kellett volna).
   */
  it("értelmezhetetlen érték mellett az alapértelmezés áll, nem a korlátlan", () => {
    for (const rossz of ["", "   ", "abc", "0", "-1", "4MB"])
      assert.equal(
        handoverMailMaxAttachmentBytes({
          HANDOVER_MAIL_MAX_ATTACHMENT_BYTES: rossz,
        }),
        HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT,
        `a(z) ${JSON.stringify(rossz)} érték nem az alapértelmezésre esett vissza`,
      );
  });
});

describe("base64Meret", () => {
  /**
   * A KAPU A BASE64 UTANI MERETEN ALL, es ez a ket szam kulonbsege.
   * Harom bajtbol negy karakter lesz: a novekedes egyharmad.
   */
  it("három bájtból négy karakter lesz", () => {
    assert.equal(base64Meret(3), 4);
    assert.equal(base64Meret(3 * 1024 * 1024), 4 * 1024 * 1024);
  });
});

describe("handoverAttachmentVerdict", () => {
  it("a mai méret (~100 KB) bőven átmegy", () => {
    assert.deepEqual(
      handoverAttachmentVerdict({ bytes: 58_553, limit: 4 * 1024 * 1024 }),
      { kind: "ok" },
    );
  });

  /**
   * A HATART A KODOLT MERET DONTI EL, NEM A NYERS.
   *
   * Ez a bemenet NYERSEN a határ ALATT áll (4 MB pontosan), kódolva viszont
   * FÖLÖTTE (5,33 MB). Ha a kapu a nyers hosszra nézne, ez a csomag átmenne --
   * és a másik oldalon már túl nagy lenne.
   */
  it("a nyersen határon álló csomag kódolva már túl nagy", () => {
    const v = handoverAttachmentVerdict({
      bytes: 4 * 1024 * 1024,
      limit: 4 * 1024 * 1024,
    });
    assert.equal(v.kind, "too-large");
  });

  /**
   * A HIBAUZENET KET DOLGOT MOND MEG, es mind a ketto kikotes volt: a MERETET,
   * es hogy a letoltes JARHATO UT. Enelkul a kezelo annyit latna, hogy nem ment
   * ki, es nem tudna, mit tegyen.
   */
  it("a megtagadás megmondja a méretet és a járható utat", () => {
    const v = handoverAttachmentVerdict({
      bytes: 9 * 1024 * 1024,
      limit: 4 * 1024 * 1024,
    });
    assert.equal(v.kind, "too-large");
    if (v.kind !== "too-large") return;
    assert.match(v.message, /KB/);
    assert.match(v.message, /letöltés/);
  });
});

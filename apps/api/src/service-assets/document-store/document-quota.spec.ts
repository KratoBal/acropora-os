import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideQuota, QUOTA_WARN_RATIO } from "./document-quota.js";

const MB = 1024 * 1024;

describe("the photo storage quota", () => {
  it("lets a small upload through well under the limit", () => {
    const decision = decideQuota({
      usedBytes: 10 * MB,
      incomingBytes: 1 * MB,
      limitBytes: 100 * MB,
    });

    assert.equal(decision.state, "ok");
    assert.equal(decision.usedAfterBytes, 11 * MB);
  });

  /**
   * A HATÁR PONTOS ELÉRÉSE MÉG BELEFÉR. A keret azt mondja meg, mennyi hely
   * van, nem azt, meddig szabad elmenni: egy pontosan telire töltött tárhely
   * nem hibás állapot.
   *
   * EZ AZ ÁLLÍTÁS AZÉRT KELL, mert a `>` és a `>=` közti választás itt dől el,
   * és a kettő közül csak az egyik hibázik ezen a bemeneten.
   */
  it("accepts an upload that fills the limit exactly", () => {
    const decision = decideQuota({
      usedBytes: 99 * MB,
      incomingBytes: 1 * MB,
      limitBytes: 100 * MB,
    });

    assert.notEqual(decision.state, "reject");
    assert.equal(decision.usedAfterBytes, 100 * MB);
  });

  it("rejects the byte that goes over the limit", () => {
    const decision = decideQuota({
      usedBytes: 100 * MB,
      incomingBytes: 1,
      limitBytes: 100 * MB,
    });

    assert.equal(decision.state, "reject");
    assert.ok(decision.reason?.includes("Betelt a fotó-tárhely"));
  });

  /**
   * AZ ELUTASÍTÁS MEGNEVEZI, MI TELT BE. Egy általános „a feltöltés nem
   * sikerült" megkülönböztethetetlen egy hálózati hibától, és a felhasználó
   * újrapróbálná, amíg fel nem adja.
   */
  it("says what ran out, not just that it failed", () => {
    const decision = decideQuota({
      usedBytes: 100 * MB,
      incomingBytes: 5 * MB,
      limitBytes: 100 * MB,
    });

    assert.equal(decision.state, "reject");
    assert.ok(decision.reason?.includes("fotó-tárhely"));
    assert.ok(decision.reason?.includes("MiB"));
  });

  /**
   * A JELZÉS A FELTÖLTÉS UTÁNI ÁLLAPOTRA VONATKOZIK. Az érdekes pillanat az,
   * amikor egy feltöltés ÁTVISZI a határon, nem az, amikor már fölötte
   * vagyunk: az elsőnél még van idő helyet szerezni.
   *
   * A BEMENET OLYAN, AHOL MINDEN MÁS FELTÉTEL IGAZ: a feltöltés belefér a
   * keretbe, tehát nem az elutasítás miatt lesz más az eredmény.
   */
  it("warns on the upload that crosses the threshold, not before it", () => {
    const under = decideQuota({
      usedBytes: 70 * MB,
      incomingBytes: 5 * MB,
      limitBytes: 100 * MB,
    });
    const crossing = decideQuota({
      usedBytes: 79 * MB,
      incomingBytes: 5 * MB,
      limitBytes: 100 * MB,
    });

    assert.equal(under.state, "ok");
    assert.equal(crossing.state, "warn");
  });

  it("warns exactly at the threshold, not one byte later", () => {
    const decision = decideQuota({
      usedBytes: 0,
      incomingBytes: QUOTA_WARN_RATIO * 100 * MB,
      limitBytes: 100 * MB,
    });

    assert.equal(decision.state, "warn");
    assert.equal(decision.usedRatio, QUOTA_WARN_RATIO);
  });

  /**
   * A KÉT ÜZENET KÉT KÜLÖNBÖZŐ EMBERNEK SZÓL, és ez a szétválasztás a lényeg:
   * a `warn` nekünk, a `reject` a feltöltőnek. Ha a `warn` a feltöltőhöz
   * jutna, egy sikeres feltöltés után kapna riasztást arról, amin nem tud
   * segíteni.
   */
  it("keeps the warning separate from the rejection", () => {
    const warn = decideQuota({
      usedBytes: 85 * MB,
      incomingBytes: 1 * MB,
      limitBytes: 100 * MB,
    });

    assert.equal(warn.state, "warn");
    assert.ok(!warn.reason?.includes("Betelt"));
  });

  /**
   * ÉRTELMETLEN BEMENET NEM DÖNTÉS, HANEM HIBA. Egy nulla keret mellett az
   * `ok` átengedne egy olyan feltöltést, amiről semmit nem tudunk, a `reject`
   * pedig azt állítaná, hogy a tárhely telt be -- holott nincs is tárhely.
   */
  it("refuses to decide on input it cannot interpret", () => {
    assert.throws(
      () => decideQuota({ usedBytes: -1, incomingBytes: 1, limitBytes: 100 }),
      /felhasznált hely/,
    );
    assert.throws(
      () => decideQuota({ usedBytes: 0, incomingBytes: -1, limitBytes: 100 }),
      /feltöltés mérete/,
    );
    assert.throws(
      () => decideQuota({ usedBytes: 0, incomingBytes: 1, limitBytes: 0 }),
      /keret/,
    );
    assert.throws(
      () =>
        decideQuota({ usedBytes: 0, incomingBytes: Number.NaN, limitBytes: 1 }),
      /feltöltés mérete/,
    );
  });

  /**
   * A NULLA BÁJTOS FELTÖLTÉS NEM A KERET DOLGA. Üres fájlt elutasítani helyes
   * lehet, de az MÁS kérdés (a feltöltés érvényessége), és ha itt döntenénk
   * róla, két helyen kellene karbantartani ugyanazt a szabályt.
   */
  it("has no opinion about a zero-byte upload", () => {
    const decision = decideQuota({
      usedBytes: 10 * MB,
      incomingBytes: 0,
      limitBytes: 100 * MB,
    });

    assert.equal(decision.state, "ok");
    assert.equal(decision.usedAfterBytes, 10 * MB);
  });
});

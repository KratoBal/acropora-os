import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hashLinkCode,
  LINK_CODE_ALPHABET,
  newLinkCode,
  normalizeLinkCode,
} from "./reefclub-link-code.js";
import { FailureLock } from "./reefclub-rate-limits.js";

describe("ReefClub összekapcsolási kód", () => {
  it("tíz karakter az összetéveszthető betűk nélkül, ötös csoportokban", () => {
    for (let index = 0; index < 200; index++) {
      const code = newLinkCode();
      assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      assert.doesNotMatch(code, /[IO01]/);
    }
    assert.equal(LINK_CODE_ALPHABET.length, 32);
  });

  it("a beírt alak kisbetűvel, szóközzel, kötőjel nélkül is ugyanaz a kód", () => {
    const code = newLinkCode();
    const stored = normalizeLinkCode(code);
    assert.ok(stored);
    assert.equal(
      normalizeLinkCode(code.toLowerCase().replace("-", " ")),
      stored,
    );
    assert.equal(normalizeLinkCode(` ${code.replace("-", "")} `), stored);
    assert.equal(hashLinkCode(stored), hashLinkCode(normalizeLinkCode(code)!));
  });

  it("rossz hossz vagy ábécén kívüli karakter: nem kód", () => {
    assert.equal(normalizeLinkCode("ABCDE-FGHJ"), null);
    assert.equal(normalizeLinkCode("ABCDE-FGHJKL"), null);
    assert.equal(normalizeLinkCode("ABCDE-FGHJO"), null);
    assert.equal(normalizeLinkCode("ABCDE-FGH10"), null);
  });
});

describe("FailureLock", () => {
  it("a határig nyitott, a határon zár, és az ablak után újra nyit", () => {
    const lock = new FailureLock(5, 60_000);
    for (let index = 0; index < 4; index++) lock.fail("a", 1_000 + index);
    assert.equal(lock.locked("a", 2_000), false);
    assert.equal(lock.fail("a", 2_000), 5);
    assert.equal(lock.locked("a", 2_000), true);
    assert.equal(lock.locked("b", 2_000), false);
    assert.equal(lock.locked("a", 62_001), false);
  });

  it("a kérdés nem számol: egy zárt kulcs nem zár mélyebbre attól, hogy kérdezik", () => {
    const lock = new FailureLock(2, 60_000);
    for (let index = 0; index < 10; index++) lock.locked("a", 1_000);
    assert.equal(lock.locked("a", 1_000), false);
  });

  it("a kulcsok száma korlátos", () => {
    const lock = new FailureLock(5, 60_000, 100);
    for (let index = 0; index < 1_000; index++) lock.fail(`k${index}`, 1_000);
    assert.equal(lock.locked("k999", 1_000), false);
    assert.equal(lock.fail("k999", 1_000), 2);
  });
});

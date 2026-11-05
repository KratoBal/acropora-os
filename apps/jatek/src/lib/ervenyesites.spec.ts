import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_VALASZ, bekuldesKeres, megerositesKeres } from "./ervenyesites.ts";

/*
  WHAT TURNS THIS RED. A request with a missing or non-string field reaching the api; an answer over 200
  characters, or only spaces, accepted; an address without an @ or a dot accepted; the honeypot field dropped or
  trimmed away on the way (the api decides what to do with it); a token of another shape accepted.
*/
const jo = {
  questionId: "q1",
  email: "jatekos@example.com",
  answer: "acropora",
  website: "",
};

describe("bekuldesKeres", () => {
  it("passes a good request on, with the answer trimmed and the honeypot kept", () => {
    const r = bekuldesKeres({
      ...jo,
      answer: "  acropora  ",
      email: " jatekos@example.com ",
    });
    assert.deepEqual(r, { ok: true, value: { ...jo } });
    const csali = bekuldesKeres({ ...jo, website: "http://spam.example" });
    assert.ok(csali.ok && csali.value.website === "http://spam.example");
  });

  it("a missing honeypot field is an empty one", () => {
    const { website: _w, ...nelkul } = jo;
    const r = bekuldesKeres(nelkul);
    assert.ok(r.ok && r.value.website === "");
  });

  it("refuses a bad address, with its own code", () => {
    for (const email of [
      "",
      "nincs-kukac",
      "a@b",
      "a b@c.hu",
      "@x.hu",
      `${"a".repeat(250)}@x.hu`,
    ])
      assert.deepEqual(
        bekuldesKeres({ ...jo, email }),
        { ok: false, code: "INVALID_EMAIL" },
        email,
      );
  });

  it("refuses an empty, blank or over-long answer", () => {
    for (const answer of ["", "   ", "x".repeat(MAX_VALASZ + 1)])
      assert.deepEqual(bekuldesKeres({ ...jo, answer }), {
        ok: false,
        code: "INVALID_ANSWER",
      });
    assert.ok(bekuldesKeres({ ...jo, answer: "x".repeat(MAX_VALASZ) }).ok);
  });

  it("refuses a body of the wrong shape", () => {
    for (const body of [
      null,
      undefined,
      "szoveg",
      5,
      [],
      { ...jo, questionId: 7 },
      { ...jo, questionId: "" },
    ])
      assert.equal(bekuldesKeres(body).ok, false, JSON.stringify(body));
    assert.deepEqual(bekuldesKeres({ ...jo, answer: 5 }), {
      ok: false,
      code: "INVALID_ANSWER",
    });
  });
});

describe("megerositesKeres", () => {
  it("accepts a token of the usual alphabet", () => {
    const r = megerositesKeres({ token: "abcDEF123_-.~xyz" });
    assert.deepEqual(r, { ok: true, value: { token: "abcDEF123_-.~xyz" } });
  });

  it("refuses an empty, short, long or oddly shaped token, and a body of the wrong shape", () => {
    for (const token of [
      "",
      "kurta",
      "a".repeat(201),
      "ab cd ef gh",
      "<script>alert(1)</script>",
      12345678,
    ])
      assert.deepEqual(
        megerositesKeres({ token }),
        { ok: false, code: "INVALID_TOKEN" },
        String(token),
      );
    for (const body of [null, "x", {}, []])
      assert.equal(megerositesKeres(body).ok, false);
  });
});

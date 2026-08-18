import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { personDisplayName } from "./person-name";

describe("personDisplayName", () => {
  it("uses the nickname when there is one", () => {
    assert.equal(
      personDisplayName({ displayName: "Kovács Béla", nickname: "Bébé" }),
      "Bébé",
    );
  });

  it("falls back to the full name when there is none", () => {
    assert.equal(
      personDisplayName({ displayName: "Kovács Béla" }),
      "Kovács Béla",
    );
    assert.equal(
      personDisplayName({ displayName: "Kovács Béla", nickname: null }),
      "Kovács Béla",
    );
  });

  it("treats an empty or whitespace nickname as none", () => {
    assert.equal(
      personDisplayName({ displayName: "Kovács Béla", nickname: "" }),
      "Kovács Béla",
    );
    assert.equal(
      personDisplayName({ displayName: "Kovács Béla", nickname: "   " }),
      "Kovács Béla",
    );
  });

  it("trims a nickname that has room around it", () => {
    assert.equal(
      personDisplayName({ displayName: "Kovács Béla", nickname: "  Bébé " }),
      "Bébé",
    );
  });

  it("never returns an empty string", () => {
    // Whatever happens, a screen must not end up showing a blank where a
    // colleague's name belongs.
    for (const nickname of [undefined, null, "", "  "]) {
      assert.notEqual(personDisplayName({ displayName: "N", nickname }), "");
    }
  });
});

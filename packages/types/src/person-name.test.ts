import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { personDisplayName, personLegalName } from "./person-name.js";

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
    // A stray space typed into a form must not blank out a person's name
    // on every screen that shows them.
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
    for (const nickname of [undefined, null, "", "  "]) {
      assert.notEqual(personDisplayName({ displayName: "N", nickname }), "");
    }
  });
});

describe("personLegalName", () => {
  it("is the full name even when a nickname exists", () => {
    // Documents and signatures say who somebody officially is. This is a
    // separate function so that choosing it is deliberate.
    assert.equal(
      personLegalName({ displayName: "Kovács Béla", nickname: "Bébé" }),
      "Kovács Béla",
    );
  });
});

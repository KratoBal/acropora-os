import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  personDisplayName,
  personGivenName,
  personLegalName,
} from "./person-name.js";

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

describe("personGivenName", () => {
  it("takes the SECOND word of the full name, not the first", () => {
    // displayName is built server-side as `${lastName} ${firstName}`
    // (users.repository.ts displayNameOf) -- Hungarian order, family name
    // first. The given name is the word after it, not the word before it.
    assert.equal(personGivenName({ displayName: "Kovács Béla" }), "Béla");
  });

  it("uses the nickname AS-IS, without splitting it", () => {
    assert.equal(
      personGivenName({ displayName: "Kovács Béla", nickname: "Bébé" }),
      "Bébé",
    );
  });

  it("a two-word nickname is not treated as LastName FirstName", () => {
    // The nickname is the person's own choice of what to be called, not a
    // full name to parse.
    assert.equal(
      personGivenName({
        displayName: "Kovács Béla",
        nickname: "Öreg Béla",
      }),
      "Öreg Béla",
    );
  });

  it("falls back to the whole name when there is no second word", () => {
    assert.equal(personGivenName({ displayName: "Béla" }), "Béla");
  });

  it("treats an empty or whitespace nickname as none", () => {
    assert.equal(
      personGivenName({ displayName: "Kovács Béla", nickname: "" }),
      "Béla",
    );
    assert.equal(
      personGivenName({ displayName: "Kovács Béla", nickname: null }),
      "Béla",
    );
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

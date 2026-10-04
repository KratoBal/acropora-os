import assert from "node:assert/strict";
import { it } from "node:test";
import { mailAuthorDisplayName } from "./mail-author.js";
it("takes only From display name, never guesses from an address", () => {
  assert.equal(
    mailAuthorDisplayName('"Szilveszter Roland" <keeper@zoobudapest.com>'),
    "Szilveszter Roland",
  );
  assert.equal(mailAuthorDisplayName("keeper@zoobudapest.com"), null);
  assert.equal(mailAuthorDisplayName("<keeper@zoobudapest.com>"), null);
  assert.equal(
    mailAuthorDisplayName(
      "=?UTF-8?B?U3ppbHZlc3p0ZXIgUm9sYW5k?= <keeper@zoo.hu>",
    ),
    "Szilveszter Roland",
  );
  assert.equal(
    mailAuthorDisplayName("=?UTF-8?Q?Kov=C3=A1cs_Anna?= <keeper@zoo.hu>"),
    "Kovács Anna",
  );
});

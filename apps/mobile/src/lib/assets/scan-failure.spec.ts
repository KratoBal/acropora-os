import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeScanFailure } from "./scan-failure";

class FakeNetworkError extends Error {
  name = "ApiNetworkError";
}

class FakeApiError extends Error {
  name = "ApiError";
  status = 404;
}

describe("describeScanFailure", () => {
  it("blames the network when the request never arrived", () => {
    const failure = describeScanFailure(new FakeNetworkError("nope"));
    assert.equal(failure.title, "Nincs kapcsolat a szerverrel");
    assert.equal(failure.canRetry, true);
  });

  it("says explicitly that the code itself is fine", () => {
    // The whole point of the change: a technician in a basement must not
    // conclude that the sticker is broken and replace a good one.
    const failure = describeScanFailure(new FakeNetworkError("nope"));
    assert.match(failure.message, /A QR-kóddal nincs baj/);
  });

  it("blames the code only when the server answered", () => {
    const failure = describeScanFailure(new FakeApiError("not found"));
    assert.equal(failure.title, "A QR-kód nem azonosítható");
    assert.equal(failure.canRetry, false);
  });

  it("does not offer a retry for something a retry cannot fix", () => {
    assert.equal(describeScanFailure(new FakeApiError("gone")).canRetry, false);
  });

  it("treats anything unrecognised as the server's answer", () => {
    // Erring towards "the code is unknown" keeps the retry button off a
    // screen where it would fail again. The message stays honest either
    // way: it says what the server did, not what the sticker is.
    for (const value of [new Error("plain"), "string", null, undefined, 42]) {
      assert.equal(describeScanFailure(value).canRetry, false);
    }
  });
});

describe("describeScanFailure a helyszíni másolattal", () => {
  /**
   * A HARMADIK ESET, amit a helyszíni másolat hozott: nincs térerő, ÉS a kód a
   * készülékre mentett listán sincs rajta. A sima "nincs kapcsolat" üzenet itt
   * azt sugallná, hogy térerővel minden rendben lenne -- pedig ez az eszköz vagy
   * új, vagy még nem került le erre a telefonra. A különbség az, hogy a szerelő
   * megvárja-e a térerőt, vagy szól az irodának.
   */
  it("says when the saved copy was searched too and did not have it", () => {
    const failure = describeScanFailure(new FakeNetworkError(), {
      searchedOfflineCopy: true,
    });

    assert.match(failure.title, /nincs mentve ez az eszköz/);
    assert.equal(failure.canRetry, true);
  });

  it("keeps the plain wording when the copy was not searched", () => {
    const failure = describeScanFailure(new FakeNetworkError());

    assert.equal(failure.title, "Nincs kapcsolat a szerverrel");
  });
});

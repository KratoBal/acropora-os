import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOWNLOAD_TOKEN_MAX_SECONDS,
  LINK_REQUEST_WINDOW_SECONDS,
  mintDownloadToken,
  signLinkRequest,
  verifyDownloadToken,
  verifyLinkRequest,
} from "./webshop-invoice.token.js";

/**
 * A SZÁMLA-LETÖLTÉS ALÁÍRÁSAI. MI PIROSÍT: ha egy hamis, lejárt vagy más rendelésre szóló kérés átmegy; ha a letöltő token
 * módosított tartalommal vagy rossz titokkal érvényes marad; ha egy hosszabb életű token átmegy; ha a két aláírás felcserélhető
 * (a kérés-aláírás letöltő tokennek, vagy fordítva); ha egy értelmezhetetlen bemenet kivételt dob egy 404 helyett.
 */
const SECRET = "x".repeat(40);
const OTHER = "y".repeat(40);
const NOW = 1_800_000_000;

describe("link request", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    orderId: "order_1",
    ts: NOW,
    sig: signLinkRequest(SECRET, "order_1", NOW),
    ...over,
  });

  it("accepts the signed request inside the window, on both sides of the clock", () => {
    assert.equal(verifyLinkRequest(SECRET, request(), NOW), true);
    assert.equal(
      verifyLinkRequest(SECRET, request(), NOW + LINK_REQUEST_WINDOW_SECONDS),
      true,
    );
    assert.equal(
      verifyLinkRequest(SECRET, request(), NOW - LINK_REQUEST_WINDOW_SECONDS),
      true,
    );
  });

  it("refuses a stale or future one, another secret, another order, a tampered signature", () => {
    assert.equal(
      verifyLinkRequest(
        SECRET,
        request(),
        NOW + LINK_REQUEST_WINDOW_SECONDS + 1,
      ),
      false,
    );
    assert.equal(
      verifyLinkRequest(
        SECRET,
        request(),
        NOW - LINK_REQUEST_WINDOW_SECONDS - 1,
      ),
      false,
    );
    assert.equal(verifyLinkRequest(OTHER, request(), NOW), false);
    assert.equal(
      verifyLinkRequest(SECRET, request({ orderId: "order_2" }), NOW),
      false,
    );
    assert.equal(
      verifyLinkRequest(SECRET, request({ ts: NOW + 1 }), NOW),
      false,
    );
    assert.equal(
      verifyLinkRequest(SECRET, request({ sig: "AAAA" }), NOW),
      false,
    );
  });

  it("refuses every malformed input without throwing", () => {
    for (const bad of [
      request({ orderId: 5 }),
      request({ orderId: "" }),
      request({ orderId: "o".repeat(65) }),
      request({ ts: "1800000000" }),
      request({ ts: 1.5 }),
      request({ sig: null }),
      request({ sig: "s".repeat(200) }),
      { orderId: undefined, ts: undefined, sig: undefined },
    ])
      assert.equal(verifyLinkRequest(SECRET, bad, NOW), false);
  });
});

describe("download token", () => {
  const claims = {
    orderId: "order_1",
    invoiceId: "inv_1",
    jti: "j-1",
    exp: NOW + 600,
  };

  it("round-trips the claims", () => {
    const token = mintDownloadToken(SECRET, claims);
    assert.deepEqual(verifyDownloadToken(SECRET, token, NOW), claims);
  });

  it("refuses another secret, an expired token and one that lives longer than the ceiling", () => {
    const token = mintDownloadToken(SECRET, claims);
    assert.equal(verifyDownloadToken(OTHER, token, NOW), null);
    assert.equal(verifyDownloadToken(SECRET, token, NOW + 600), null);
    assert.equal(verifyDownloadToken(SECRET, token, NOW + 601), null);
    const tooLong = mintDownloadToken(SECRET, {
      ...claims,
      exp: NOW + DOWNLOAD_TOKEN_MAX_SECONDS + 1,
    });
    assert.equal(verifyDownloadToken(SECRET, tooLong, NOW), null);
    const atCeiling = mintDownloadToken(SECRET, {
      ...claims,
      exp: NOW + DOWNLOAD_TOKEN_MAX_SECONDS,
    });
    assert.notEqual(verifyDownloadToken(SECRET, atCeiling, NOW), null);
  });

  it("refuses a tampered payload (another invoice) or signature", () => {
    const token = mintDownloadToken(SECRET, claims);
    const [payload, signature] = token.split(".") as [string, string];
    const other = mintDownloadToken(SECRET, { ...claims, invoiceId: "inv_2" });
    assert.equal(
      verifyDownloadToken(SECRET, `${other.split(".")[0]}.${signature}`, NOW),
      null,
    );
    assert.equal(verifyDownloadToken(SECRET, `${payload}.AAAA`, NOW), null);
  });

  it("refuses garbage without throwing", () => {
    for (const bad of [
      undefined,
      null,
      5,
      "",
      "a",
      "a.b.c",
      ".",
      "x".repeat(2000),
      "not-base64.also-not",
    ])
      assert.equal(verifyDownloadToken(SECRET, bad, NOW), null);
  });

  it("the two signatures are not interchangeable (domain separation)", () => {
    // a link-request signature used as the signature of a payload
    const payload = Buffer.from(
      JSON.stringify({ v: 1, o: "order_1", i: "inv_1", j: "j", e: NOW + 60 }),
    ).toString("base64url");
    const asLink = signLinkRequest(SECRET, payload, NOW);
    assert.equal(
      verifyDownloadToken(SECRET, `${payload}.${asLink}`, NOW),
      null,
    );
    // a download token's signature used as a link-request signature
    const token = mintDownloadToken(SECRET, claims);
    const signature = token.split(".")[1]!;
    assert.equal(
      verifyLinkRequest(
        SECRET,
        { orderId: "order_1", ts: NOW, sig: signature },
        NOW,
      ),
      false,
    );
  });
});

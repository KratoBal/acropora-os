import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trackingUrlFor } from "./tracking-url.js";

/*
  THE TRACKING ADDRESS IS CONFIGURED, NEVER GUESSED (acrobot 26620). WHAT
  TURNS RED: a link appears without configuration; a non-https or
  placeholder-less template becomes a link; the parcel number is not encoded.
*/
describe("trackingUrlFor", () => {
  it("no configuration, no link", () => {
    assert.equal(trackingUrlFor("gls", "5000000001", {}), null);
    assert.equal(
      trackingUrlFor("foxpost", null, {
        FOXPOST_TRACKING_URL: "https://x/{parcelNumber}",
      }),
      null,
    );
  });

  it("only an https template with the placeholder becomes a link, the number encoded", () => {
    assert.equal(
      trackingUrlFor("foxpost", "CL FOX/1", {
        FOXPOST_TRACKING_URL: "https://track.example/?code={parcelNumber}",
      }),
      "https://track.example/?code=CL%20FOX%2F1",
    );
    assert.equal(
      trackingUrlFor("gls", "1", {
        GLS_TRACKING_URL: "http://track.example/{parcelNumber}",
      }),
      null,
    );
    assert.equal(
      trackingUrlFor("gls", "1", {
        GLS_TRACKING_URL: "https://track.example/",
      }),
      null,
    );
    // the other carrier's setting does not leak across
    assert.equal(
      trackingUrlFor("gls", "1", {
        FOXPOST_TRACKING_URL: "https://track.example/{parcelNumber}",
      }),
      null,
    );
  });
});

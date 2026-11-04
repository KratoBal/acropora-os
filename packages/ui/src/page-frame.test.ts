import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PAGE_GUTTER_MX,
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  PILOT_SHELL_BLEED,
  bleedMirror,
} from "./page-frame.js";

// What must fail: a bleed that cancels a different margin than the frame gives (the page is wider than the phone, or a
// strip of frame padding shows); an outer-margin twin that drifts from the padding; a mirror that keeps the prefix
// wrong or accepts a non-padding class.
describe("the page frame", () => {
  it("the bleed is the exact negative mirror of the frame's padding, on every breakpoint", () => {
    const padding = [...PAGE_GUTTER_X.split(" "), ...PAGE_GUTTER_Y.split(" ")];
    assert.deepEqual(
      PILOT_SHELL_BLEED.split(" ").sort(),
      padding.map(bleedMirror).sort(),
    );
  });

  it("the outer-margin gutter has the same steps as the padding gutter", () => {
    assert.equal(PAGE_GUTTER_MX, PAGE_GUTTER_X.replace(/px-/g, "mx-"));
  });

  it("starts from 16 px on the phone", () => {
    assert.equal(PAGE_GUTTER_X.split(" ")[0], "px-4");
  });

  it("mirrors one padding class", () => {
    assert.equal(bleedMirror("px-4"), "-mx-4");
    assert.equal(bleedMirror("sm:px-6"), "sm:-mx-6");
    assert.equal(bleedMirror("lg:py-8"), "lg:-my-8");
    assert.throws(() => bleedMirror("mx-4"));
    assert.throws(() => bleedMirror("text-sm"));
  });
});

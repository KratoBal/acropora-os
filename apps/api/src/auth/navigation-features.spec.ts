import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { navigationFeatures, quotesMenuOn } from "./navigation-features.js";

describe("the quotes menu switch (#1582 P1, decision 3)", () => {
  it("is off by default and for any unknown value", () => {
    for (const value of [undefined, "", "off", "true", "1", "yes"])
      assert.equal(
        quotesMenuOn({ QUOTES_ENABLED: value }, "u1"),
        false,
        String(value),
      );
  });

  it("pilot: only the listed users; an empty list means nobody", () => {
    assert.equal(
      quotesMenuOn(
        { QUOTES_ENABLED: "pilot", QUOTES_PILOT_USER_IDS: "u2, u1" },
        "u1",
      ),
      true,
    );
    assert.equal(
      quotesMenuOn(
        { QUOTES_ENABLED: "pilot", QUOTES_PILOT_USER_IDS: "u2" },
        "u1",
      ),
      false,
    );
    assert.equal(quotesMenuOn({ QUOTES_ENABLED: "pilot" }, "u1"), false);
  });

  it("on: everyone (the permission still decides the entry)", () => {
    assert.equal(quotesMenuOn({ QUOTES_ENABLED: " ON " }, "anyone"), true);
  });

  it("reaches the served feature set", () => {
    assert.ok(navigationFeatures({ QUOTES_ENABLED: "on" }, "u1").has("quotes"));
    assert.ok(!navigationFeatures({}, "u1").has("quotes"));
  });
});

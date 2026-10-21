import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  navigationFeatures,
  quotesMenuOn,
  reefClubLinkingOn,
} from "./navigation-features.js";

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

describe("the production switches before the 40524dac release (acrobot 34365)", () => {
  // MI PIROSÍT: ha a ReefClub-kód kiadása a cím VAGY a kapcsoló nélkül is élne; ha a kezdőlap-
  // szerkesztő a `true`-n kívül bármire bekapcsolna; ha a kapcsolók nem jutnának el a menübe.
  it("reefclub-linking needs the ReefClub address AND the explicit switch", () => {
    const url = "https://reefclub-staging.acropora.hu";
    assert.deepEqual(
      [
        reefClubLinkingOn({}),
        reefClubLinkingOn({ REEFCLUB_LINKING_ENABLED: "true" }),
        reefClubLinkingOn({ REEFCLUB_WEB_URL: url }),
        reefClubLinkingOn({
          REEFCLUB_WEB_URL: "  ",
          REEFCLUB_LINKING_ENABLED: "true",
        }),
        reefClubLinkingOn({
          REEFCLUB_WEB_URL: url,
          REEFCLUB_LINKING_ENABLED: "1",
        }),
        reefClubLinkingOn({
          REEFCLUB_WEB_URL: url,
          REEFCLUB_LINKING_ENABLED: "true",
        }),
      ],
      [false, false, false, false, false, true],
    );
  });

  it("the menu carries both only when they are on; production (no variable) has neither", () => {
    const off = navigationFeatures({}, "u1");
    assert.equal(off.has("homepage-content"), false);
    assert.equal(off.has("reefclub-linking"), false);
    const on = navigationFeatures(
      {
        MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true",
        REEFCLUB_WEB_URL: "https://reefclub-staging.acropora.hu",
        REEFCLUB_LINKING_ENABLED: "true",
      },
      "u1",
    );
    assert.equal(on.has("homepage-content"), true);
    assert.equal(on.has("reefclub-linking"), true);
    assert.equal(
      navigationFeatures(
        { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" },
        "u1",
      ).has("homepage-content"),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contentDaypart, contentTrackingUrl } from "./content-results.js";

/*
  THE TRACKING LINK AND THE DAYPART (T5.5 S8). What turns this red: a link without the item's id; an old campaign's
  utm values kept (it would be credited); the link's own parameters dropped; a non-web address "tracked"; a daypart
  boundary moved.
*/
describe("contentTrackingUrl", () => {
  it("adds the channel's source and the item's id, keeps the link's own parameters, replaces old utm values", () => {
    const url = contentTrackingUrl(
      "https://acropora.hu/termek/energy?szin=kek&utm_source=regi&utm_content=x",
      { id: "c42", channel: "FACEBOOK_POST" },
    );
    const parsed = new URL(url!);
    assert.equal(parsed.searchParams.get("szin"), "kek");
    assert.equal(parsed.searchParams.get("utm_source"), "facebook");
    assert.equal(parsed.searchParams.get("utm_medium"), "social");
    assert.equal(parsed.searchParams.get("utm_campaign"), "acropora-tartalom");
    assert.equal(parsed.searchParams.get("utm_content"), "c42");
    assert.equal(parsed.searchParams.getAll("utm_source").length, 1);
  });

  it("a newsletter is email", () => {
    const parsed = new URL(
      contentTrackingUrl("https://acropora.hu/", {
        id: "n1",
        channel: "NEWSLETTER",
      })!,
    );
    assert.equal(parsed.searchParams.get("utm_source"), "newsletter");
    assert.equal(parsed.searchParams.get("utm_medium"), "email");
  });

  it("a non-web or broken address is not tracked", () => {
    for (const url of [
      "mailto:info@acropora.hu",
      "/termek/x",
      "nem link",
      "javascript:alert(1)",
    ])
      assert.equal(
        contentTrackingUrl(url, { id: "c1", channel: "OTHER" }),
        null,
        url,
      );
  });
});

describe("contentDaypart", () => {
  it("names the Budapest hour's daypart, the boundaries included", () => {
    assert.deepEqual(
      [4, 5, 8, 9, 11, 12, 16, 17, 21, 22, 0].map(contentDaypart),
      [
        "éjszaka",
        "reggel",
        "reggel",
        "délelőtt",
        "délelőtt",
        "délután",
        "délután",
        "este",
        "este",
        "éjszaka",
        "éjszaka",
      ],
    );
  });
});

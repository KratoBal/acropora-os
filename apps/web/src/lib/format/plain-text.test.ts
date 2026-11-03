import { describe, expect, it } from "vitest";

import { plainText } from "./plain-text";

// What must fail: a raw entity or tag reaching the screen ("&nbsp;", "&lt;i&gt;", "<i>"); a
// legitimate "<" in a sentence being eaten as a tag; an unknown entity being mangled; a missing
// value printing "null".
describe("plainText", () => {
  it("replaces the entities with their characters", () => {
    expect(plainText("Dunaharaszti&nbsp;&amp;Co")).toBe("Dunaharaszti &Co");
    expect(plainText("a &quot;b&quot; &#39;c&#39; &#x41;")).toBe(`a "b" 'c' A`);
  });

  it("removes escaped and plain italic tags, keeping the words", () => {
    expect(plainText("&lt;i&gt;Acropora pulchra&lt;/i&gt; reef")).toBe(
      "Acropora pulchra reef",
    );
    expect(plainText("<i>Acropora</i> <b>millepora</b>")).toBe(
      "Acropora millepora",
    );
  });

  it("keeps a comparison sign that is not a tag", () => {
    expect(plainText("pH < 8 és > 7")).toBe("pH < 8 és > 7");
  });

  it("leaves an unknown entity as it is", () => {
    expect(plainText("a &valami; b")).toBe("a &valami; b");
  });

  it("collapses whitespace, and gives an empty text for a missing value", () => {
    expect(plainText("  a \n b  ")).toBe("a b");
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
    expect(plainText("")).toBe("");
  });
});

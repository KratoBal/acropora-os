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

  // A tag pattern wants a LETTER right after "<": a text like "a<b ... >" counts as a tag, and what
  // is between disappears. Rare in publication titles; this pins what happens to it.
  it("treats a letter right after the less-than sign as a tag (known limit)", () => {
    expect(plainText("a<b és c>d")).toBe("ad");
    expect(plainText("a < b és c > d")).toBe("a < b és c > d");
  });

  it("drops control and direction-changing characters written as numeric entities", () => {
    expect(plainText("a&#8238;b")).toBe("ab");
    expect(plainText("a&#x2066;b&#x2069;c")).toBe("abc");
    expect(plainText("a&#7;b")).toBe("ab");
    expect(plainText("a&#x85;b")).toBe("ab");
    // an ordinary letter, written numerically, still decodes
    expect(plainText("&#233;")).toBe("é");
  });

  it("puts a space where a line break or a block tag separated two pieces", () => {
    expect(plainText("sor1<br>sor2")).toBe("sor1 sor2");
    expect(plainText("<p>egy</p><p>kettő</p>")).toBe("egy kettő");
    expect(plainText("<i>Acropora</i>millepora")).toBe("Acroporamillepora");
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

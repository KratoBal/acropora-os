import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RICH_TEXT_ALLOWED_TAGS } from "./schema.js";
import { sanitizeRichHtml } from "./sanitize.js";

describe("a tisztito: ami kiesik", () => {
  it("a script es a style TARTALMAVAL egyutt eltunik", () => {
    assert.equal(
      sanitizeRichHtml("<p>a<script>alert(1)</script><style>p{}</style>b</p>"),
      "<p>ab</p>",
    );
  });

  it("az esemeny-attributum es a style/class kiesik", () => {
    assert.equal(
      sanitizeRichHtml('<p onclick="x()" style="color:red" class="c">a</p>'),
      "<p>a</p>",
    );
  });

  it("az ismeretlen tag eltunik, a szovege marad", () => {
    assert.equal(
      sanitizeRichHtml('<div><img src="https://x/y.png">szoveg</div>'),
      "szoveg",
    );
  });

  it("a javascript: link cime kiesik, a felirata marad", () => {
    assert.equal(
      sanitizeRichHtml('<a href="javascript:alert(1)">ide</a>'),
      "<a>ide</a>",
    );
  });

  /**
   * A BONGESZO A VEZERLOKARAKTERT ATUGORJA A SEMABAN. Ha a tisztito a nyers
   * szovegen kerdezne, a `java\tscript:` atmenne mint "nem javascript".
   */
  it("a vezerlokarakterrel elrejtett javascript: is kiesik", () => {
    for (const cim of ["java\tscript:x", " javascript:x", "JAVASCRIPT:x"])
      assert.equal(sanitizeRichHtml(`<a href="${cim}">i</a>`), "<a>i</a>", cim);
  });

  it("a data: es a relativ cim is kiesik", () => {
    assert.equal(
      sanitizeRichHtml('<a href="data:text/html,x">a</a><a href="/x">b</a>'),
      "<a>a</a><a>b</a>",
    );
  });

  it("a nem engedett helyorzo href-kent kiesik", () => {
    assert.equal(
      sanitizeRichHtml('<a href="{{jegyszam}}">a</a>', {
        hrefPlaceholders: ["jegy_linkje"],
      }),
      "<a>a</a>",
    );
  });

  /**
   * CSAK A PONTOS ALAK MEGY AT. Egy osszetett cel (`{{link}}/../x`) vegeredmenye
   * menteskor nem ellenorizheto.
   */
  it("a helyorzobol es utvonalbol osszerakott href kiesik", () => {
    assert.equal(
      sanitizeRichHtml('<a href="{{jegy_linkje}}/x">a</a>', {
        hrefPlaceholders: ["jegy_linkje"],
      }),
      "<a>a</a>",
    );
  });

  it("a hibas valtozo-jeloles kiesik, a szoveg marad", () => {
    assert.equal(
      sanitizeRichHtml('<span data-variable="a b&quot;">{{a}}</span>'),
      "<span>{{a}}</span>",
    );
  });
});

describe("a tisztito: ami megmarad", () => {
  it("a whitelist minden tagje atmegy", () => {
    for (const tag of Object.keys(RICH_TEXT_ALLOWED_TAGS)) {
      const html =
        tag === "br" || tag === "hr" ? `<${tag}>` : `<${tag}>x</${tag}>`;
      assert.equal(sanitizeRichHtml(html), html, tag);
    }
  });

  it("a http, https es mailto link megmarad", () => {
    const html =
      '<a href="https://os.acropora.hu/x?a=1&amp;b=2">a</a><a href="http://x">b</a><a href="mailto:a@b.hu">c</a>';
    assert.equal(sanitizeRichHtml(html), html);
  });

  /**
   * AZ ALAPBEALLITASU js-xss EZT `<a href>`-re csereli (mert, xss@1.0.15).
   * Ha ez az allitas pirosra valt, a link-valtozo menteskor csendben eltunne.
   */
  it("az engedett link-helyorzo href-kent megmarad", () => {
    const html = '<a href="{{jegy_linkje}}">A hibajegy</a>';
    assert.equal(
      sanitizeRichHtml(html, { hrefPlaceholders: ["jegy_linkje"] }),
      html,
    );
  });

  it("a valtozo-csomopont jelolese megmarad", () => {
    const html = '<p><span data-variable="jegyszam">{{jegyszam}}</span></p>';
    assert.equal(sanitizeRichHtml(html), html);
  });

  it("a szovegben allo escape-elt jel escape-elt marad", () => {
    const html = "<p>&lt;b&gt; &amp; {{x}}</p>";
    assert.equal(sanitizeRichHtml(html), html);
  });

  it("idempotens: a tiszta kimenet masodszor nem valtozik", () => {
    const nyers =
      '<p onclick="x">a <strong>b</strong><a href="https://x">c</a><script>d</script></p><ul><li><p>e</p></li></ul>';
    const egyszer = sanitizeRichHtml(nyers);
    assert.equal(sanitizeRichHtml(egyszer), egyszer);
  });
});

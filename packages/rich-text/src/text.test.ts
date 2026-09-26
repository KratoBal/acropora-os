import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeHtml, plainTextToRichHtml } from "./from-text.js";
import { richHtmlToText } from "./to-text.js";

describe("HTML -> szoveg", () => {
  it("a bekezdesek kozott ures sor, a <br> sortores", () => {
    assert.equal(
      richHtmlToText("<p>Kedves Anna!</p><p>Elso sor<br>Masodik sor</p>"),
      "Kedves Anna!\n\nElso sor\nMasodik sor",
    );
  });

  it("a formazas nyoma eltunik, a szoveg marad", () => {
    assert.equal(
      richHtmlToText(
        "<p><strong>fontos</strong> <em>es</em> <u>jelolt</u></p>",
      ),
      "fontos es jelolt",
    );
  });

  it("az entitasok feloldodnak", () => {
    assert.equal(
      richHtmlToText(
        "<p>&lt;b&gt; &amp; &quot;x&quot; &#39;y&#39; &#x151;</p>",
      ),
      "<b> & \"x\" 'y' ő",
    );
  });

  it("a link cime a felirat utan zarojelben all", () => {
    assert.equal(
      richHtmlToText('<p>Itt: <a href="https://x.hu/a">a hibajegy</a>.</p>'),
      "Itt: a hibajegy (https://x.hu/a).",
    );
  });

  it("ha a felirat maga a cim, nem ismetlodik", () => {
    assert.equal(
      richHtmlToText('<p><a href="https://x.hu">https://x.hu</a></p>'),
      "https://x.hu",
    );
  });

  it("a kiesett cimu link csak felirat", () => {
    assert.equal(
      richHtmlToText('<p><a href="javascript:x">ide</a></p>'),
      "ide",
    );
  });

  it("a link-helyorzo a szoveges valtozatban is megmarad, ha engedett", () => {
    assert.equal(
      richHtmlToText('<p><a href="{{jegy_linkje}}">A hibajegy</a></p>', {
        hrefPlaceholders: ["jegy_linkje"],
      }),
      "A hibajegy ({{jegy_linkje}})",
    );
  });

  /**
   * A TipTap a listaelem szoveget `<p>`-be teszi. Ha a `<p>` itt lezarna, a
   * jel es a szoveg ket bekezdesbe esne: "-" es "tej".
   */
  it("a TipTap alaku lista egy blokk, jellel", () => {
    assert.equal(
      richHtmlToText(
        "<p>Lista:</p><ul><li><p>tej</p></li><li><p>kenyer</p></li></ul><p>Vege</p>",
      ),
      "Lista:\n\n- tej\n- kenyer\n\nVege",
    );
  });

  it("a szamozott es a beagyazott lista", () => {
    assert.equal(
      richHtmlToText(
        "<ol><li><p>egy</p><ul><li><p>al</p></li></ul></li><li><p>ketto</p></li></ol>",
      ),
      "1. egy\n  - al\n2. ketto",
    );
  });

  it("a script tartalma nem kerul a szovegbe", () => {
    assert.equal(richHtmlToText("<p>a<script>x()</script>b</p>"), "ab");
  });

  it("a HTML-beli sortores es tobb szokoz egy szokoz", () => {
    assert.equal(richHtmlToText("<p>a\n   b</p>"), "a b");
  });

  it("a valtozo-csomopont szovege a helyorzo", () => {
    assert.equal(
      richHtmlToText(
        '<p>Jegy: <span data-variable="jegyszam">{{jegyszam}}</span></p>',
      ),
      "Jegy: {{jegyszam}}",
    );
  });
});

describe("szoveg -> HTML", () => {
  it("bekezdes, sortores, escape", () => {
    assert.equal(
      plainTextToRichHtml("Kedves <Anna> & tsa!\n\nElso\nMasodik"),
      "<p>Kedves &lt;Anna&gt; &amp; tsa!</p><p>Elso<br>Masodik</p>",
    );
  });

  it("csak az ismert nev lesz valtozo-csomopont", () => {
    assert.equal(
      plainTextToRichHtml("{{jegyszam}} es {{elgepelt}}", {
        variables: ["jegyszam"],
      }),
      '<p><span data-variable="jegyszam">{{jegyszam}}</span> es {{elgepelt}}</p>',
    );
  });

  it("a CRLF sortores is sortores", () => {
    assert.equal(
      plainTextToRichHtml("a\r\nb\r\n\r\nc"),
      "<p>a<br>b</p><p>c</p>",
    );
  });

  it("az escapeHtml mind az ot jelet cserel", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("oda-vissza ut", () => {
  /**
   * A MEGLEVO SABLONOK ATVITELE ERRE ALL: ha az ut nem adja vissza a szoveget,
   * az atallas csendben atirna a leveleket. A hat alapertelmezett sablonnal
   * az API oldalan kulon allitas is all (a sablonok ott laknak).
   */
  const MINTAK = [
    "Kedves {{cimzett}}!\n\nA(z) {{jegyszam}} számú hibajegyhez tartozó munkalapot aláírták.\n\nHibajegy: {{jegy_linkje}}",
    "Jegyszám: {{jegyszam}}\nTárgy: {{jegy_targya}}\nBejelentő: {{bejelento}}",
    "Kért tételek:\n{{tetelek}}",
    "Vízmérés -- <5 dKH> & \"idézet\" 'aposztróf'",
    "- ez nem lista, hanem szoveg\n- masodik sor",
  ];
  for (const minta of MINTAK)
    it(JSON.stringify(minta.slice(0, 40)), () => {
      const vissza = richHtmlToText(
        plainTextToRichHtml(minta, {
          variables: ["cimzett", "jegyszam", "jegy_linkje", "tetelek"],
        }),
      );
      assert.equal(vissza, minta);
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_CTA_STYLE, richHtmlForEmail } from "./email.js";
import { sanitizeRichHtml, sanitizeRichHtmlReport } from "./sanitize.js";
import { richHtmlToText } from "./to-text.js";

const CTA =
  '<p data-cta="" data-align="center"><a href="https://os.acropora.hu/szamla/1">Számla megnyitása</a></p>';

describe("az igazitas es a gomb jelolese a tisztitoban", () => {
  it("a kozepre es a jobbra igazitast megtartja a p, h2, h3 elemen", () => {
    const html =
      '<p data-align="center">a</p><h2 data-align="right">b</h2><h3 data-align="center">c</h3>';
    assert.deepEqual(sanitizeRichHtmlReport(html), { html, removed: [] });
  });

  it("a bal igazitas jelolese veszteseg nelkul eltunik, a tobbi ervenytelen ertek jelentve", () => {
    assert.deepEqual(
      sanitizeRichHtmlReport(
        '<p data-align="left">a</p><p data-align="justify">b</p><li data-align="center">c</li>',
      ),
      {
        html: "<p>a</p><p>b</p><li>c</li>",
        removed: ["p data-align", "li data-align"],
      },
    );
  });

  it("a gomb jelolese a bekezdesen egy alakra egyszerusodik, a linken kiesik", () => {
    assert.deepEqual(
      sanitizeRichHtmlReport(
        '<p data-cta="igen"><a href="https://x.hu" data-cta="">x</a></p>',
      ),
      {
        html: '<p data-cta=""><a href="https://x.hu">x</a></p>',
        removed: ["a data-cta"],
      },
    );
  });

  it("megnevezi, amit a semaba nem ferot eldobott, es a tiszta HTML-nel ures a lista", () => {
    const { html, removed } = sanitizeRichHtmlReport(
      '<table><tr><td>x</td></tr></table><p style="color:red">y</p><script>z</script>',
    );
    assert.equal(html, "x<p>y</p>");
    assert.deepEqual([...removed].sort(), [
      "p style",
      "script",
      "table",
      "td",
      "tr",
    ]);
    assert.deepEqual(sanitizeRichHtmlReport(CTA).removed, []);
  });

  it("a sajat kimeneten nem valtoztat (a MIME-epito erre ellenoriz)", () => {
    const egyszer = sanitizeRichHtml(
      `${CTA}<h2 data-align="RIGHT">x</h2><p data-cta>y</p>`,
    );
    assert.equal(sanitizeRichHtml(egyszer), egyszer);
  });
});

describe("richHtmlForEmail", () => {
  it("a gombot inline stilusu linkke, az igazitast text-align stilussa forditja, jeloles nelkul", () => {
    assert.equal(
      richHtmlForEmail(`${CTA}<h2 data-align="right">Cim</h2>`),
      `<p style="text-align:center"><a href="https://os.acropora.hu/szamla/1" style="${EMAIL_CTA_STYLE}">Számla megnyitása</a></p>` +
        '<h2 style="text-align:right">Cim</h2>',
    );
  });

  it("ket linkes vagy formazott feliratu gomb sima bekezdes marad, a tartalma megvan", () => {
    assert.equal(
      richHtmlForEmail(
        '<p data-cta=""><a href="https://a.hu">a</a> <a href="https://b.hu">b</a></p><p data-cta=""><a href="https://c.hu"><strong>c</strong></a></p>',
      ),
      '<p><a href="https://a.hu">a</a> <a href="https://b.hu">b</a></p><p><a href="https://c.hu"><strong>c</strong></a></p>',
    );
  });

  it("jeloles nelkuli HTML-hez nem nyul", () => {
    const html = '<p>a <a href="https://x.hu">x</a></p><h2>b</h2>';
    assert.equal(richHtmlForEmail(html), html);
  });
});

describe("a gomb a szoveges levelben", () => {
  it("Felirat: cim alakban all, a sima link marad zarojeles", () => {
    assert.equal(
      richHtmlToText(
        `<p>Kedves Anna!</p>${CTA}<p>Lasd <a href="https://x.hu">itt</a>.</p>`,
      ),
      "Kedves Anna!\n\nSzámla megnyitása: https://os.acropora.hu/szamla/1\n\nLasd itt (https://x.hu).",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  renderWebContentHtml,
  splitStorefrontTabs,
  type PreviewProductCard,
} from "./web-content-preview";

/**
 * AZ ELONEZET A TISZTITOTT KIMENETET ALAKITJA, NEM A NYERSET. A termekkartya
 * adata a szerverrol jon (nev, ar, kep), es minden mezo escape-elve kerul a
 * HTML-be; a feloldatlan kartya a tarolt tartalek-nevet mutatja.
 */
describe("renderWebContentHtml", () => {
  const kartyak = new Map<string, PreviewProductCard>([
    [
      "clx0abc123",
      {
        id: "clx0abc123",
        name: '<img src=x onerror="alert(1)">Kaja',
        priceLabel: "1 990 Ft",
        imageUrl: "javascript:alert(1)",
      },
    ],
  ]);

  it("a feloldott kártya adata escape-elve, a nem https kép nélkül kerül be", () => {
    const html = renderWebContentHtml(
      '<div data-product-card="clx0abc123">Kaja</div>',
      kartyak,
    );
    expect(html).toBe(
      '<div data-preview-card="clx0abc123"><div><strong>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;Kaja</strong><span>1 990 Ft</span></div></div>',
    );
  });

  it("a feloldatlan kártya a tárolt nevet mutatja", () => {
    expect(
      renderWebContentHtml(
        '<div data-product-card="clx0zzz999">Tartalék &amp; név</div>',
        kartyak,
      ),
    ).toContain("<strong>Tartalék &amp; név</strong>");
  });

  it("előbb a szerver tisztítója fut: szkript és on* nem jut az előnézetbe", () => {
    const html = renderWebContentHtml(
      '<p onclick="x()">a<script>alert(1)</script><a href="https://x.hu">l</a></p><iframe srcdoc="x"></iframe>',
      kartyak,
    );
    expect(html).toBe(
      '<p>a<a target="_blank" rel="noopener noreferrer" href="https://x.hu">l</a></p>',
    );
  });

  it("a táblázatok külön fülre kerülnek, mint a kirakatban", () => {
    expect(
      splitStorefrontTabs(
        "<p>a</p><table><tbody><tr><td>1</td></tr></tbody></table><p>b</p>",
      ),
    ).toEqual({
      tables: "<table><tbody><tr><td>1</td></tr></tbody></table>",
      prose: "<p>a</p><p>b</p>",
    });
  });
});

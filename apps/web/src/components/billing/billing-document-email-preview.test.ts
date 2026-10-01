import { EMAIL_CTA_STYLE } from "@acropora/rich-text";
import { describe, expect, it } from "vitest";

import { previewBillingEmail } from "./billing-document-email-drawer";

/**
 * A SZÁMLALEVÉL ELŐNÉZETE a küldés kerete szerint (`richHtmlForEmail`, a
 * MIME-építő lépése): a gomb és az igazítás inline stílussal. PIROSÍT: ha az
 * előnézet a nyers jelölést mutatná, és a gomb sima linknek látszana.
 */
describe("previewBillingEmail", () => {
  it("a gomb a behelyettesített címmel, a küldés stílusával áll", () => {
    const html = previewBillingEmail(
      '<p data-cta="" data-align="center"><a href="{{document_link}}">Számla megnyitása</a></p>',
      { document_link: "https://os.acropora.hu/szamla/1" },
    );
    expect(html).toBe(
      `<p style="text-align:center"><a href="https://os.acropora.hu/szamla/1" style="${EMAIL_CTA_STYLE}">Számla megnyitása</a></p>`,
    );
  });
});

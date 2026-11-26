import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A VISSZALÉPÉS EGY ALAKJA (Picasso képernyő-leltár R12, acrobot 62415): bal felül, a cím fölött egy kis „‹" nyíl-link (`PilotBackLink`). A
  leltár négy alakot talált (nyíl, morzsa, jobb felső „Vissza a listához" gomb, semmi). MI PIROSÍT: ha egy lap a nyíl-link osztályait kézzel
  írja (a közös komponens helyett); ha az átállított lapok egyike megint „Vissza a listához" gombot kap; ha a még át nem állított lapok listája
  nem egyezik a valósággal (egy átállított lap kimarad a listából, vagy egy új gomb-alakú visszalépés jön be): a lista csak CSÖKKENHET, és
  nem avulhat el. A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

function fajlok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return fajlok(ut);
    return /\.tsx$/.test(nev) && !/\.test\./.test(nev) ? [ut] : [];
  });
}

function kod(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const MIND = fajlok(ROOT).map((ut) => ({
  ut: relative(ROOT, ut).replaceAll("\\", "/"),
  forras: kod(readFileSync(ut, "utf8")),
}));

/**
 * A MÉG ÁT NEM ÁLLÍTOTT LAPOK: ma „Vissza a ...", „Vissza" vagy „← ..." szöveggel lépnek vissza (a közös komponenst nem használják). Csak
 * csökkenhet. (A leltár első mérése csak a „Vissza a listához" felirattal számolt: 14 oldal; a szélesebb keresés, a „Vissza a ..." és a „← " is,
 * 33 oldalt talált: ez a pontos lista.)
 */
const MEG_ATALLITANDO = [
  "components/billing/billing-document-editor.tsx",
  "components/contracts/pilot/pilot-contract-detail-page.tsx",
  "components/knowledge-base/claim-store-page.tsx",
  "components/messages/messages-page.tsx",
  "components/partner-orders/partner-order-detail-page.tsx",
  "components/quotes/quote-pdf-page.tsx",
  "components/service-assets/asset-editor-page.tsx",
  "components/suppliers/pilot/pilot-supplier-editor-page.tsx",
  "components/worksheets/worksheet-entry-page.tsx",
];

/** MÁS JELENTÉSŰ „Vissza ..." SZÖVEGEK (nem oldal-visszalépés), indokkal: ezeken a guard nem kér komponenst. */
const MAS_JELENTESU = new Map<string, string>([
  [
    "components/billing/billing-document-email-drawer.tsx",
    "a levél-fiók lépése (Levél előnézete / Vissza a szerkesztéshez), nem oldal",
  ],
  [
    "components/users/user-permission-table.tsx",
    "a jogosultság-sablon visszaállítása, nem oldal",
  ],
  [
    "components/homepage-content/homepage-footer-editor.tsx",
    "a kirakat saját láblécére visszaállítás, nem oldal",
  ],
  [
    "components/service-assets/pilot/pilot-asset-detail-page.tsx",
    "az eszköz adatlap saját nyila a léptetővel egy sorban áll (a közös osztályok nélkül, saját elrendezés)",
  ],
]);

const VISSZA = /Vissza a |"Vissza"|← /;

describe("a visszalépés egy alakja", () => {
  it("POZITÍV KONTROLL: a kiolvasás nem üres halmazt ad, és a komponens létezik", () => {
    expect(MIND.length).toBeGreaterThan(300);
    expect(
      MIND.some((f) => f.ut === "components/pilot/pilot-back-link.tsx"),
    ).toBe(true);
  });

  it("a nyíl-link osztályait csak a közös komponens írja", () => {
    const kezi = MIND.filter(
      (f) =>
        f.ut !== "components/pilot/pilot-back-link.tsx" &&
        f.forras.includes(
          "mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700",
        ),
    ).map((f) => f.ut);
    expect(kezi).toEqual([]);
  });

  it("a még át nem állított lapok listája pontosan a Vissza vagy ← szövegű, a közös komponenst nem használó lapok", () => {
    const valos = MIND.filter(
      (f) => VISSZA.test(f.forras) && !f.forras.includes("PilotBackLink"),
    )
      .map((f) => f.ut)
      .sort();
    expect(valos).toEqual([...MEG_ATALLITANDO, ...MAS_JELENTESU.keys()].sort());
  });

  it("az átállított lapok a közös komponenst használják, és nincs bennük Vissza a listához", () => {
    for (const ut of [
      "components/brands/brand-editor-page.tsx",
      "components/users/user-editor-page.tsx",
      "components/seo-landing/seo-landing-editor-page.tsx",
      "components/service-jobs/pilot/pilot-service-job-editor-page.tsx",
      "components/service-jobs/service-job-editor-page.tsx",
      "components/service-jobs/pilot/pilot-service-job-detail-page.tsx",
      "components/worksheets/pilot/pilot-worksheet-detail-page.tsx",
      "components/mortality/mortality-detail-page.tsx",
      "components/billing/billing-document-detail-page.tsx",
      "components/billing/billing-external-document-page.tsx",
      "components/billing/billing-incoming-document-page.tsx",
      "components/billing/billing-incoming-review-page.tsx",
      "components/customers/customer-detail-page.tsx",
      "components/customers/customer-editor-page.tsx",
      "components/inventory/inventory-count-detail-page.tsx",
      "components/products/product-detail-page.tsx",
      "components/purchasing/purchase-invoice-detail-page.tsx",
      "components/purchasing/nav-incoming-invoice-detail-page.tsx",
      "components/purchasing/price-list-suggestions-page.tsx",
      "components/webshop/webshop-order-detail-page.tsx",
      "components/webshop-orders/webshop-order-detail-page.tsx",
      "components/finance/foxpost-settlements-page.tsx",
      "components/finance/gls-settlements-page.tsx",
      "components/finance/simplepay-settlements-page.tsx",
      "components/finance/stripe-settlements-page.tsx",
      "components/finance/missing-invoices/missing-invoices-month-page.tsx",
      "components/finance/missing-invoices/missing-invoices-suggestions-page.tsx",
      "components/pos/pilot/pilot-pos-internal-use-page.tsx",
      "components/pos/pilot/pilot-pos-sale-detail-page.tsx",
      "components/pos/pilot/pilot-pos-summary-page.tsx",
      "components/pos/pos-sale-detail-page.tsx",
      "components/content/article-editor-page.tsx",
      "components/content/content-calendar-page.tsx",
      "components/content/content-calendar-template-page.tsx",
      "components/content/content-results-summary-page.tsx",
      "components/content/teaching-source-list-page.tsx",
      "components/content/teaching-source-page.tsx",
    ]) {
      const f = MIND.find((x) => x.ut === ut);
      expect(f, ut).toBeDefined();
      expect(f!.forras, ut).toMatch(/<PilotBack(Link|Button)\b/);
      expect(f!.forras, ut).not.toContain("Vissza a listához");
    }
  });
});

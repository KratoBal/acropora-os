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

/** A MÉG ÁT NEM ÁLLÍTOTT LAPOK: ma „Vissza a listához" gombbal vagy hivatkozással lépnek vissza. Csak csökkenhet. */
const MEG_ATALLITANDO = [
  "components/billing/billing-external-document-page.tsx",
  "components/billing/billing-incoming-document-page.tsx",
  "components/billing/billing-incoming-review-page.tsx",
  "components/customers/customer-detail-page.tsx",
  "components/customers/customer-editor-page.tsx",
  "components/finance/foxpost-settlements-page.tsx",
  "components/finance/gls-settlements-page.tsx",
  "components/finance/simplepay-settlements-page.tsx",
  "components/finance/stripe-settlements-page.tsx",
  "components/inventory/inventory-count-detail-page.tsx",
  "components/products/product-detail-page.tsx",
  "components/purchasing/purchase-invoice-detail-page.tsx",
  "components/suppliers/pilot/pilot-supplier-editor-page.tsx",
  "components/webshop/webshop-order-detail-page.tsx",
];

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

  it("a még át nem állított lapok listája pontosan a Vissza a listához feliratú, a közös komponenst nem használó lapok", () => {
    const valos = MIND.filter(
      (f) =>
        f.forras.includes("Vissza a listához") &&
        !f.forras.includes("PilotBackLink"),
    )
      .map((f) => f.ut)
      .sort();
    expect(valos).toEqual([...MEG_ATALLITANDO].sort());
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
    ]) {
      const f = MIND.find((x) => x.ut === ut);
      expect(f, ut).toBeDefined();
      expect(f!.forras, ut).toContain("<PilotBackLink");
      expect(f!.forras, ut).not.toContain("Vissza a listához");
    }
  });
});

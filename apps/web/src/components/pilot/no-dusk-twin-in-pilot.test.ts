import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A PILOT LAP CSAK A PILOT KÉSZLETET HASZNÁLJA (T1.3, kártya 0baba3b9, barracuda ötlete 2026-11-03). A régi (dusk) és az
  új (pilot) komponenskészlet egymás mellett él, és ugyanaz a beállítás a kettőben mást csinál: a dusk `Input` a
  `className`-et a belső mezőre teszi, a `PilotInput` a szélességet külön kezeli (#2083). Egy lap, ami a kettőt keveri,
  ezért két szabály szerint néz ki.

  PILOT FÁJL: amelyik egy `Pilot*` komponenst importál az `@acropora/ui`-ból (vagy a `pilot-ui`-ból), vagy
  `<PilotThemeRoot>`-ot rajzol. DUSK IKER: az a dusk komponens, aminek van pilot párja (`DUSK_IKREK`). A párja nélküliek
  (Alert, Skeleton, EmptyState, Icon, Textarea, ConfirmDialog, PageHeader) közösek, nem tartoznak ide.

  A HÁTRALÉVŐ LISTA (`HATRA`): a mai vegyes fájlok, mindegyik a benne maradt dusk ikrekkel. Csak fogyhat. MI PIROSÍT:
  ha egy pilot fájl a listán kívül dusk ikret importál; ha egy listás fájl új dusk ikret kap; ha egy listás fájl már
  nem vegyes, vagy megszűnt (akkor a sorát törölni kell, és a lista eggyel rövidebb). Fájl szintű mérés: a csak duskot
  használó, még át nem írt lapok nem ide tartoznak. A megjegyzéseket kivágjuk.
*/
const ROOT = join(process.cwd(), "src");

const DUSK_IKREK = [
  "Avatar",
  "Badge",
  "Button",
  "Card",
  "CardContent",
  "CardHeader",
  "FormField",
  "Input",
  "Select",
] as const;

const HATRA = new Map<string, string[]>([
  ["components/billing/billing-document-detail-page.tsx", ["Button"]],
  ["components/billing/billing-document-list-page.tsx", ["Button"]],
  ["components/billing/billing-external-document-page.tsx", ["Button"]],
  ["components/billing/billing-incoming-document-page.tsx", ["Button"]],
  ["components/billing/billing-incoming-list.tsx", ["Button"]],
  ["components/billing/billing-incoming-review-page.tsx", ["Button"]],
  ["components/billing/billing-receipts-view.tsx", ["Button"]],
  [
    "components/brands/brand-editor-page.tsx",
    ["Badge", "Button", "Card", "FormField", "Input", "Select"],
  ],
  [
    "components/brands/brand-list-page.tsx",
    ["Badge", "Button", "Card", "Input", "Select"],
  ],
  ["components/content/article-citations-panel.tsx", ["Button", "Input"]],
  [
    "components/content/article-editor-page.tsx",
    ["Button", "FormField", "Input"],
  ],
  [
    "components/content/content-create-page.tsx",
    ["Button", "Card", "CardContent", "FormField", "Input", "Select"],
  ],
  [
    "components/customers/customer-list-page.tsx",
    ["Badge", "Button", "Card", "Input", "Select"],
  ],
  ["components/finance/foxpost-settlements-page.tsx", ["Button"]],
  ["components/finance/gls-settlements-page.tsx", ["Button"]],
  ["components/finance/simplepay-settlements-page.tsx", ["Button"]],
  [
    "components/inventory/inventory-count-detail-page.tsx",
    ["Badge", "Button", "Card", "CardContent", "CardHeader"],
  ],
  [
    "components/inventory/inventory-count-list-page.tsx",
    ["Badge", "Button", "Card", "Select"],
  ],
  ["components/messages/messages-page.tsx", ["Input"]],
  ["components/mortality/mortality-list-page.tsx", ["Button"]],
  ["components/products/dose-effect-list-page.tsx", ["Badge"]],
  ["components/products/product-authority-card.tsx", ["Button"]],
  ["components/products/product-detail-page.tsx", ["Button", "Input"]],
  [
    "components/products/product-dose-effects-card.tsx",
    ["Badge", "Button", "Input", "Select"],
  ],
  ["components/products/product-list-page.tsx", ["Button"]],
  ["components/products/product-shipping-profile-card.tsx", ["Button"]],
  ["components/purchasing/expected-arrival-list-page.tsx", ["Button"]],
  ["components/purchasing/nav-incoming-invoice-list-page.tsx", ["Button"]],
  [
    "components/purchasing/purchase-invoice-detail-page.tsx",
    ["Badge", "Button", "Card", "CardContent", "CardHeader"],
  ],
  [
    "components/purchasing/purchase-invoice-edit-form.tsx",
    ["Button", "Card", "CardContent", "CardHeader"],
  ],
  [
    "components/purchasing/purchase-invoice-eu-editor-page.tsx",
    ["Badge", "Button", "Card", "FormField", "Input"],
  ],
  ["components/purchasing/purchase-invoice-list-page.tsx", ["Button"]],
  [
    "components/purchasing/purchase-invoice-scans.tsx",
    ["Button", "Card", "CardContent", "CardHeader"],
  ],
  ["components/quotes/quote-list-page.tsx", ["Button"]],
  [
    "components/seo-landing/seo-landing-list-page.tsx",
    ["Badge", "Button", "Card"],
  ],
  [
    "components/service-assets/asset-detail-page.tsx",
    ["Badge", "Button", "Card", "FormField", "Select"],
  ],
  [
    "components/service-assets/asset-editor-page.tsx",
    ["Button", "Card", "FormField", "Input", "Select"],
  ],
  ["components/service-assets/asset-list-page.tsx", ["Button"]],
  [
    "components/service-assets/pilot/pilot-asset-detail-page.tsx",
    ["Button", "FormField", "Select"],
  ],
  ["components/service-jobs/partner-picker.tsx", ["Select"]],
  [
    "components/service-jobs/service-job-detail-page.tsx",
    ["Badge", "Button", "FormField", "Input"],
  ],
  ["components/service-jobs/service-job-editor-page.tsx", ["Button", "Input"]],
  ["components/service-jobs/service-job-list-page.tsx", ["Button"]],
  ["components/service-jobs/service-job-placement-editor.tsx", ["Button"]],
  ["components/settings/mail-image-picker.tsx", ["Button"]],
  ["components/suppliers/pilot/pilot-supplier-editor-page.tsx", ["Badge"]],
  [
    "components/users/user-list-page.tsx",
    ["Badge", "Button", "Card", "Input", "Select"],
  ],
  ["components/users/user-visible-units.tsx", ["Button", "Card"]],
  ["components/webshop-orders/webshop-order-detail-page.tsx", ["Button"]],
  ["components/webshop-orders/webshop-orders-list-page.tsx", ["Button"]],
  [
    "components/webshop/stock-sync-outbox-page.tsx",
    ["Button", "Card", "CardContent", "CardHeader"],
  ],
  [
    "components/webshop/webshop-orders-page.tsx",
    ["Badge", "Button", "Card", "CardContent", "CardHeader"],
  ],
  [
    "components/webshop/webshop-product-list-page.tsx",
    ["Badge", "Button", "Card", "Input"],
  ],
  ["components/worksheets/worksheet-asset-editor.tsx", ["Button"]],
  ["components/worksheets/worksheet-assignee-editor.tsx", ["Button"]],
  ["components/worksheets/worksheet-entries.tsx", ["Button"]],
  [
    "components/worksheets/worksheet-line-editor.tsx",
    ["Button", "Card", "Input"],
  ],
  ["components/worksheets/worksheet-list-page.tsx", ["Avatar", "Button"]],
  [
    "components/worksheets/worksheet-material-requests.tsx",
    ["Badge", "Button", "Input"],
  ],
]);

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
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** A fájl `@acropora/ui`-ból és `pilot-ui`-ból importált, nem csak típusként használt nevei. */
function uiNevek(forras: string): Set<string> {
  const nevek = new Set<string>();
  for (const m of forras.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"(?:@acropora\/ui|[^"]*pilot-ui)"/g,
  )) {
    if (/^import\s+type\b/.test(m[0])) continue;
    for (const resz of m[1]!.split(",")) {
      const nev = resz.trim();
      if (!nev || nev.startsWith("type ")) continue;
      nevek.add(nev.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return nevek;
}

/** Egy forrás vegyes-e, és ha igen, melyik dusk ikrek vannak benne (rendezve); különben null. */
function vegyes(forras: string): string[] | null {
  const tiszta = kod(forras);
  const nevek = uiNevek(tiszta);
  const pilot =
    [...nevek].some((n) => n.startsWith("Pilot")) ||
    /<PilotThemeRoot\b/.test(tiszta);
  const dusk = DUSK_IKREK.filter((n) => nevek.has(n));
  return pilot && dusk.length ? [...dusk].sort() : null;
}

const mai = () =>
  new Map(
    fajlok(ROOT).flatMap((ut) => {
      const d = vegyes(readFileSync(ut, "utf8"));
      return d ? [[relative(ROOT, ut), d] as const] : [];
    }),
  );

describe("dusk iker a pilot lapon", () => {
  it("a mérő felismeri a vegyes fájlt (önteszt)", () => {
    expect(vegyes('import { Button, PilotCard } from "@acropora/ui";')).toEqual(
      ["Button"],
    );
    expect(
      vegyes(
        'import { Input } from "@acropora/ui";\nexport const X = () => <PilotThemeRoot />;',
      ),
    ).toEqual(["Input"]);
    expect(
      vegyes(
        'import {\n  Select,\n  Badge as B,\n  PilotInput,\n} from "@acropora/ui";',
      ),
    ).toEqual(["Badge", "Select"]);
    expect(
      vegyes('import { Alert, Skeleton, PilotButton } from "@acropora/ui";'),
    ).toBeNull();
    expect(vegyes('import { Button, Card } from "@acropora/ui";')).toBeNull();
    expect(
      vegyes('import { type Button, PilotCard } from "@acropora/ui";'),
    ).toBeNull();
    expect(
      vegyes(
        '// import { Button } from "@acropora/ui";\nimport { PilotCard } from "@acropora/ui";',
      ),
    ).toBeNull();
  });

  it("a mérő pilot fájlokat talál (pozitív kontroll)", () => {
    const pilot = fajlok(ROOT).filter((ut) =>
      [...uiNevek(kod(readFileSync(ut, "utf8")))].some((n) =>
        n.startsWith("Pilot"),
      ),
    );
    expect(pilot.length).toBeGreaterThan(100);
  });

  it("a vegyes fájlok pontosan a hátralévő lista, a benne maradt ikrekkel", () => {
    expect(Object.fromEntries(mai())).toEqual(Object.fromEntries(HATRA));
  });
});

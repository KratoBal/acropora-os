import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A LINK SZÍNE EGY: A ZÖLD (Picasso 3.17, 3.19, 3.23, 3.26; acrobot 62208). A lila (`brand-*`) link a Márkák, a Webshop termékek, a Tartalom, a Tartalomnaptár, az eredmény-összesítő és a feladat-tábla
  lapjain állt, a többi lap linkje zöld. A kép a képernyőn kirajzolt szín, amit a jsdom nem számol, ezért a forrás osztályneveit olvassuk: ha valaki lila linket vagy a harmadik "elsődleges" színt
  (sötétkék/fekete gomb) visszaír, ez pirosít. A naptár mai napja lila marad (nem link, kiemelés): azt a fájlt a pontos darabszám védi.
*/
const root = join(process.cwd(), "src", "components");
const text = (path: string) => readFileSync(join(root, path), "utf8");
const count = (path: string, needle: RegExp) =>
  (text(path).match(needle) ?? []).length;

const NO_PURPLE_LINKS = [
  "brands/brand-list-page.tsx",
  "webshop/webshop-product-list-page.tsx",
  "content/content-list-page.tsx",
  "content/content-calendar-template-page.tsx",
  "content/content-results-summary-page.tsx",
  "content/content-create-page.tsx",
  "tasks/task-board-page.tsx",
  // the second sweep (Picasso 3.19 to 3.23): the product, work sheet, certificate and landing page links
  "products/dose-effect-list-page.tsx",
  "products/manufacturer-claim-queue-page.tsx",
  "products/product-dose-effects-card.tsx",
  "products/product-manufacturer-claims-card.tsx",
  "seo-landing/seo-landing-list-page.tsx",
  "worksheets/worksheet-material-requests.tsx",
  "worksheets/worksheet-entries.tsx",
  "service-jobs/completion-certificate-panel.tsx",
  "brands/catalog-actions-panel.tsx",
  "imports/unas-brand-review-page.tsx",
  "settings/settings-overview-page.tsx",
  "settings/mail-image-picker.tsx",
  "service/service-detail-chrome.tsx",
] as const;

describe("link and primary colours", () => {
  it.each(NO_PURPLE_LINKS)(
    "%s has no purple (brand-*) text or border",
    (file) => {
      expect(count(file, /(?:text|border)-brand-\d00/g)).toBe(0);
    },
  );

  it("the content calendar keeps purple only for today's highlight, its links are green", () => {
    // exactly the two highlights (the day number and the weekday label), nothing else
    expect(count("content/content-calendar-page.tsx", /text-brand-700/g)).toBe(
      2,
    );
    expect(
      count("content/content-calendar-page.tsx", /text-pilot-aqua-700/g),
      // was 3 before the back arrow became the shared grey PilotBackLink (R12 batch 9): the green links left are the Sablon link and the entry links
    ).toBeGreaterThanOrEqual(2);
  });

  it("the import wizard's two buttons are the green primary, not a third colour", () => {
    const file = "imports/unas-import-wizard.tsx";
    expect(count(file, /bg-dusk-900/g)).toBe(0);
    expect(count(file, /rounded-lg bg-brand-700/g)).toBe(0);
    expect(count(file, /rounded-lg bg-pilot-aqua-700/g)).toBe(2);
  });
});

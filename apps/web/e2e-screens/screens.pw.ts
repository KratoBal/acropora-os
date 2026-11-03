import { appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  screenFileName,
  shellRoutes,
} from "../src/lib/ui-screens/shell-routes";

/*
  MINDEN STATIKUS LAP, A HÁROM SZÉLESSÉGEN (kártya 4cb013c3, T1.1). MI PIROSÍT: ha egy lap szélesebb a képernyőnél (a
  2026-11-03-i söprés 398, 443 és 896 px-es lapokat talált 390-en, a beolvadás UTÁN). A kép minden lapról elkészül, a
  pirostól függetlenül; az összesítő (summary.tsv) soronként: projekt, út, a lap és a képernyő szélessége, az állapot.
  A belépőre visszadobott lap nem piros, hanem "nincs-jog" (a fiók jogai döntenek, nem a lap).
*/
const OUT = process.env.UI_SCREENS_OUT ?? "test-results/ui-screens";
// the web package is ESM, so the folder comes from import.meta.url
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "src", "app");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [relative(join(HERE, ".."), path)] : [];
  });
}

const routes = shellRoutes(pages(APP));

test("POZITÍV KONTROLL: a lapok listája nem üres", () => {
  expect(routes.length).toBeGreaterThan(50);
});

for (const route of routes) {
  test(route, async ({ page }, info) => {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    // a lap adatai kliensoldalon töltődnek: a hálózat elcsendesedésére várunk, de egy beragadt kérés ne állítsa meg a sort
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => undefined);
    const url = new URL(page.url());
    const noAccess = url.pathname.startsWith("/login");
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({
      path: join(dir, `${screenFileName(route)}.png`),
      fullPage: true,
    });
    const state = noAccess
      ? "nincs-jog"
      : scrollWidth > innerWidth
        ? "SZELES"
        : "ok";
    appendFileSync(
      join(OUT, "summary.tsv"),
      `${info.project.name}\t${route}\t${scrollWidth}\t${innerWidth}\t${response?.status() ?? "-"}\t${state}\n`,
    );
    if (!noAccess)
      expect(
        scrollWidth,
        `${route}: a lap szélesebb a képernyőnél`,
      ).toBeLessThanOrEqual(innerWidth);
  });
}

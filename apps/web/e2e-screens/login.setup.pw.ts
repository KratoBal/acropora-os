import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const OUT = process.env.UI_SCREENS_OUT ?? "test-results/ui-screens";

/** Egyszer lép be a belépő lapon, és a munkamenetet a három szélesség-projekt átveszi. */
test("belépés", async ({ page }) => {
  const email = process.env.UI_SCREENS_EMAIL;
  const passwordFile = process.env.UI_SCREENS_PASSWORD_FILE;
  if (!process.env.UI_SCREENS_BASE_URL || !email || !passwordFile)
    throw new Error(
      "UI_SCREENS_BASE_URL, UI_SCREENS_EMAIL és UI_SCREENS_PASSWORD_FILE kell a képernyőkép-ellenőrzéshez",
    );
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page
    .locator("#login-password")
    .fill(readFileSync(passwordFile, "utf8").trim());
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await page.context().storageState({ path: `${OUT}/.login.json` });
  // a mostani futás összesítője tiszta lappal indul (a sorokat a screens.pw.ts fűzi hozzá)
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/summary.tsv`,
    "projekt\tut\tlap\tkepernyo\thttp\tallapot\n",
  );
});

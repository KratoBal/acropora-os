import { defineConfig, devices } from "@playwright/test";

import { AUTH_STATE, OUT } from "./paths";

/**
 * KÉPERNYŐKÉP-ELLENŐRZÉS (kártya 4cb013c3, T1.1): a web minden statikus lapja 390, 1024 és 1440 px-en; a lap nem lehet
 * szélesebb a képernyőnél, és minden lapról kép készül. Egy futó példány ellen megy (stage vagy egy CI-ben indított
 * `next start`), a címét és a belépést környezeti változók adják:
 *
 *   UI_SCREENS_BASE_URL       a web címe, például https://staging.acropora.hu
 *   UI_SCREENS_EMAIL          egy jelszavas fiók e-mail címe
 *   UI_SCREENS_PASSWORD_FILE  a jelszót tartalmazó fájl útja (a jelszó így nem kerül a parancssorba)
 *   UI_SCREENS_OUT            a képek és az összesítő helye (alapból test-results/ui-screens)
 *
 * Futtatás: `pnpm --filter @acropora/web ui:screens`. A lapnézés nem írhat: minden nem olvasó kérést a böngésző
 * megszakít (`write-guard.ts`), és ennek az öntesztje (`onteszt` projekt) fut elsőként; a munkamenet-fájl az OUT-on
 * kívül áll, és a futás végén törlődik (`paths.ts`, `global-teardown.ts`).
 */

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.pw\.ts$/,
  outputDir: `${OUT}/playwright`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: process.env.UI_SCREENS_BASE_URL,
    timezoneId: "Europe/Budapest",
    locale: "hu-HU",
    trace: "off",
    // a service worker kérései a kontextus szűrőjén kívül mennének (write-guard.ts)
    serviceWorkers: "block",
  },
  projects: [
    { name: "onteszt", testMatch: /write-guard\.selftest\.pw\.ts$/ },
    {
      name: "login",
      testMatch: /login\.setup\.pw\.ts$/,
      dependencies: ["onteszt"],
    },
    {
      name: "telefon-390",
      testMatch: /screens\.pw\.ts$/,
      dependencies: ["login"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: AUTH_STATE,
      },
    },
    {
      name: "tablet-1024",
      testMatch: /screens\.pw\.ts$/,
      dependencies: ["login"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
        storageState: AUTH_STATE,
      },
    },
    {
      name: "asztali-1440",
      testMatch: /screens\.pw\.ts$/,
      dependencies: ["login"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: AUTH_STATE,
      },
    },
  ],
});

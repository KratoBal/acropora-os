import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A képek és az összesítő helye; ezt a mappát lehet továbbadni vagy artefaktként feltölteni. */
export const OUT = process.env.UI_SCREENS_OUT ?? "test-results/ui-screens";

/*
  A MUNKAMENET-FÁJL AZ OUT-ON KÍVÜL (barracuda, #2091): a belépett fiók élő sütije van benne. Ha a képek mellett állna,
  a képekkel együtt menne tovább (továbbküldés, CI-artefakt). Az apps/web/.auth/ a .gitignore-ban áll, és a fájlt a
  futás végén a global-teardown.ts törli.
*/
export const AUTH_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".auth",
  "ui-screens-login.json",
);

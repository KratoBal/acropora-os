import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  A "KAPCSOLAT LETILTÁSA" MINDEN KAPCSOLAT-OLDALON UGYANAZ A SÚLY (Picasso 3.22 és 3.23): a NAV-nál és az UNAS-nál tömör piros gomb állt a biztonságos "Kapcsolat tesztelése" mellett, a Medusánál és a
  Számlázz.hu-nál halvány gomb. Egy veszélyes művelet ne legyen egyenrangú a mellette állóval: a súlyt a megerősítő ablak adja (mind a négy oldalon van), nem a gomb színe. A kirajzolt szín a jsdomban nem
  mérhető, ezért a forrás gomb-változatát olvassuk.
*/
const root = join(process.cwd(), "src", "components");
const PAGES = [
  "integrations/nav-connection-settings-page.tsx",
  "integrations/medusa-connection-settings-page.tsx",
  "integrations/szamlazz-connection-settings-page.tsx",
  "imports/unas-connection-settings-page.tsx",
] as const;

describe("the disable action on the connection pages", () => {
  it.each(PAGES)(
    "%s: the button is quiet and a confirm dialog stands behind it",
    (file) => {
      const source = readFileSync(join(root, file), "utf8");
      // the button that opens the confirm dialog
      const button =
        /<Button\s+variant="(\w+)"[^>]*?onClick=\{\(\) => setConfirmDisable\(true\)\}/s.exec(
          source,
        );
      expect(button, "a button that opens the confirm dialog").not.toBeNull();
      expect(button![1]).toBe("ghost");
      expect(source).toContain("<ConfirmDialog");
    },
  );
});

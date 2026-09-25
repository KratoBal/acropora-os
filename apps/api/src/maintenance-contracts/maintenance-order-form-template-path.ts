import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A DOCX-SABLON ÚTJA, FÖLFELÉ KERESVE -- UGYANAZ A MINTA, MINT A
 * `documents/pdf/pdf-font.ts` `resolvePdfFontPath`-ja.
 *
 * A `tsconfig` `include` értéke `src/**\/*.ts`, tehát a fordító a `.docx`
 * fájlokat NEM másolja a `dist`/`test-dist` mellé, ha a `src/` alatt
 * állnának -- ez pontosan az a csapda, amit a `pdf-font.ts` fejléce leír, és
 * amit mérve találtam meg itt is (2026-09-25, `npm run test`: `ENOENT`,
 * mert a `test-dist/maintenance-contracts/assets/` sosem jött létre). A
 * megoldás ugyanaz: a sablon a CSOMAG GYÖKERÉHEZ képest áll
 * (`apps/api/assets/megrendelolap/`, a `assets/fonts/` melletti testvér
 * mappa), és az útvonalat felfelé keresve találjuk meg -- ez működik a
 * fejlesztői futásnál (`dist`), a teszteknél (`test-dist`) és a telepített
 * képben (a csomag gyökere maga a `/app`) is, rögzített mélység nélkül.
 */

const TEMPLATE_RELATIVE_PATH = join(
  "assets",
  "megrendelolap",
  "megrendelolap-sablon.docx",
);

const HERE = dirname(fileURLToPath(import.meta.url));

export function resolveMaintenanceOrderFormTemplatePath(
  startDir: string = HERE,
): string {
  const tried: string[] = [];
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, TEMPLATE_RELATIVE_PATH);
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `A megrendelőlap docx-sablonja (${TEMPLATE_RELATIVE_PATH}) nem található. ` +
      `Végigpróbált utak: ${tried.join(", ")}`,
  );
}

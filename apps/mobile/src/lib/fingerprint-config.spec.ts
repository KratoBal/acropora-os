import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFingerprintAsync, SourceSkips } from "@expo/fingerprint";

/*
  AZ OTA-RUNTIME NEM FÜGGHET A package.json `scripts` MEZŐJÉTŐL (kártya 2be4f497). MI PIROSIT: ha a fingerprint.config.js eltűnne vagy
  nem hagyná ki a `scripts` forrást, a következő szkript-átírás (például a #2393 `test` szkriptje, 2026-11-10) új runtime-ot adna, és
  minden azóta kiadott OTA célt tévesztene.
  MÉRVE: a konfiguráció nélkül az ujjlenyomatban ott a `packageJson:scripts` forrás, és a két package.json-állapot (a #2393 előtti és
  utáni) ujjlenyomata eltér; a konfigurációval a forrás nincs, és a két állapot azonos hash-t ad.
  A mérés a VALÓDI projektgyökeret hash-eli (a `pnpm test` az apps/mobile mappából fut), kb. 5 másodperc.
*/
const root = process.cwd();

describe("a mobil ujjlenyomat-konfigurációja", () => {
  it("a konfiguráció kihagyja a package.json scripts forrást, és az alapértelmezett kihagyásokat megtartja", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(join(root, "fingerprint.config.js")) as {
      sourceSkips: number;
    };
    assert.ok(config.sourceSkips & SourceSkips.PackageJsonScriptsAll);
    assert.ok(
      config.sourceSkips &
        SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
    );
  });

  it("a projekt ujjlenyomatában nincs `packageJson:scripts` forrás", async () => {
    const fingerprint = await createFingerprintAsync(root, { silent: true });
    assert.ok(fingerprint.sources.length > 0, "üres forráslista: a mérés vak");
    assert.equal(
      fingerprint.sources.some(
        (source) => "id" in source && source.id === "packageJson:scripts",
      ),
      false,
    );
  });
});

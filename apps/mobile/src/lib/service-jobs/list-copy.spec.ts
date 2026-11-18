import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SERVICE_JOB_LIST_COPY } from "./list-copy";

/*
  A LISTA A HIBAJEGYEKET ÉS A KARBANTARTÁSI LAPOKAT EGYÜTT MUTATJA (kind=ALL), A SZÖVEGE IS (hibajegy-maradek lista, 4. fejezet, acrobot 56196). MI PIROSÍT: ha egy fajta nélküli mondat (jogosultság, üres lista,
  szűrés, tile) újra csak a hibajegyet nevezi meg; ha a képernyő nem ezeket a szövegeket használja; ha a telefon képességeiről szóló mondat elveszti a karbantartási lap állapotváltás nélküli voltát.
*/
const SRC = join(__dirname, "..", "..", "..", "src");
const olvas = (...ut: string[]) => readFileSync(join(SRC, ...ut), "utf8");

describe("a hibajegy-lista szövegei", () => {
  it("minden fajta nélküli mondat mindkét fajtát megnevezi", () => {
    for (const kulcs of [
      "noAccess",
      "scopeNeedsConnection",
      "emptyFiltered",
      "emptyOffline",
      "tileDescription",
    ] as const) {
      const szoveg = SERVICE_JOB_LIST_COPY[kulcs];
      assert.match(szoveg, /hibajegy/i, kulcs);
      assert.match(szoveg, /karbantartási lap/i, kulcs);
    }
    assert.match(SERVICE_JOB_LIST_COPY.screenTitle, /Hibajegyek/);
    assert.match(SERVICE_JOB_LIST_COPY.screenTitle, /karbantartás/);
  });

  it("a telefon képességeiről szóló mondat a hibajegyet nevezi meg, és kimondja a karbantartási lap szabályát", () => {
    const szoveg = SERVICE_JOB_LIST_COPY.capabilities;
    assert.match(szoveg, /Telefonon a hibajegy olvasható/);
    assert.doesNotMatch(szoveg, /[^a-zé]jegy[^a-zé]/);
    assert.match(
      szoveg,
      /A karbantartási lapon nincs állapotváltás: az aláírt munkalap a kész\./,
    );
  });

  it("a lista képernyője, a fejléc és a kezdőlap ezeket használja", () => {
    const lista = olvas("app", "service-jobs", "index.tsx");
    for (const kulcs of [
      "noAccess",
      "scopeNeedsConnection",
      "emptyFiltered",
      "emptyOffline",
      "capabilities",
    ])
      assert.match(
        lista,
        new RegExp(`SERVICE_JOB_LIST_COPY\\.${kulcs}`),
        `a lista nem használja: ${kulcs}`,
      );
    assert.match(
      olvas("app", "_layout.tsx"),
      /title: SERVICE_JOB_LIST_COPY\.screenTitle/,
    );
    assert.match(
      olvas("lib", "home", "modules.ts"),
      /description: SERVICE_JOB_LIST_COPY\.tileDescription/,
    );
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SERVICE_JOB_LIST_COPY } from "./list-copy";

/*
  A HIBAJEGYEK LISTÁJA CSAK HIBAJEGYET MUTAT (acrobot 56224, c pont; Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"): a telefonon a karbantartási lapoknak saját listájuk van, a hibajegy-lista `kind=REPAIR`-t kér, és a mentett másolatból is
  csak a hibajegyeket mutatja. A szövegei ezért csak a hibajegyet nevezik meg. MI PIROSÍT: ha egy mondat újra a karbantartási lapot is említi; ha a lista képernyője nem ezeket a szövegeket használja; ha a telefon képességeiről szóló mondat elveszti a hibajegy
  olvasható, léptethető és nyitható voltát; ha a lista a mentett másolatot szűretlenül mutatná.
*/
const SRC = join(__dirname, "..", "..", "..", "src");
const olvas = (...ut: string[]) => readFileSync(join(SRC, ...ut), "utf8");

describe("a hibajegy-lista szövegei", () => {
  it("minden mondat a hibajegyet nevezi meg, a karbantartási lapot egyik sem", () => {
    for (const kulcs of [
      "screenTitle",
      "noAccess",
      "scopeNeedsConnection",
      "emptyFiltered",
      "emptyOffline",
      "capabilities",
      "tileDescription",
    ] as const) {
      const szoveg = SERVICE_JOB_LIST_COPY[kulcs];
      assert.match(szoveg, /hibajegy/i, kulcs);
      assert.doesNotMatch(szoveg, /karbantart/i, kulcs);
    }
    assert.equal(SERVICE_JOB_LIST_COPY.screenTitle, "Hibajegyek");
  });

  it("a telefon képességeiről szóló mondat a hibajegyet írja le: olvasható, léptethető, fénykép, új jegy", () => {
    const szoveg = SERVICE_JOB_LIST_COPY.capabilities;
    assert.match(szoveg, /Telefonon a hibajegy olvasható/);
    assert.match(szoveg, /és új hibajegy is nyitható/);
    assert.doesNotMatch(szoveg, /[^a-zé]jegy[^a-zé]/);
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

describe("a hibajegy-lista képernyője csak hibajegyet mutat", () => {
  const lista = olvas("app", "service-jobs", "index.tsx");

  it("a mentett másolatból is csak a hibajegyeket veszi, és a sáv is ezt számolja", () => {
    assert.match(lista, /repairRowsOf\(cached\.data\?\.items \?\? \[\]\)/);
    assert.match(lista, /itemCount: cachedItems\.length/);
    assert.doesNotMatch(lista, /cached\.data\?\.items \?\? \[\];/);
  });

  it("a helyszín-letöltő és az Üzenetek kapcsolása szándékosan mindkét fajtát kéri", () => {
    // a letöltő: a szerelőnek a karbantartási lap is kell térerő nélkül; a kapcsolás: egy beszélgetés bármelyik fajtához kötődhet
    assert.match(
      olvas("components", "offline", "HelyszinLetolto.tsx"),
      /listServiceJobs\("open", "ALL"\)/,
    );
    assert.match(
      olvas("app", "uzenetek", "kapcsolas.tsx"),
      /listServiceJobs\("all", "ALL", debounced\)/,
    );
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KÉPERNYŐK BEKÖTÉSE, A FORRÁS ALAKJÁBÓL (acrobot 26167). A telefon
 * tesztsorában nincs képernyő-renderelő; ugyanaz a minta, mint a
 * `lib/offline/list-source-wiring.spec.ts` és a `list-scope.spec.ts` utolsó
 * állítása. Ha egyszer lesz renderelő, ezt VISELKEDÉSRE kell cserélni.
 *
 * MI PIROSÍT: ha egy szűrő visszakerül sima `useState`-be (akkor egy újra
 * felépülő lista ismét nulláz), vagy ha az anyagigény lapjáról kikerül a
 * billentyűzet-kezelés (kártya e45e1dda).
 */
const read = (path: string) => {
  const source = readFileSync(path, "utf8");
  // pozitív kontroll: rossz útvonalnál a nulla találat a fájlról szólna
  assert.ok(source.length > 1000, `üres vagy gyanúsan rövid: ${path}`);
  return source;
};

const sessionFields = (source: string) =>
  [...source.matchAll(/useSessionState(?:<[^>]*>)?\(\s*key\("(\w+)"\)/g)]
    .map((match) => match[1])
    .sort();

describe("a listák szűrése a munkamenet idejére marad", () => {
  it("a munkalap-lista minden szűrője a munkamenetben él", () => {
    const source = read("src/app/worksheets/index.tsx");
    assert.deepEqual(sessionFields(source), [
      "mineOnly",
      "page",
      "partner",
      "search",
      "status",
    ]);
  });

  it("a hibajegy-lista füle a munkamenetben él", () => {
    const source = read("src/app/service-jobs/index.tsx");
    assert.match(
      source,
      /useSessionState<ServiceJobScope>\(\s*sessionKey\(user\?\.id, "service-jobs", "scope"\)/,
    );
  });
});

describe("az anyagigény megjegyzés-mezője látszik gépelés közben", () => {
  it("a lap kitér a billentyűzet elől, és a mezőhöz görget", () => {
    const source = read("src/app/material-requests/request/[id].tsx");
    assert.match(source, /<KeyboardAvoidingView/);
    assert.match(source, /Keyboard\.addListener\("keyboardDidShow"/);
    assert.match(source, /scrollRef\.current\?\.scrollToEnd/);
    assert.match(source, /onFocus=\{\(\) => onFocusChange\(true\)\}/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { operationsPhotoClientKey } from "./photo-key";

/*
  MI PIROSIT: ha a kulcs a fájl útját (`/`) vagy túl sok karaktert vinne (a szerver `^[A-Za-z0-9_.:-]{8,128}$` mintája 400-at adna,
  és a kép örökre elakadna); ha ugyanaz a sor nem ugyanazt a kulcsot adná (az újraküldés másodikat hozna létre); ha két külön sor
  egy kulcsra esne.
*/
const PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const LONG_ROW =
  "asset-photo:operations-entry:asset0000000000000000001:tmpl00000000000000000001:2026-11-13T09:30:00.000Z:kep:file:///data/user/0/hu.acropora/cache/ImagePicker/12345678-aaaa-bbbb-cccc-1234567890ab.jpg";

describe("a kép szerver-oldali kulcsa", () => {
  it("a szerver mintájának megfelel akkor is, ha a sor-azonosító útvonalat és sok karaktert hordoz", () => {
    assert.ok(LONG_ROW.length > 128 && LONG_ROW.includes("/"));
    assert.match(operationsPhotoClientKey(LONG_ROW), PATTERN);
    assert.match(operationsPhotoClientKey("x"), PATTERN);
    assert.match(operationsPhotoClientKey(""), PATTERN);
  });

  it("ugyanaz a sor ugyanazt adja, két külön sor mást", () => {
    assert.equal(
      operationsPhotoClientKey(LONG_ROW),
      operationsPhotoClientKey(LONG_ROW),
    );
    const keys = new Set<string>();
    for (let i = 0; i < 2000; i += 1)
      keys.add(operationsPhotoClientKey(`${LONG_ROW}${i}`));
    assert.equal(keys.size, 2000);
    assert.notEqual(
      operationsPhotoClientKey(`${LONG_ROW}a`),
      operationsPhotoClientKey(`${LONG_ROW}b`),
    );
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignOperationsFieldKeys,
  operationsFieldErrors,
  operationsFieldKeyOf,
} from "./operations-log.js";

/*
  MI PIROSIT: ha a kulcs ékezetet, szóközt vagy hosszú szöveget tartana; ha két azonos címkéjű mező ugyanazt a kulcsot kapná
  (a bejegyzés egyik értéke felülírná a másikat); ha egy meglévő mező kulcsa átnevezéskor megváltozna (a régi értékek
  elvesznének); ha a mértékegység vagy a vízóra szerep nem szám mezőn is átmenne; ha két „előtte" mező is lehetne.
*/
test("a kulcs a címkéből: ékezet nélkül, kisbetű, csak a-z0-9_", () => {
  assert.equal(
    operationsFieldKeyOf("Vízóra állás (előtte)"),
    "vizora_allas_elotte",
  );
  assert.equal(operationsFieldKeyOf("  pH-érték  "), "ph_ertek");
  assert.equal(operationsFieldKeyOf("???"), "mezo");
  const hosszu = operationsFieldKeyOf("a".repeat(100) + " b");
  assert.ok(hosszu.length <= 40);
});

test("a kulcsok egyediek, és a meglévő kulcs megmarad átnevezéskor is", () => {
  assert.deepEqual(
    assignOperationsFieldKeys([
      { label: "Idő" },
      { label: "Idő" },
      { label: "Idő" },
    ]),
    ["ido", "ido_2", "ido_3"],
  );
  // a meglévő mező új címkével is a régi kulcsát tartja, és egy új mező nem viheti el egy később álló meglévő kulcsát
  assert.deepEqual(
    assignOperationsFieldKeys([
      { label: "Víz" },
      { key: "viz", label: "Vízóra" },
    ]),
    ["viz_2", "viz"],
  );
  // a kulcs hossza a számozott utótaggal is a határon belül marad
  const keys = assignOperationsFieldKeys([
    { label: "a".repeat(60) },
    { label: "a".repeat(60) },
  ]);
  assert.ok(keys.every((key) => key.length <= 40));
  assert.notEqual(keys[0], keys[1]);
});

test("a mezőlista szabályai: címke, hossz, szám-kötött mezők, egy előtte és egy utána", () => {
  assert.deepEqual(operationsFieldErrors([]), []);
  assert.deepEqual(
    operationsFieldErrors([
      { label: "Előtte", type: "NUMBER", unit: "m3", meterRole: "BEFORE" },
      { label: "Utána", type: "NUMBER", unit: "m3", meterRole: "AFTER" },
      { label: "Rendben", type: "BOOLEAN" },
    ]),
    [],
  );
  assert.equal(operationsFieldErrors([{ label: " ", type: "TEXT" }]).length, 1);
  assert.equal(
    operationsFieldErrors([{ label: "x", type: "TEXT", unit: "m3" }]).length,
    1,
  );
  assert.equal(
    operationsFieldErrors([{ label: "x", type: "BOOLEAN", meterRole: "AFTER" }])
      .length,
    1,
  );
  assert.equal(
    operationsFieldErrors([
      { label: "a", type: "NUMBER", meterRole: "BEFORE" },
      { label: "b", type: "NUMBER", meterRole: "BEFORE" },
    ]).length,
    1,
  );
  assert.equal(
    operationsFieldErrors(
      Array.from({ length: 31 }, (_, i) => ({
        label: `m${i}`,
        type: "TEXT" as const,
      })),
    ).length,
    1,
  );
  assert.equal(
    operationsFieldErrors([
      { label: "n", type: "NUMBER", unit: "x".repeat(17) },
    ]).length,
    1,
  );
});

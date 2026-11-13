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

test("a kulcsok egyediek, és a meglévő aktív kulcs megmarad átnevezéskor is", () => {
  assert.deepEqual(
    assignOperationsFieldKeys([
      { label: "Idő" },
      { label: "Idő" },
      { label: "Idő" },
    ]),
    ["ido", "ido_2", "ido_3"],
  );
  // a meglévő mező új címkével is a régi kulcsát tartja, és egy új mező nem viheti el egy később álló meglévő kulcsát
  const viz = new Set(["viz"]);
  assert.deepEqual(
    assignOperationsFieldKeys(
      [{ label: "Víz" }, { key: "viz", label: "Vízóra" }],
      { used: viz, active: viz },
    ),
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

/*
  MI PIROSIT (barracuda, #2497): ha egy elhagyott (kivezetett) mező kulcsa egy új, azonos címkéjű mezőhöz kerülne (a régi
  bejegyzések értéke az új mezőé lenne); ha a kliens tetszőleges, a sablonban nem létező vagy kivezetett kulcsot küldhetne, és
  az kulcs lenne; ha két mező ugyanazt a megadott kulcsot kapná.
*/
test("a kivezetett kulcs nem osztható ki újra, és a küldött kulcs csak aktív mezőé lehet", () => {
  const used = new Set(["viz", "vizora"]);
  const active = new Set(["vizora"]);
  // a „viz” kivezetett: egy új „Víz” mező más kulcsot kap
  assert.deepEqual(
    assignOperationsFieldKeys([{ label: "Víz" }], { used, active }),
    ["viz_2"],
  );
  // a kivezetett kulcs küldve sem fogadható el, és a tetszőleges szöveg sem; a címkéből készül
  assert.deepEqual(
    assignOperationsFieldKeys(
      [
        { key: "viz", label: "Víz" },
        { key: "Tetszőleges szöveg", label: "Más" },
      ],
      { used, active },
    ),
    ["viz_2", "mas"],
  );
  // ugyanazt az aktív kulcsot két mező nem kaphatja
  assert.deepEqual(
    assignOperationsFieldKeys(
      [
        { key: "vizora", label: "A" },
        { key: "vizora", label: "B" },
      ],
      { used, active },
    ),
    ["vizora", "b"],
  );
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

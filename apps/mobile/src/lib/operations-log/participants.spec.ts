import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectableColleagues } from "./participants";

/*
  A RÉSZTVEVŐK LISTÁJA (kártya f6694b49). MI PIROSIT: ha a bejelentkezett felhasználó a listán maradna (a „Te automatikusan szerepelsz" mellett
  a saját neve is választható); ha a szűrés a többi kollégát is kivenné, vagy megváltoztatná a sorrendet; ha ismeretlen felhasználónál
  (még nem töltött be a munkamenet) bárkit kivenne.
*/
const list = [
  { id: "u-balazs", name: "Balázs" },
  { id: "u-david", name: "Dávid" },
  { id: "u-feri", name: "Feri" },
];

describe("a választható résztvevők", () => {
  it("a bejelentkezett felhasználó kimarad, a többiek a sorrendjükben maradnak", () => {
    assert.deepEqual(selectableColleagues(list, "u-balazs"), [
      list[1],
      list[2],
    ]);
    assert.deepEqual(selectableColleagues(list, "u-feri"), [list[0], list[1]]);
  });

  it("ismeretlen felhasználónál senkit nem vesz ki, és nem módosítja a bemenetet", () => {
    const input = [...list];
    assert.deepEqual(selectableColleagues(input, undefined), list);
    assert.deepEqual(selectableColleagues(input, "u-masvalaki"), list);
    assert.deepEqual(input, list);
  });

  it("ha csak a hívó van a listán, üres lista marad (a képernyő a „nem érhető el” mondatot mutatja)", () => {
    assert.deepEqual(selectableColleagues([list[0]!], "u-balazs"), []);
  });
});

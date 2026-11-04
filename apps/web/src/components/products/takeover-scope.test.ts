import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TAKEOVER_EDITABLE,
  TAKEOVER_FROZEN,
  TAKEOVER_PRICE_NOTE,
  TAKEOVER_UNTOUCHED,
} from "./takeover-scope";

/*
  EGY LISTA, KÉT HELYEN (T4.1-D1, kártya 33f177b4). Az átvételi megerősítés a `takeover-scope.ts` listáiból rajzol, a
  `docs/PRODUCT-CATALOG.md` ugyanezt mondja el szövegben. MI PIROSÍT: ha a felület listájának egy tétele nem áll a
  dokumentum "Mely mezők tartoznak az átvett termékhez" szakaszában (valaki az egyiket bővítette, a másikat nem); ha a
  szakasz eltűnt vagy átnevezték; ha egy tétel két listában is áll.
*/
const DOC = join(process.cwd(), "../../docs/PRODUCT-CATALOG.md");

function szakasz(): string {
  const doc = readFileSync(DOC, "utf8");
  const eleje = doc.indexOf("### Mely mezők tartoznak az átvett termékhez");
  expect(eleje).toBeGreaterThan(-1);
  const vege = doc.indexOf("\n### ", eleje + 1);
  return doc.slice(eleje, vege === -1 ? undefined : vege).replace(/\s+/g, " ");
}

describe("az átvétel hatóköre", () => {
  it("a felület minden tétele a dokumentum szakaszában is áll", () => {
    const szoveg = szakasz();
    const hianyzik = [
      ...TAKEOVER_EDITABLE,
      ...TAKEOVER_FROZEN,
      ...TAKEOVER_UNTOUCHED,
    ].filter((tetel) => !szoveg.includes(tetel));
    expect(hianyzik).toEqual([]);
  });

  it("az ár mondata a dokumentumban is ugyanazt állítja", () => {
    const szoveg = szakasz();
    expect(szoveg).toContain(
      "a UNAS listaárából indul, ha a saját ár még üres",
    );
    expect(TAKEOVER_PRICE_NOTE).toContain(
      "a UNAS listaárából indul, ha a saját ár még üres",
    );
  });

  it("egy tétel csak egy listában áll", () => {
    const mind = [
      ...TAKEOVER_EDITABLE,
      ...TAKEOVER_FROZEN,
      ...TAKEOVER_UNTOUCHED,
    ];
    expect(new Set(mind).size).toBe(mind.length);
  });
});

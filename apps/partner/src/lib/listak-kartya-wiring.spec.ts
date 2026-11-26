import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A PARTNER-LISTÁK TELEFONON KÁRTYÁK (picasso képernyő-leltár, 4. pont, P2; acrobot 62272). A hibajegy-lista 2026-11-25 óta kártyás
 * (#2859); a másik öt lista 720-980 px-es táblája 390 px-en jobbra kifutott. Mostantól mind az öt ugyanarra a mintára vált
 * (`phone-table.ts`): `md` alatt a tábla blokk, a fejléc `sr-only`, a sor kártya, az első cella a cím, a többi a saját feliratával
 * (`data-label` = a fejléc szövege, ugyanabban a sorrendben).
 *
 * A HATÁR: forrást olvas (a csomagban nincs renderelő, lásd portal-wiring.spec.ts); a 390 px-es kilógás a teszten mérhető. MI PIROSIT:
 * egy listán hiányzik a blokk-váltás vagy az `sr-only` fejléc; egy cella felirata nem a hozzá tartozó fejléc; egy cella kimarad a
 * mintából.
 */
const LISTS = [
  "aquarium-list",
  "asset-list",
  "completion-certificate-list",
  "maintenance-order-list",
  "worksheet-list",
];

function parts(name: string) {
  const source = readFileSync(`src/components/${name}.tsx`, "utf8");
  const thead = source.slice(
    source.indexOf("<thead"),
    source.indexOf("</thead>"),
  );
  const heads = [...thead.matchAll(/^\s*"([^"]+)",$/gm)].map((m) => m[1]);
  const tbody = source.slice(
    source.indexOf("<tbody"),
    source.indexOf("</tbody>"),
  );
  const cells = [...tbody.matchAll(/<td\b((?:(?!>\s*\n)[\s\S])*?)>/g)].map(
    (m) => m[1]!,
  );
  return { source, heads, tbody, cells };
}

describe("P2: a partner-listák telefonon kártyák", () => {
  for (const name of LISTS) {
    it(`${name}: blokk-tábla, rejtett fejléc, kártya-sor, címkés cellák`, () => {
      const { source, heads, tbody, cells } = parts(name);
      assert.match(source, /from "@\/lib\/phone-table"/);
      assert.match(source, /<table className="[^"]*\bmax-md:block\b[^"]*">/);
      assert.match(source, /<thead className="max-md:sr-only">/);
      assert.match(tbody, /^<tbody className="max-md:block">/);
      assert.match(tbody, /<tr[\s\S]*?max-md:block max-md:px-5 max-md:py-3/);
      // positive control: the measurement sees the header and every cell
      assert.ok(heads.length >= 5, `${name}: ${heads.length} headers`);
      assert.equal(cells.length, heads.length, `${name}: cells vs headers`);
      assert.match(cells[0]!, /\$\{PHONE_TITLE_CELL\}/);
      cells.slice(1).forEach((cell, index) => {
        assert.match(cell, /\$\{PHONE_CELL\}/, `${name}: cell ${index + 1}`);
        assert.equal(
          cell.match(/data-label="([^"]+)"/)?.[1],
          heads[index + 1],
          `${name}: cell ${index + 1}`,
        );
      });
    });
  }

  it("a telefonos cella a feliratot a data-label-ből írja ki, idézett szövegként", () => {
    const source = readFileSync("src/lib/phone-table.ts", "utf8");
    assert.match(source, /"[^"]*max-md:before:content-\[attr\(data-label\)\]"/);
  });
});

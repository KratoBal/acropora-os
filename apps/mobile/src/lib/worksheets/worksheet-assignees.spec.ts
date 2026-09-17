import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  describeAssignableUsers,
  describeAssigneeReadOnly,
  toggleWorksheetAssignee,
  worksheetAssigneesChanged,
} from "./worksheet-assignees";

/** A FORRÁSFÁT olvassa; a `test-dist`-ben `.tsx` fájl nincs is. */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "worksheets",
  "[id].tsx",
);

function kepernyo(): string {
  try {
    return readFileSync(KEPERNYO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESÉS hibája, nem a lefedettségé -- az alábbi állítások addig semmit nem mondanak.`,
    );
  }
}

describe("toggleWorksheetAssignee", () => {
  it("adds a name that was not on the list", () => {
    assert.deepEqual(toggleWorksheetAssignee(["a"], "b"), ["a", "b"]);
  });

  it("removes a name that was on it", () => {
    assert.deepEqual(toggleWorksheetAssignee(["a", "b"], "a"), ["b"]);
  });

  /**
   * AZ ÚJ NÉV A VÉGÉRE KERÜL, nem valahova középre: a felhasználó így látja,
   * mit adott hozzá utoljára. Egy halmaz ezt elvenné.
   */
  it("keeps the order and appends at the end", () => {
    assert.deepEqual(toggleWorksheetAssignee(["c", "a"], "b"), ["c", "a", "b"]);
  });

  it("does not change the list it was given", () => {
    const eredeti = ["a"];
    toggleWorksheetAssignee(eredeti, "b");
    assert.deepEqual(eredeti, ["a"]);
  });
});

describe("worksheetAssigneesChanged", () => {
  it("says no when nothing moved", () => {
    assert.equal(worksheetAssigneesChanged(["a", "b"], ["a", "b"]), false);
  });

  /**
   * A SORREND NEM SZÁMÍT: a szerver halmazként tárolja. Ha számítana, a gomb
   * aktív maradna egy olyan „mentés" után, ami semmit nem változtat -- és a
   * szerelő azt hinné, nem ment el.
   */
  it("ignores the order, because the server stores a set", () => {
    assert.equal(worksheetAssigneesChanged(["b", "a"], ["a", "b"]), false);
  });

  it("sees an added name", () => {
    assert.equal(worksheetAssigneesChanged(["a", "b"], ["a"]), true);
  });

  it("sees a removed name", () => {
    assert.equal(worksheetAssigneesChanged(["a"], ["a", "b"]), true);
  });

  /**
   * AZ ÜRESRE TÖRLÉS VALÓDI VÁLTOZÁS. Ha nem annak látná, a gomb tiltva
   * maradna, és a lapot NEM lehetne felelős nélkül hagyni -- holott a szerver
   * üres listát is elfogad.
   */
  it("sees clearing the whole list", () => {
    assert.equal(worksheetAssigneesChanged([], ["a"]), true);
  });

  /**
   * ISMÉTLŐDÉSSEL IS HELYES. Egy sima hossz-összehasonlítás itt hamis
   * „változott"-at adna: két elem kontra egy név.
   */
  it("is not fooled by a repeated id", () => {
    assert.equal(worksheetAssigneesChanged(["a", "a"], ["a"]), false);
  });
});

describe("describeAssignableUsers", () => {
  it("says nothing when there is a list to show", () => {
    assert.equal(
      describeAssignableUsers({ loading: false, error: false, count: 3 }),
      null,
    );
  });

  /**
   * A HÁROM ÜRES-ESET HÁROM KÜLÖN MONDAT, mert a teendőjük más. Egy közös
   * „nincs kit választani" azt állítaná, hogy nincs kolléga -- holott egy
   * elbukott lekérdezésnél csak nem tudjuk, van-e.
   */
  it("tells the loading and the failed case apart", () => {
    const tolt = describeAssignableUsers({
      loading: true,
      error: false,
      count: 0,
    });
    const hiba = describeAssignableUsers({
      loading: false,
      error: true,
      count: 0,
    });
    const ures = describeAssignableUsers({
      loading: false,
      error: false,
      count: 0,
    });
    assert.notEqual(tolt, hiba);
    assert.notEqual(hiba, ures);
    assert.notEqual(tolt, ures);
    assert.match(ures ?? "", /Nincs olyan kolléga/);
    // A HIBA NE ÁLLÍTSA, hogy nincs kolléga: csak azt, hogy nem tudjuk.
    assert.doesNotMatch(hiba ?? "", /Nincs olyan kolléga/);
  });

  /**
   * A HIBA ERŐSEBB, MINT A TÖLTÉS: ha mind a kettő igaz (egy újratöltés bukott
   * el), azt kell mondani, ami a teendőt hordozza.
   */
  it("prefers the failure over the loading state", () => {
    assert.equal(
      describeAssignableUsers({ loading: true, error: true, count: 0 }),
      describeAssignableUsers({ loading: false, error: true, count: 0 }),
    );
  });
});

describe("describeAssigneeReadOnly", () => {
  it("says nothing to somebody who may edit", () => {
    assert.equal(describeAssigneeReadOnly(true), null);
  });

  /**
   * A HIÁNYZÓ GOMB OKÁT KI KELL MONDANI. Egy gomb, ami egyszerűen nincs ott,
   * ugyanúgy néz ki, mint egy elromlott.
   */
  it("says why the control is missing for a viewer", () => {
    const mondat = describeAssigneeReadOnly(false) ?? "";
    assert.match(mondat, /iroda/);
    assert.match(mondat, /látszanak/);
  });
});

describe("a kiosztás a képernyőn", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(kepernyo().length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  /**
   * A LAP ÁLLAPOTA NEM FELTÉTEL, ÉS EZ MÉRÉS, NEM ÍZLÉS. A szerver a kiosztást
   * NEM köti állapothoz (`setAssignees`), mert az munkaszervezés, nem a
   * dokumentum tartalma. Egy `DRAFT`-kapu itt olyat tiltana, amit a szerver
   * megenged -- és egy tévesen kiosztott lezárt lapot senki nem tudna javítani.
   */
  it("a kiosztás nincs piszkozat-állapothoz kötve", () => {
    assert.doesNotMatch(
      kepernyo(),
      /assigneeDraft[\s\S]{0,400}?current\.status === "DRAFT"/,
      "a kiosztás piszkozat-feltételt kapott: a szerver ennél többet enged",
    );
  });

  /**
   * AKI CSAK NÉZHET, AZ IS LÁTJA A NEVEKET, ÉS MEGTUDJA, MIÉRT NINCS GOMB.
   */
  it("a képernyő kimondja, miért nincs gombja annak, aki csak nézhet", () => {
    assert.match(kepernyo(), /readOnlyAssigneeNotice/);
  });

  /**
   * A TELJES ÁLLAPOT KI VAN MONDVA. A `PUT` felülír, nem hozzáad -- e nélkül a
   * szerelő azt hinné, hogy a korábbi felelősök MELLÉ kerül az új név.
   */
  it("a képernyő kimondja, hogy a mentés a teljes névsort írja felül", () => {
    const forras = kepernyo();
    assert.match(forras, /Mentés után pontosan ez a/);
    assert.match(forras, /nem lesz felelőse/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hiddenRowsWhere, mayHideRows, NOT_HIDDEN } from "./hidden-rows.js";

const BELSO = { kind: "internal" } as const;
const VEVO = { kind: "customer", customerId: "cust-1" } as const;
const SZALLITO = { kind: "supplier", supplierId: "sup-1" } as const;

describe("a rejtett sorok szűrője", () => {
  it("alapból KIHAGYJA a rejtetteket, minden hatókörön", () => {
    /*
      MI PIROSIT: ha az alapertelmezes megfordul. Ez a legdragabb irany: a
      probasorok CSENDBEN visszajonnenek minden listaba, es senki nem keresne,
      mert a rejtes "mukodott" -- egyszer.
    */
    for (const scope of [BELSO, VEVO, SZALLITO])
      assert.deepEqual(hiddenRowsWhere(scope, undefined), { hiddenAt: null });
  });

  it("belső hatókörön a kapcsoló NYIT", () => {
    assert.deepEqual(hiddenRowsWhere(BELSO, true), {});
  });

  it("PARTNER hatókörön a kapcsoló NEM ÉRTELMEZETT", () => {
    /*
      EZ AZ ALLITAS A LENYEG. Az `includeHidden` keres-parameter, tehat a
      partner portaljan is megadhato. Ha a hivo dontene el, a probasorok pont
      ott jelennenek meg, ahol a legrosszabb.

      MI PIROSIT: ha a kapcsolo vizsgalata a hatokor ELE kerul. Egy ilyen csere
      a BELSO agon semmit nem valtoztat, tehat a tobbi allitas zold maradna.
    */
    assert.deepEqual(hiddenRowsWhere(VEVO, true), { hiddenAt: null });
    assert.deepEqual(hiddenRowsWhere(SZALLITO, true), { hiddenAt: null });
  });

  it("a hamis kapcsoló ugyanaz, mint a hiányzó", () => {
    assert.deepEqual(hiddenRowsWhere(BELSO, false), { hiddenAt: null });
  });

  it("TAGADÁS HELYETT `hiddenAt: null` -- a kulcs és az érték is számít", () => {
    /*
      A `NOT: { hiddenAt: { not: null } }` alak ugyanazt igeri, es a Prisma a
      NOT agon az IS NULL sorokat elejtheti: akkor a rejtes helyett MINDENT
      elrejtenenk, es a hiba nema lenne.

      Ezert nem eleg azt allitani, hogy "kihagyja a rejtetteket" -- az ALAKRA
      is allitani kell, kulonben egy tagadasos atiras zolden atmenne.
    */
    const w = hiddenRowsWhere(BELSO, undefined);
    assert.deepEqual(Object.keys(w), ["hiddenAt"]);
    assert.equal(w.hiddenAt, null);
    assert.deepEqual({ ...NOT_HIDDEN }, w);
  });

  it("a visszaadott objektum NEM a közös konstans", () => {
    /*
      MI PIROSIT: ha valaki a `NOT_HIDDEN` konstanst adja vissza masolas
      nelkul. Egy hivo, aki a kapott objektumba beleir (spread helyett
      hozzarendelessel), a KOVETKEZO hivas eredmenyet is atirna -- es a hiba
      tavol keletkezne attol a helytol, ahol a kar latszik.
    */
    const a = hiddenRowsWhere(BELSO, undefined);
    const b = hiddenRowsWhere(BELSO, undefined);
    assert.notEqual(a, b);
    assert.notEqual(a, NOT_HIDDEN as unknown as typeof a);
  });
});

describe("ki rejthet el egy sort", () => {
  it("csak a belső hatókör", () => {
    assert.equal(mayHideRows(BELSO), true);
    assert.equal(mayHideRows(VEVO), false);
    assert.equal(mayHideRows(SZALLITO), false);
  });
});

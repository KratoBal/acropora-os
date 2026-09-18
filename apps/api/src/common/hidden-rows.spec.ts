import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hiddenRowsWhere, mayHideRows, NOT_HIDDEN } from "./hidden-rows.js";

const BELSO = { kind: "internal" } as const;
const VEVO = { kind: "customer", customerId: "cust-1" } as const;
const SZALLITO = { kind: "supplier", supplierId: "sup-1" } as const;

/**
 * A `SERVICE_HIDE` JOG MEGLETE, TENYKENT.
 *
 * A regi allitasok a HATOKORROL szolnak, tehat mind jog-birtokos hivoval
 * futnak: igy azok tovabbra is pontosan azt merik, amit a nevuk mond. A jog
 * sajat tengelye kulon `describe`-ban all lent.
 */
const JOGA_VAN = true;
const NINCS_JOGA = false;

describe("a rejtett sorok szűrője", () => {
  it("alapból KIHAGYJA a rejtetteket, minden hatókörön", () => {
    /*
      MI PIROSIT: ha az alapertelmezes megfordul. Ez a legdragabb irany: a
      probasorok CSENDBEN visszajonnenek minden listaba, es senki nem keresne,
      mert a rejtes "mukodott" -- egyszer.
    */
    for (const scope of [BELSO, VEVO, SZALLITO])
      assert.deepEqual(hiddenRowsWhere(scope, undefined, JOGA_VAN), {
        hiddenAt: null,
      });
  });

  it("belső hatókörön a kapcsoló NYIT", () => {
    assert.deepEqual(hiddenRowsWhere(BELSO, true, JOGA_VAN), {});
  });

  it("PARTNER hatókörön a kapcsoló NEM ÉRTELMEZETT", () => {
    /*
      EZ AZ ALLITAS A LENYEG. Az `includeHidden` keres-parameter, tehat a
      partner portaljan is megadhato. Ha a hivo dontene el, a probasorok pont
      ott jelennenek meg, ahol a legrosszabb.

      MI PIROSIT: ha a kapcsolo vizsgalata a hatokor ELE kerul. Egy ilyen csere
      a BELSO agon semmit nem valtoztat, tehat a tobbi allitas zold maradna.
    */
    assert.deepEqual(hiddenRowsWhere(VEVO, true, JOGA_VAN), { hiddenAt: null });
    assert.deepEqual(hiddenRowsWhere(SZALLITO, true, JOGA_VAN), {
      hiddenAt: null,
    });
  });

  it("a hamis kapcsoló ugyanaz, mint a hiányzó", () => {
    assert.deepEqual(hiddenRowsWhere(BELSO, false, JOGA_VAN), {
      hiddenAt: null,
    });
  });

  it("TAGADÁS HELYETT `hiddenAt: null` -- a kulcs és az érték is számít", () => {
    /*
      A `NOT: { hiddenAt: { not: null } }` alak ugyanazt igeri, es a Prisma a
      NOT agon az IS NULL sorokat elejtheti: akkor a rejtes helyett MINDENT
      elrejtenenk, es a hiba nema lenne.

      Ezert nem eleg azt allitani, hogy "kihagyja a rejtetteket" -- az ALAKRA
      is allitani kell, kulonben egy tagadasos atiras zolden atmenne.
    */
    const w = hiddenRowsWhere(BELSO, undefined, JOGA_VAN);
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
    const a = hiddenRowsWhere(BELSO, undefined, JOGA_VAN);
    const b = hiddenRowsWhere(BELSO, undefined, JOGA_VAN);
    assert.notEqual(a, b);
    assert.notEqual(a, NOT_HIDDEN as unknown as typeof a);
  });
});

describe("ki rejthet el egy sort", () => {
  it("csak a belső hatókör", () => {
    assert.equal(mayHideRows(BELSO, JOGA_VAN), true);
    assert.equal(mayHideRows(VEVO, JOGA_VAN), false);
    assert.equal(mayHideRows(SZALLITO, JOGA_VAN), false);
  });
});

describe("a rejtés joga a hatókör MELLETT áll", () => {
  /*
    Balazs kerese, 2026-09-18 11:09 UTC, MAR ELES HASZNALAT KOZBEN: "megcsinaltam,
    de a gomb ottmarad es megnyomhato barmelyik lapnal, jegynel. Azt szeretnem,
    hogy csak admin jogos felhasznalonal jelenjen meg".

    A KET FELTETEL KULONBOZO EMBEREKET ZAR KI, es ezert kell mind a ketto:
    a hatokor a PARTNERT, a jog a sajat SERVICE szerepu kollegainkat -- akik
    `SERVICE_MANAGE`-et viselnek, tehat a regi kapun atmentek volna.
  */
  it("jog NÉLKÜL a belső hívó sem lát rejtettet", () => {
    /*
      MI PIROSIT: ha a jog-feltetel kimarad. Ez volt a MERT hiba: a gomb es a
      kapcsolo minden `SERVICE_MANAGE` jogu felhasznalonal ott allt.
    */
    assert.deepEqual(hiddenRowsWhere(BELSO, true, NINCS_JOGA), {
      hiddenAt: null,
    });
    assert.equal(mayHideRows(BELSO, NINCS_JOGA), false);
  });

  it("jog ÖNMAGÁBAN nem elég: a partner akkor sem", () => {
    /*
      MI PIROSIT: ha valaki a hatokor-feltetelt csereli le jog-ellenorzesre.
      A `SERVICE_MANAGE` jogot a partner-fiokok is viselik; ha egyszer a
      `SERVICE_HIDE` is odakerulne, egy jog-only kapu atengedne oket.
    */
    assert.equal(mayHideRows(VEVO, JOGA_VAN), false);
    assert.equal(mayHideRows(SZALLITO, JOGA_VAN), false);
  });

  it("MIND A KETTŐ kell, és együtt elég", () => {
    assert.equal(mayHideRows(BELSO, JOGA_VAN), true);
    assert.deepEqual(hiddenRowsWhere(BELSO, true, JOGA_VAN), {});
  });
});

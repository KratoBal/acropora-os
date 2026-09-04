import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canEditWorksheetEntry,
  describeEntryEditRefusal,
} from "./worksheet-entry-permission.js";

/**
 * KI SZERKESZTHET EGY MUNKANAPLO-BEJEGYZEST.
 *
 * A szabaly ket helyen hat: a szerver elutasitja az irast, es ugyanez adja a
 * valaszban a `canEdit` mezot. Ezert nem eleg a kepernyot merni -- ha a gomb
 * eltunik, de a vegpont enged, a lyuk nyitva van, es a teszt zold.
 */

const base = {
  userId: "user-1",
  worksheetCreatedById: null as string | null,
  serviceJobOpenedById: null as string | null,
};

describe("a bejegyzés szerkeszthetősége", () => {
  it("a munkalap KÉSZÍTŐJE szerkesztheti", () => {
    assert.equal(
      canEditWorksheetEntry({ ...base, worksheetCreatedById: "user-1" }),
      true,
    );
  });

  it("a hibajegy LÉTREHOZÓJA is szerkesztheti", () => {
    /*
      A MASODIK AG KULON ALLITAS, es nem masolat: egy valtozat, ami csak a lap
      keszitojet nezi, a fenti allitason atmenne. A ket ag ket KULON emberrol
      szol, es a lap keletkezhet ugy is, hogy a jegy csak utana szuletik.
    */
    assert.equal(
      canEditWorksheetEntry({ ...base, serviceJobOpenedById: "user-1" }),
      true,
    );
  });

  it("MÁS nem szerkesztheti, akkor sem, ha ő írta", () => {
    /*
      SZO SZERINTI OLVASAT: Balazs a lap keszitojet es a jegy letrehozojat
      nevezte meg, a bejegyzes SZERZOJET nem. Egy masik szerelo, aki a
      helyszinen beirta, tehat nem tudja atirni a sajat bejegyzeset.

      MI PIROSIT: egy `|| userId === authorId` ag felvetele. Az kenyelmesnek
      latszik, es NEM az, amit kertek -- ha megis az kell, az dontes lesz, nem
      mellekhatas.
    */
    assert.equal(
      canEditWorksheetEntry({
        userId: "user-2",
        worksheetCreatedById: "user-1",
        serviceJobOpenedById: "user-3",
      }),
      false,
    );
  });

  it("KÉT ISMERETLEN azonosító nem nyit kaput", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. Mind a ket azonosito
      ELHAGYHATO a semaban (a lap keszitoje SetNull, a jegy nyitoja idegenkulcs
      nelkul all). Egy `userId === worksheetCreatedById` osszehasonlitas ket
      hianyzo ertek mellett IGAZAT adna, ha a kero azonositoja is hianyozhatna
      -- es akkor egy regi lapon BARKI szerkeszthetne.

      MI PIROSIT: a `userId` meglétének elhagyasa a feltetelbol.
    */
    assert.equal(canEditWorksheetEntry({ ...base, userId: "" }), false);
    assert.equal(canEditWorksheetEntry(base), false);
  });
});

describe("miért nem szerkeszthető", () => {
  it("szerkeszthetőnél NINCS mondat", () => {
    // Egy indoklas ott, ahol a gomb megjelenik, ZAJ -- es a valodi teendot
    // nyomna el.
    assert.equal(
      describeEntryEditRefusal({ ...base, worksheetCreatedById: "user-1" }),
      null,
    );
  });

  it("ha VAN kit megkérni, a mondat MEGNEVEZI őket", () => {
    const message = describeEntryEditRefusal({
      userId: "user-2",
      worksheetCreatedById: "user-1",
      serviceJobOpenedById: null,
    });
    assert.match(message ?? "", /munkalap készítője vagy a hibajegy/);
  });

  it("ha NINCS kit megkérni, azt MÁS mondat mondja meg", () => {
    /*
      A KET ESET TEENDOJE MAS, ezert nem eleg egy kozos "nincs jogod" mondat.
      Az elsonel van kit megkerni; a masodiknal SENKI nem szerkesztheti, es ha
      ezt nem mondjuk ki, a szerelo keresni fogja azt az embert, aki nincs.

      MI PIROSIT: egy kozos szoveg a ket agra.
    */
    const message = describeEntryEditRefusal({ ...base, userId: "user-2" });
    assert.match(message ?? "", /sem ismert/);
    assert.notEqual(
      message,
      describeEntryEditRefusal({
        userId: "user-2",
        worksheetCreatedById: "user-1",
        serviceJobOpenedById: null,
      }),
    );
  });
});

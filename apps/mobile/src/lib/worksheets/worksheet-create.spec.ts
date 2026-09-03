import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetCreatePayload,
  type WorksheetCreateForm,
} from "./worksheet-create";

/**
 * A HÁROM KÖTELEZŐ MEZŐ, ÉS AMI ELHAGYHATÓ.
 *
 * A szerver `customerId`, `departmentId` és `subject` hármast kér; a `lines`
 * alapértelmezése ÜRES TÖMB, tehát a lap tétel nélkül is létrejön. Emiatt fér
 * el a helyszíni felvitel egyetlen képernyőn.
 */

const ures: WorksheetCreateForm = {
  customerId: "",
  departmentId: "",
  subject: "",
  description: "",
};

const teljes: WorksheetCreateForm = {
  customerId: "customer-42",
  departmentId: "department-1",
  subject: "Szivattyú csere",
  description: "",
};

describe("az új munkalap űrlapja", () => {
  it("a HÁROM kötelező mezővel átmegy, és nem küld többet", () => {
    /*
      ISMERT POZITIV KONTROLL a lenti elutasitasokhoz: e nelkul egy valtozat,
      ami MINDENT elutasit, atmenne mindegyiken.
    */
    const r = buildWorksheetCreatePayload(teljes);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok ? r.payload : null, {
      customerId: "customer-42",
      departmentId: "department-1",
      subject: "Szivattyú csere",
    });
  });

  it("partner nélkül a PARTNER mezőnél áll meg", () => {
    const r = buildWorksheetCreatePayload(ures);
    assert.equal(r.ok, false);
    assert.equal(r.ok ? null : r.field, "customer");
  });

  it("helyszín nélkül a HELYSZÍN mezőnél áll meg", () => {
    /*
      MI PIROSIT: ha a `departmentId` elhagyhato lenne. A szerver KOTELEZONEK
      veszi, tehat a hiba a kuldes utan jonne vissza -- a felhasznalo pedig azt
      latna, hogy a gomb nem csinal semmit.
    */
    const r = buildWorksheetCreatePayload({ ...ures, customerId: "c" });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? null : r.field, "department");
  });

  it("tárgy nélkül a TÁRGY mezőnél áll meg", () => {
    const r = buildWorksheetCreatePayload({ ...teljes, subject: "   " });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? null : r.field, "subject");
  });

  it("a TÚL HOSSZÚ tárgyat MI utasítjuk el, nem a szerver", () => {
    /*
      A szerver 500 karakternel vag. Ha ezt nem merjuk itt, a felvitel egy
      halozati kor utan bukna el, es a hibauzenet a keperno tetejen jelenne meg
      -- ahonnan a gomb mar kigorgott.
    */
    const r = buildWorksheetCreatePayload({
      ...teljes,
      subject: "a".repeat(501),
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? null : r.field, "subject");
    assert.match(r.ok ? "" : r.message, /501/);
  });

  it("a leírás bekerül, ha van, és KIMARAD, ha üres", () => {
    /*
      Egy ures sztring a szerveren megkulonboztethetetlen lenne a szandekosan
      uresre irt leirastol, es a lapon ures blokkent jelenne meg.
    */
    const vanLeiras = buildWorksheetCreatePayload({
      ...teljes,
      description: "  A szivattyú zajos volt.  ",
    });
    assert.deepEqual(
      vanLeiras.ok ? vanLeiras.payload.description : null,
      "A szivattyú zajos volt.",
    );

    const nincs = buildWorksheetCreatePayload({
      ...teljes,
      description: "   ",
    });
    assert.equal(nincs.ok, true);
    assert.equal(
      nincs.ok ? Object.hasOwn(nincs.payload, "description") : true,
      false,
    );
  });

  it("a TÚL HOSSZÚ leírás is itt bukik el", () => {
    const r = buildWorksheetCreatePayload({
      ...teljes,
      description: "a".repeat(4001),
    });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.message, /4001/);
  });
});

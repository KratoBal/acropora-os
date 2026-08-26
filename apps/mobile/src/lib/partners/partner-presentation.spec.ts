import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partnerAddressLine,
  partnerContactRows,
  partnerDetailRows,
  partnerListSubtitle,
  type PartnerLike,
} from "./partner-presentation";

/**
 * A HIÁNY A TÉT, nem a formázás.
 *
 * A szerelő a helyszínen abból dolgozik, ami a képernyőn van. Egy sor, ami ott
 * áll, de üres, azt állítja, hogy tudunk róla valamit -- és a keresést arra
 * viszi, hogy „miért nincs kitöltve", ahelyett, hogy telefonálna. Ezért a
 * hiányzó mező nem üres értékké alakul, hanem NEM LESZ SOR.
 */

const partner: PartnerLike = {
  name: "Fánk Kft.",
  code: "FANK",
  worksheetPartnerCode: "FANK",
  phone: "+36 1 234 5678",
  email: "info@fank.invalid",
  contactPersonName: "Kovács Anna",
  contactPersonPhone: "+36 30 111 2222",
  contactPersonEmail: "anna@fank.invalid",
  postalCode: "1077",
  city: "Budapest",
  addressLine1: "Rózsa utca 12.",
};

describe("partnerAddressLine", () => {
  it("writes the address the way it would look on an envelope", () => {
    assert.equal(partnerAddressLine(partner), "1077 Budapest, Rózsa utca 12.");
  });

  /**
   * A FÉLIG KITÖLTÖTT CÍM MEGY. Egy városnév önmagában is több a semminél
   * annak, aki most indul el, és a hiányzó házszám nem ok arra, hogy a
   * település se látszódjon.
   */
  it("keeps what there is when the address is half filled", () => {
    assert.equal(
      partnerAddressLine({ ...partner, addressLine1: undefined }),
      "1077 Budapest",
    );
    assert.equal(
      partnerAddressLine({
        ...partner,
        postalCode: undefined,
        city: undefined,
      }),
      "Rózsa utca 12.",
    );
  });

  it("gives an empty string when there is nothing to write", () => {
    assert.equal(
      partnerAddressLine({
        name: "Névtelen",
        code: "X",
        postalCode: "  ",
        city: "",
      }),
      "",
    );
  });
});

describe("partnerContactRows", () => {
  it("keeps the phone even when nobody put a name next to it", () => {
    const rows = partnerContactRows({
      ...partner,
      contactPersonName: undefined,
      contactPersonEmail: undefined,
    });

    assert.deepEqual(rows, [
      { label: "Kapcsolattartó telefon", value: "+36 30 111 2222" },
    ]);
  });

  it("returns nothing at all when there is no contact", () => {
    assert.deepEqual(partnerContactRows({ name: "Névtelen", code: "X" }), []);
  });
});

describe("partnerDetailRows", () => {
  it("always shows the partner code, because that is what everything else refers to", () => {
    const rows = partnerDetailRows({ name: "Névtelen", code: "NEVT" });

    assert.deepEqual(rows, [{ label: "Partnerkód", value: "NEVT" }]);
  });

  it("does not turn a missing field into an empty row", () => {
    const rows = partnerDetailRows({
      ...partner,
      phone: "   ",
      email: undefined,
      worksheetPartnerCode: "",
    });

    const labels = rows.map((row) => row.label);
    assert.equal(labels.includes("Telefon"), false);
    assert.equal(labels.includes("E-mail"), false);
    assert.equal(labels.includes("Munkalap-előtag"), false);
    // És ami VAN, az megmarad:
    assert.equal(labels.includes("Cím"), true);
    assert.equal(labels.includes("Kapcsolattartó"), true);
  });

  it("lists the partner's own lines before the contact person's", () => {
    const labels = partnerDetailRows(partner).map((row) => row.label);

    assert.deepEqual(labels, [
      "Partnerkód",
      "Munkalap-előtag",
      "Cím",
      "Telefon",
      "E-mail",
      "Kapcsolattartó",
      "Kapcsolattartó telefon",
      "Kapcsolattartó e-mail",
    ]);
  });
});

describe("partnerListSubtitle", () => {
  it("says the code and the settlement, not the name again", () => {
    assert.equal(partnerListSubtitle(partner), "FANK · Budapest");
    assert.equal(partnerListSubtitle({ ...partner, city: undefined }), "FANK");
  });
});

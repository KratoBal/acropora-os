import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { partnerWorksheetLink } from "./partner-portal-link.js";

describe("a munkalap linkje a partner-portalon", () => {
  it("a PARTNER_URL alapjan epiti fel az utvonalat", () => {
    assert.equal(
      partnerWorksheetLink({
        partnerUrl: "https://ticket.acropora.hu",
        worksheetId: "worksheet-1",
      }),
      "https://ticket.acropora.hu/munkalapok/worksheet-1",
    );
  });

  it("a zaro perjelet levagja, ne kettozodjon", () => {
    assert.equal(
      partnerWorksheetLink({
        partnerUrl: "https://ticket.acropora.hu/",
        worksheetId: "worksheet-1",
      }),
      "https://ticket.acropora.hu/munkalapok/worksheet-1",
    );
  });

  it("hianyzo PARTNER_URL eseten ures stringet ad, nem dob", () => {
    assert.equal(
      partnerWorksheetLink({
        partnerUrl: undefined,
        worksheetId: "worksheet-1",
      }),
      "",
    );
  });

  it("ures PARTNER_URL (csak szokoz) is uresnek szamit", () => {
    assert.equal(
      partnerWorksheetLink({ partnerUrl: "   ", worksheetId: "worksheet-1" }),
      "",
    );
  });
});

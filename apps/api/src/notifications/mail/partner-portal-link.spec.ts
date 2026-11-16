import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partnerTicketLink,
  partnerWorksheetLink,
} from "./partner-portal-link.js";

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

describe("a hibajegy linkje a partner-portalon", () => {
  it("a PARTNER_URL alapjan epiti fel az utvonalat, a zaro perjelt levagja", () => {
    for (const partnerUrl of [
      "https://ticket.acropora.hu",
      "https://ticket.acropora.hu//",
    ])
      assert.equal(
        partnerTicketLink({ partnerUrl, serviceJobId: "job-1" }),
        "https://ticket.acropora.hu/hibajegyek/job-1",
      );
  });

  it("hianyzo vagy csak szokozbol allo PARTNER_URL eseten ures stringet ad, nem dob", () => {
    for (const partnerUrl of [undefined, "", "   "])
      assert.equal(
        partnerTicketLink({ partnerUrl, serviceJobId: "job-1" }),
        "",
      );
  });

  it("a hibajegy utvonala nem a munkalape", () => {
    assert.notEqual(
      partnerTicketLink({ partnerUrl: "https://t.hu", serviceJobId: "x" }),
      partnerWorksheetLink({ partnerUrl: "https://t.hu", worksheetId: "x" }),
    );
  });
});

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

  /*
    A KARBANTARTÁSI LAP A PARTNER PORTÁLON KÜLÖN MENÜPONT (Luca, 2026-11-18 14:50 UTC; acrobot 55980): a link a lap fajtája szerinti útvonalra mutat; fajta nélkül hibajegy (a régi hívók).
    MI PIROSÍT: ha a karbantartás linkje a hibajegyek alá mutat; ha a fajta nélküli hívás útvonala megváltozik.
  */
  it("karbantartási lapnál a /karbantartas útvonalra mutat, fajta nélkül és hibajegynél a /hibajegyek-re", () => {
    const base = {
      partnerUrl: "https://ticket.acropora.hu",
      serviceJobId: "job-1",
    };
    assert.equal(
      partnerTicketLink({ ...base, kind: "MAINTENANCE" }),
      "https://ticket.acropora.hu/karbantartas/job-1",
    );
    assert.equal(
      partnerTicketLink({ ...base, kind: "REPAIR" }),
      "https://ticket.acropora.hu/hibajegyek/job-1",
    );
    assert.equal(
      partnerTicketLink(base),
      "https://ticket.acropora.hu/hibajegyek/job-1",
    );
  });

  it("a hibajegy utvonala nem a munkalape", () => {
    assert.notEqual(
      partnerTicketLink({ partnerUrl: "https://t.hu", serviceJobId: "x" }),
      partnerWorksheetLink({ partnerUrl: "https://t.hu", worksheetId: "x" }),
    );
  });
});

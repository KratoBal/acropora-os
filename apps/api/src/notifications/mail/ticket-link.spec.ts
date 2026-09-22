import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { internalTicketLink } from "./ticket-link.js";

describe("a hibajegy belso linkje", () => {
  it("a WEB_URL alapjan epiti fel az utvonalat", () => {
    assert.equal(
      internalTicketLink({
        webUrl: "https://os.acropora.hu",
        serviceJobId: "job-1",
      }),
      "https://os.acropora.hu/szerviz/hibajegyek/job-1",
    );
  });

  it("a zaro perjelet levagja, ne kettozodjon", () => {
    assert.equal(
      internalTicketLink({
        webUrl: "https://os.acropora.hu/",
        serviceJobId: "job-1",
      }),
      "https://os.acropora.hu/szerviz/hibajegyek/job-1",
    );
  });

  /*
    EZ AZ ALLITAS A KIKOTES: hianyzo WEB_URL eseten URES STRING jon, NEM hiba
    -- a hivo ezt a `renderMailTemplate` ervenyes ertekekent kezeli, tehat a
    kuldes nem all meg.
  */
  it("hianyzo WEB_URL eseten ures stringet ad, nem dob", () => {
    assert.equal(
      internalTicketLink({ webUrl: undefined, serviceJobId: "job-1" }),
      "",
    );
  });

  it("ures WEB_URL (csak szokoz) is uresnek szamit", () => {
    assert.equal(
      internalTicketLink({ webUrl: "   ", serviceJobId: "job-1" }),
      "",
    );
  });
});

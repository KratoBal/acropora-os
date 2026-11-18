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

  /*
    A KARBANTARTASI LAP LINKJE A KARBANTARTAS ALATT ALL (Balazs, 2026-11-18; acrobot 55785): a levelben a link nem hibajegyre mutat. MI PIROSIT:
    ha egy MAINTENANCE jegy linkje a hibajegyek utvonalara megy; ha a hibajegy (vagy a fajta nelkuli hivas) elveszti a sajatjat.
  */
  it("a karbantartasi lap a karbantartas utvonalra mutat, a hibajegy es a fajta nelkuli hivas a hibajegyekre", () => {
    const webUrl = "https://os.acropora.hu";
    assert.equal(
      internalTicketLink({
        webUrl,
        serviceJobId: "job-1",
        kind: "MAINTENANCE",
      }),
      "https://os.acropora.hu/szerviz/karbantartas/job-1",
    );
    assert.equal(
      internalTicketLink({ webUrl, serviceJobId: "job-1", kind: "REPAIR" }),
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

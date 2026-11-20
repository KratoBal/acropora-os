import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { autoTicketDecision, autoTicketNote } from "./worksheet-auto-ticket.js";

describe("worksheet-auto-ticket", () => {
  it("a jegy nélküli, KT-hoz nem kötött lapra nyit; a meglévő jegy és a KT-hivatkozás nem nyit", () => {
    assert.deepEqual(
      [
        autoTicketDecision({ serviceJobId: null, linkedJobId: null }),
        autoTicketDecision({ serviceJobId: "job-1", linkedJobId: null }),
        autoTicketDecision({ serviceJobId: null, linkedJobId: "kt-1" }),
        // a KT alatt álló lapnak saját jegye van: az elsőbbséget a jegy kapja
        autoTicketDecision({ serviceJobId: "kt-1", linkedJobId: "kt-2" }),
      ],
      ["open", "has-ticket", "maintenance-link", "has-ticket"],
    );
  });

  it("a naplósor megnevezi a lapot és a lépést", () => {
    assert.deepEqual(
      [
        autoTicketNote("sign", "FANK-BIO-2026-0012"),
        autoTicketNote("send", "szám nélküli munkalap"),
      ],
      [
        "Automatikusan a munkalapból (FANK-BIO-2026-0012), aláíráskor.",
        "Automatikusan a munkalapból (szám nélküli munkalap), aláírásra küldéskor.",
      ],
    );
  });
});

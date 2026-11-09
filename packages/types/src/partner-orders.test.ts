import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PARTNER_ORDER_BACKLOG_DAYS_DEFAULT,
  PARTNER_ORDER_CHAIN_FILTERS,
  PARTNER_ORDER_DOCUMENT_STEPS,
  partnerOrderBacklog,
  partnerOrderMatchesChainFilter,
  type PartnerOrderChain,
} from "./partner-orders.js";

/*
  A LANC SZERINTI SZURO (S4, 38caeac2; a barracuda megjegyzese utan szamlalo-alapu). MI PIROSIT: ha a reszben
  alairt tobb-TIG-es megrendeles kimaradna az "alairasra var" szurobol (a kizaro felosztas ezt tette); ha az alairt
  peldany szamlalasa a TIG-et megelozne; ha a teljesen szamlazott megrendeles "szamlazasra var" maradna; ha a kezzel
  csatolt alairt TIG, TIG-darabszam nelkul, "nincs TIG"-nek latszana.
*/
const chain = (over: Partial<PartnerOrderChain> = {}): PartnerOrderChain => ({
  ...(Object.fromEntries(
    PARTNER_ORDER_DOCUMENT_STEPS.map((step) => [step, 0]),
  ) as PartnerOrderChain),
  ...over,
});

const matches = (c: PartnerOrderChain) =>
  PARTNER_ORDER_CHAIN_FILTERS.filter((filter) =>
    partnerOrderMatchesChainFilter(c, filter),
  );

describe("the chain filter", () => {
  it("an empty chain has no order form and no completion", () => {
    assert.deepEqual(matches(chain()), ["NO_ORDER_FORM", "NO_COMPLETION"]);
  });

  it("a TIG waits for its signature, a signed TIG for its invoice, an invoice closes the chain", () => {
    assert.deepEqual(matches(chain({ COMPLETION: 1 })), [
      "NO_ORDER_FORM",
      "AWAITING_SIGNATURE",
    ]);
    assert.deepEqual(matches(chain({ COMPLETION: 1, SIGNED_COMPLETION: 1 })), [
      "NO_ORDER_FORM",
      "AWAITING_INVOICE",
    ]);
    assert.deepEqual(
      matches(
        chain({
          SIGNED_ORDER_FORM: 1,
          COMPLETION: 1,
          SIGNED_COMPLETION: 1,
          INVOICE: 1,
        }),
      ),
      ["INVOICED"],
    );
  });

  // the case the exclusive stages hid: part completions, one signed, a later one not
  it("two TIGs with one signed copy: still waiting for a signature, and the signed one waits for its invoice", () => {
    assert.deepEqual(
      matches(
        chain({ SIGNED_ORDER_FORM: 1, COMPLETION: 2, SIGNED_COMPLETION: 1 }),
      ),
      ["AWAITING_SIGNATURE", "AWAITING_INVOICE"],
    );
  });

  it("two signed TIGs with one invoice: still waiting for the second invoice, and invoiced", () => {
    assert.deepEqual(
      matches(
        chain({
          SIGNED_ORDER_FORM: 1,
          COMPLETION: 2,
          SIGNED_COMPLETION: 2,
          INVOICE: 1,
        }),
      ),
      ["AWAITING_INVOICE", "INVOICED"],
    );
  });

  it("a signed TIG attached by hand, with no TIG counted, waits for its invoice, not for a completion", () => {
    assert.deepEqual(matches(chain({ SIGNED_COMPLETION: 1 })), [
      "NO_ORDER_FORM",
      "AWAITING_INVOICE",
    ]);
  });

  it("the order form is its own question: having it does not move the TIG stages", () => {
    assert.deepEqual(matches(chain({ SIGNED_ORDER_FORM: 2 })), [
      "NO_COMPLETION",
    ]);
  });

  it("a fully signed and invoiced chain waits for nothing", () => {
    for (const n of [1, 2, 3])
      assert.deepEqual(
        matches(
          chain({
            SIGNED_ORDER_FORM: 1,
            COMPLETION: n,
            SIGNED_COMPLETION: n,
            INVOICE: n,
          }),
        ),
        ["INVOICED"],
        String(n),
      );
  });
});

/*
  A HATRALEKOS MEGRENDELES (S4b, 38caeac2; Luca: nyitott + teljesitetlen tetel + legalabb N nap mozgas nelkul, a 0 is
  ervenyes). MI PIROSIT: ha a hatar egy ora ertekkel elcsuszik (N nap = N x 24 ora, nem naptari nap); ha a 0 napos kuszob
  nem teszi azonnal hatralekossa a nyitott, teljesitetlen megrendelest; ha a lemondott, teljesitett vagy szamlazott
  megrendeles hatralekos lehet; ha a teljesen igazolt (nincs nyitott tetel) megrendeles az; ha a jovobeli mozgas
  negativ nap-szamot ad.
*/
describe("the backlog rule", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date("2026-11-20T12:00:00Z");
  const base = {
    status: "OPEN" as const,
    openLines: 2,
    lastMovementAt: new Date(now.getTime() - 14 * DAY),
    now,
    backlogDays: 14,
  };

  it("the default is fourteen days", () => {
    assert.equal(PARTNER_ORDER_BACKLOG_DAYS_DEFAULT, 14);
  });

  it("is back-ordered exactly at N x 24 hours, not a minute before", () => {
    assert.deepEqual(partnerOrderBacklog(base), {
      backlog: true,
      idleDays: 14,
    });
    assert.equal(
      partnerOrderBacklog({
        ...base,
        lastMovementAt: new Date(now.getTime() - 14 * DAY + 60_000),
      }).backlog,
      false,
    );
    assert.equal(
      partnerOrderBacklog({
        ...base,
        lastMovementAt: new Date(now.getTime() - 14 * DAY + 60_000),
      }).idleDays,
      13,
    );
  });

  it("zero days is valid: an open order with an open line is back-ordered at once", () => {
    assert.equal(
      partnerOrderBacklog({ ...base, backlogDays: 0, lastMovementAt: now })
        .backlog,
      true,
    );
  });

  it("only an OPEN order with an open line can be back-ordered", () => {
    for (const status of ["COMPLETED", "INVOICED", "CANCELLED"] as const)
      assert.equal(
        partnerOrderBacklog({ ...base, status }).backlog,
        false,
        status,
      );
    assert.equal(partnerOrderBacklog({ ...base, openLines: 0 }).backlog, false);
  });

  it("a movement in the future counts as no idle time, never a negative number of days", () => {
    const result = partnerOrderBacklog({
      ...base,
      lastMovementAt: new Date(now.getTime() + 5 * DAY),
    });
    assert.deepEqual(result, { backlog: false, idleDays: 0 });
    assert.equal(
      partnerOrderBacklog({
        ...base,
        backlogDays: 0,
        lastMovementAt: new Date(now.getTime() + 5 * DAY),
      }).backlog,
      true,
    );
  });
});

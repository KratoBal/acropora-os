import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PARTNER_ORDER_CHAIN_FILTERS,
  PARTNER_ORDER_DOCUMENT_STEPS,
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

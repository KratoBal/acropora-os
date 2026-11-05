import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PARTNER_ORDER_CHAIN_FILTERS,
  PARTNER_ORDER_DOCUMENT_STEPS,
  partnerOrderMatchesChainFilter,
  type PartnerOrderChain,
} from "./partner-orders.js";

/*
  A LANC SZERINTI SZURO (S4, 38caeac2). MI PIROSIT: ha egy megrendeles a "hol tart" negy utolso szuroje
  KOZUL egyszerre kettoben is (vagy egyben sem) allna; ha az alairt TIG a TIG szamlalo nelkul (kezzel csatolt
  alairt peldany) "nincs TIG"-nek latszana; ha a szamlazott megrendeles a "szamlara var" szuroben maradna.
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

  // every chain sits in exactly one of the four stages that follow each other
  it("exactly one of NO_COMPLETION, AWAITING_SIGNATURE, AWAITING_INVOICE, INVOICED holds, for every combination", () => {
    const stages = [
      "NO_COMPLETION",
      "AWAITING_SIGNATURE",
      "AWAITING_INVOICE",
      "INVOICED",
    ] as const;
    for (const completion of [0, 1])
      for (const signed of [0, 1])
        for (const invoice of [0, 1]) {
          const held = stages.filter((stage) =>
            partnerOrderMatchesChainFilter(
              chain({
                COMPLETION: completion,
                SIGNED_COMPLETION: signed,
                INVOICE: invoice,
              }),
              stage,
            ),
          );
          assert.equal(held.length, 1, `${completion}/${signed}/${invoice}`);
        }
  });
});

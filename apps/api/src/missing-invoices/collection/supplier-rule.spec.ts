import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "../missing-invoice-matching.js";
import {
  OUTLIER_FACTOR,
  amountlessAccepted,
  decideSupplierRule,
  grossCentsOf,
  nameKeyOf,
  raisedCeilings,
  supplierRulesLive,
  taxMatchKey,
  textHasNameKey,
  trustedForwarderDomains,
  type RuleDocument,
  type SupplierRule,
} from "./supplier-rule.js";

/*
  AZ ISMERT SZÁLLÍTÓ SZABÁLYA (acrobot 57881, 57884). MI PIROSÍT: ha egy másik szállító adószáma vagy egy másik tartomány is
  elfogadódik; ha a név egyedül (feladó nélkül, vagy csak továbbítóval) elfogad; ha a kiugró vagy új pénznemű összeg átmegy;
  ha az összeg nélküli PDF elfogad (alapból emberre marad); ha a nem a cégre szóló PDF elfogad; ha a kapcsoló hiányában fut.
*/
const norm = normalizeName;
const TRUSTED = ["acroporahu"];

const taxRule = (over: Partial<SupplierRule> = {}): SupplierRule => ({
  id: "rule-tax",
  kind: "TAX",
  taxKey: "DE123456789",
  nameKey: null,
  senderDomain: "hetznerde",
  grossCeilings: { EUR: 5000 },
  ...over,
});
const nameRule = (over: Partial<SupplierRule> = {}): SupplierRule => ({
  id: "rule-name",
  kind: "NAME",
  taxKey: null,
  nameKey: "tessie",
  senderDomain: "tessiecom",
  grossCeilings: { USD: 1000 },
  ...over,
});
const doc = (over: Partial<RuleDocument> = {}): RuleDocument => ({
  taxNumber: "DE 123 456 789",
  senderDomain: "hetznerde",
  text: "Hetzner Online GmbH Rechnung Total 49.50 EUR",
  gross: "49.50",
  currency: "EUR",
  payee: "COMPANY",
  ...over,
});
const decide = (
  rules: SupplierRule[],
  document: RuleDocument,
  amountless = false,
) =>
  decideSupplierRule({
    rules,
    document,
    trustedDomains: TRUSTED,
    normalizeName: norm,
    amountless,
  });

describe("the keys", () => {
  it("the tax key is letters and digits only, and a Hungarian number is its eight-digit base", () => {
    assert.equal(taxMatchKey("DE 123.456-789"), "DE123456789");
    assert.equal(taxMatchKey("12345678-2-42"), "HU12345678");
    assert.equal(taxMatchKey("HU12345678"), "HU12345678");
    assert.equal(taxMatchKey("12345678"), "HU12345678");
    assert.equal(taxMatchKey("AB12"), null);
    assert.equal(taxMatchKey(null), null);
  });

  it("the name key is the distinctive words, and a name made of generic words is no key", () => {
    assert.equal(nameKeyOf("Tessie Inc.", norm), "tessie");
    assert.equal(nameKeyOf("Global Trade Group", norm), null);
    // a three-letter abbreviation is a key when it is typed (GLS: the words of its full name are all generic)
    assert.equal(nameKeyOf("GLS", norm), "gls");
    assert.equal(nameKeyOf("an", norm), null);
    assert.equal(
      textHasNameKey("Invoice from Tessie Inc", "tessie", norm),
      true,
    );
    // a whole word: "tessieland" is not "tessie"
    assert.equal(
      textHasNameKey("Welcome to Tessieland", "tessie", norm),
      false,
    );
  });

  it("the gross reads cents from a point or a comma and refuses what it cannot read", () => {
    assert.equal(grossCentsOf("49.5"), 4950);
    assert.equal(grossCentsOf("-49,50"), 4950);
    assert.equal(grossCentsOf("1 234"), null);
    assert.equal(grossCentsOf(null), null);
  });

  it("the trusted forwarders are the collected mailboxes' domains plus the configured ones", () => {
    assert.deepEqual(
      trustedForwarderDomains(["info@acropora.hu", "balazs@acropora.hu"], {
        INVOICE_SUPPLIER_RULE_TRUSTED_DOMAINS: "Partner.EU",
      }),
      ["acroporahu", "partnereu"],
    );
  });

  it("the switches are off unless set to exactly live / accept", () => {
    assert.equal(supplierRulesLive({}), false);
    assert.equal(supplierRulesLive({ INVOICE_SUPPLIER_RULES: "on" }), false);
    assert.equal(supplierRulesLive({ INVOICE_SUPPLIER_RULES: "live" }), true);
    assert.equal(amountlessAccepted({}), false);
    assert.equal(
      amountlessAccepted({ INVOICE_SUPPLIER_RULES_AMOUNTLESS: "accept" }),
      true,
    );
  });
});

describe("a TAX rule", () => {
  it("accepts the same tax number from the same sender, in the amount range", () => {
    const decision = decide([taxRule()], doc());
    assert.equal(decision.accept, true);
    if (decision.accept) {
      assert.deepEqual(
        [decision.rule.id, decision.grossCents, decision.currency],
        ["rule-tax", 4950, "EUR"],
      );
    }
  });

  it("does not accept another supplier's tax number, or a document without one", () => {
    assert.deepEqual(decide([taxRule()], doc({ taxNumber: "DE999999999" })), {
      accept: false,
      reason: "NO_RULE",
    });
    assert.equal(decide([taxRule()], doc({ taxNumber: null })).accept, false);
  });

  it("does not accept the same tax number from another external domain", () => {
    const decision = decide([taxRule()], doc({ senderDomain: "evilcom" }));
    assert.equal(decision.accept, false);
    if (!decision.accept) assert.equal(decision.reason, "SENDER_MISMATCH");
  });

  it("a rule made from a trusted forwarder has no sender: it takes the forwarder's PDF and a vendor's own PDF", () => {
    const rule = taxRule({ senderDomain: null });
    assert.equal(
      decide([rule], doc({ senderDomain: "acroporahu" })).accept,
      true,
    );
    assert.equal(
      decide([rule], doc({ senderDomain: "hetznerde" })).accept,
      true,
    );
  });

  it("a rule with an external sender also takes the same PDF through a trusted forwarder", () => {
    assert.equal(
      decide([taxRule()], doc({ senderDomain: "acroporahu" })).accept,
      true,
    );
  });
});

describe("a NAME rule", () => {
  const tessie = (over: Partial<RuleDocument> = {}) =>
    doc({
      taxNumber: null,
      senderDomain: "tessiecom",
      text: "Tessie Inc. Receipt",
      gross: "8.00",
      currency: "USD",
      ...over,
    });

  it("accepts the name in the text from the rule's sender", () => {
    assert.equal(decide([nameRule()], tessie()).accept, true);
  });

  it("does not accept the name from another sender", () => {
    const decision = decide([nameRule()], tessie({ senderDomain: "otherde" }));
    assert.equal(decision.accept, false);
    if (!decision.accept) assert.equal(decision.reason, "SENDER_MISMATCH");
  });

  it("does not accept the name through a trusted forwarder: a name alone is no key", () => {
    const decision = decide(
      [nameRule()],
      tessie({ senderDomain: "acroporahu" }),
    );
    assert.equal(decision.accept, false);
    if (!decision.accept)
      assert.equal(decision.reason, "UNTRUSTED_NAME_SENDER");
  });

  it("does not accept when the name is not in the text", () => {
    assert.equal(
      decide([nameRule()], tessie({ text: "Receipt from somebody else" }))
        .accept,
      false,
    );
  });
});

describe("the amount", () => {
  it("an outlier waits for a person: more than the factor times the biggest accepted", () => {
    const edge = ((5000 * OUTLIER_FACTOR) / 100).toFixed(2);
    assert.equal(decide([taxRule()], doc({ gross: edge })).accept, true);
    const decision = decide(
      [taxRule()],
      doc({ gross: ((5000 * OUTLIER_FACTOR + 1) / 100).toFixed(2) }),
    );
    assert.equal(decision.accept, false);
    if (!decision.accept) assert.equal(decision.reason, "OUTLIER");
  });

  it("a currency the rule has not seen waits for a person", () => {
    const decision = decide([taxRule()], doc({ currency: "USD" }));
    assert.equal(decision.accept, false);
    if (!decision.accept) assert.equal(decision.reason, "NEW_CURRENCY");
  });

  it("an unreadable amount waits for a person by default, and is accepted without an amount only when allowed", () => {
    const noAmount = doc({ gross: null, currency: null });
    const refused = decide([taxRule()], noAmount);
    assert.equal(refused.accept, false);
    if (!refused.accept) assert.equal(refused.reason, "NO_AMOUNT");
    const allowed = decide([taxRule()], noAmount, true);
    assert.equal(allowed.accept, true);
    if (allowed.accept) assert.equal(allowed.grossCents, null);
  });

  it("a credit-sign gross counts by its size", () => {
    assert.equal(decide([taxRule()], doc({ gross: "-49.50" })).accept, true);
  });

  it("the ceiling only rises", () => {
    assert.deepEqual(raisedCeilings({ EUR: 5000 }, "EUR", 4000), { EUR: 5000 });
    assert.deepEqual(raisedCeilings({ EUR: 5000 }, "EUR", 7000), { EUR: 7000 });
    assert.deepEqual(raisedCeilings({ EUR: 5000 }, "USD", 100), {
      EUR: 5000,
      USD: 100,
    });
    assert.deepEqual(raisedCeilings({ EUR: 5000 }, "EUR", null), { EUR: 5000 });
  });
});

describe("what never passes", () => {
  it("a document not addressed to the company is not accepted by any rule", () => {
    const decision = decide([taxRule()], doc({ payee: "NOT_COMPANY" }));
    assert.deepEqual(decision, { accept: false, reason: "NOT_COMPANY" });
  });

  it("with no rules nothing is accepted", () => {
    assert.deepEqual(decide([], doc()), { accept: false, reason: "NO_RULE" });
  });
});

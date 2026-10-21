import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IncomingReadingValues } from "@acropora/types";

import {
  autoApproval,
  navFilledFields,
  sameSupplierName,
  type NavConfirmation,
} from "./auto-approval.js";
import { formatAutoApprove } from "./incoming-auto-approve.cli.js";
import { approvalProblems } from "./incoming-review.service.js";

/**
 * AZ AUTOMATIKUS JÓVÁHAGYÁS DÖNTÉSE (acrobot 34633, 34636). Kitalált számok, az
 * éles alakban: egy magyar szállító olvasata a NAV-sorral, és egy külföldi
 * előfizetés a terhelésével. MI PIROSÍT: ha egy NAV-tól eltérő összeg, egy másik
 * szállító ugyanilyen számú NAV-sora, egy párosításból jött bruttó, egy más
 * devizájú terhelés közölt összeg nélkül, vagy egy adószám nélküli sor
 * jóváhagyódik; vagy ha a NAV a meglévő kiolvasott értéket felülírja.
 */
const EMPTY: IncomingReadingValues = {
  supplierName: null,
  supplierTaxNumber: null,
  supplierEuTaxNumber: null,
  documentNumber: null,
  issueDate: null,
  fulfillmentDate: null,
  dueDate: null,
  currency: null,
  netAmount: null,
  vatAmount: null,
  grossAmount: null,
};
const HU: IncomingReadingValues = {
  ...EMPTY,
  supplierTaxNumber: "12805637-2-13",
  documentNumber: "KS26/12106",
  grossAmount: "212070.00",
  currency: "HUF",
};
const NAV: NavConfirmation = {
  navInvoiceNumber: "KS26/12106",
  supplierTaxNumber: "12805637",
  supplierName: "Kitalált Medencetechnika Kft.",
  invoiceIssueDate: "2026-10-13",
  invoiceDeliveryDate: "2026-10-12",
  currency: "HUF",
  netAmount: "166984.25",
  vatAmount: "45085.75",
  operation: "CREATE",
  originalInvoiceNumber: null,
};
const FOREIGN: IncomingReadingValues = {
  ...EMPTY,
  supplierName: "Kitalált Előfizetés Ltd.",
  supplierEuTaxNumber: "IE9999999XX",
  documentNumber: "KIT-0006",
  issueDate: "2026-09-19",
  currency: "HUF",
  netAmount: "15900.00",
  vatAmount: "0.00",
  grossAmount: "15900.00",
};
const decide = (over: Partial<Parameters<typeof autoApproval>[0]>) =>
  autoApproval({
    values: HU,
    kind: "INVOICE",
    sources: { grossAmount: "TEXT" },
    debits: [],
    nav: [NAV],
    problems: approvalProblems,
    ...over,
  });

describe("automatic approval", () => {
  it("NAV: a cancelled or modified invoice is not approved; another number's cancellation is no obstacle (barracuda #1790)", () => {
    const storno: NavConfirmation = {
      ...NAV,
      navInvoiceNumber: "KS26/12999",
      operation: "STORNO",
      originalInvoiceNumber: "KS26/12106",
    };
    const reason =
      "a NAV-ban módosítás vagy sztornó hivatkozik rá: kézi döntés";
    assert.deepEqual(decide({ nav: [NAV, storno] }), {
      approve: false,
      reason,
    });
    assert.deepEqual(
      decide({ nav: [NAV, { ...storno, operation: "MODIFY" }] }),
      { approve: false, reason },
    );
    assert.equal(
      decide({ nav: [NAV, { ...storno, originalInvoiceNumber: "KS26/11111" }] })
        .approve,
      true,
    );
  });

  it("a pro forma is never approved by itself, even fully read and paid exactly (barracuda #1790)", () => {
    const result = decide({
      values: FOREIGN,
      kind: "PROFORMA",
      debits: [{ amount: "-15900", currency: "HUF" }],
    });
    assert.deepEqual(result, {
      approve: false,
      reason: "díjbekérő vagy nem számla: kézi döntés",
    });
  });

  it("NAV: a Hungarian reading the NAV confirms is approved, the missing fields filled from the NAV and marked so", () => {
    const result = decide({});
    assert.equal(result.approve, true);
    if (!result.approve) return;
    assert.equal(result.basis, "NAV");
    assert.deepEqual(
      [
        result.values.supplierName,
        result.values.issueDate,
        result.values.netAmount,
        result.values.vatAmount,
        result.values.grossAmount,
      ],
      [
        "Kitalált Medencetechnika Kft.",
        "2026-10-13",
        "166984.25",
        "45085.75",
        "212070.00",
      ],
    );
    // what was read stays read; only the empty fields are the NAV's
    assert.equal(result.sources.grossAmount, "TEXT");
    assert.deepEqual(navFilledFields(result.sources).sort(), [
      "fulfillmentDate",
      "issueDate",
      "netAmount",
      "supplierName",
      "vatAmount",
    ]);
  });

  it("NAV: the supplier name is the NAV's when the read one agrees in substance, and a differing read name keeps the row for a person", () => {
    // egyező, de más alakú név (cégforma-szó, ékezet, kisbetű): a NAV neve lesz, NAV forrásjellel
    const same = decide({
      values: {
        ...HU,
        supplierName: "kitalalt MEDENCETECHNIKA Korlátolt Felelősségű Társaság",
      },
      sources: { grossAmount: "TEXT", supplierName: "TEXT" },
    });
    assert.equal(same.approve, true);
    if (!same.approve) return;
    assert.equal(same.values.supplierName, "Kitalált Medencetechnika Kft.");
    assert.equal(same.sources.supplierName, "NAV");
    // más cég neve (pl. a szövegből rosszul olvasott név): átnézésre marad, a figyelmeztetés megnevezi
    const other = decide({
      values: { ...HU, supplierName: "Kitalált Másik Szolgáltató Zrt." },
      sources: { grossAmount: "TEXT", supplierName: "TEXT" },
    });
    assert.equal(other.approve, false);
    if (other.approve) return;
    assert.match(other.reason, /a kiolvasott szállítónév .* eltér a NAV-tól/);
    // az egyik a másik része (kiegészített vagy rövidített név): egyezik, és a név a NAV-é lesz
    for (const read of [
      "Kitalált Medencetechnika Magyarország Kft.",
      "Kitalált Medencetechnika",
    ]) {
      const part = decide({ values: { ...HU, supplierName: read } });
      assert.equal(part.approve, true, read);
      if (part.approve)
        assert.equal(part.values.supplierName, "Kitalált Medencetechnika Kft.");
    }
    // üres név: a NAV tölti, ahogy eddig
    assert.equal(decide({}).approve, true);
  });

  it("the name comparison: legal words, accents and case do not count; a different company does", () => {
    assert.ok(
      sameSupplierName(
        "Elektro-Light Kft.",
        "ELEKTRO LIGHT Korlátolt Felelősségű Társaság",
      ),
    );
    assert.ok(
      sameSupplierName("Elektro-Light", "Elektro-Light Magyarország Zrt."),
    );
    assert.ok(!sameSupplierName("Elektro-Light Kft.", "Elektro-Dark Kft."));
    assert.ok(!sameSupplierName("Kft.", "Kft."));
    assert.ok(!sameSupplierName("", "Elektro-Light"));
    assert.ok(!sameSupplierName("Alfa Béta Kft.", "Gamma Delta Kft."));
  });

  it("NAV: a gross that differs from the NAV, another supplier's invoice of the same number, or no NAV row is not approved", () => {
    const differs = decide({ values: { ...HU, grossAmount: "212080.00" } });
    assert.deepEqual(differs, {
      approve: false,
      reason: "a kiolvasott bruttó (212080.00) eltér a NAV-tól (212070.00)",
    });
    const otherSupplier = decide({
      nav: [{ ...NAV, supplierTaxNumber: "99999999" }],
    });
    assert.equal(otherSupplier.approve, false);
    assert.equal(decide({ nav: [] }).approve, false);
    // a forint off is within the NAV tolerance, but then the NAV's net and VAT do not give the read gross:
    // the manual approval's own sum check stops it, as it would stop a person
    assert.deepEqual(decide({ values: { ...HU, grossAmount: "212071.00" } }), {
      approve: false,
      reason: "A nettó és az ÁFA összege nem adja ki a bruttót.",
    });
  });

  it("BANK: a complete foreign reading whose gross the debits pay exactly is approved", () => {
    const result = decide({
      values: FOREIGN,
      sources: { grossAmount: "TEXT" },
      debits: [{ amount: "-15900", currency: "HUF" }],
    });
    assert.deepEqual(
      [result.approve, result.approve && result.basis],
      [true, "BANK"],
    );
  });

  it("BANK: in a currency, the amount the bank stated for a forint debit counts; without it, not approved", () => {
    const eur = {
      ...FOREIGN,
      currency: "EUR",
      netAmount: "1703.08",
      grossAmount: "1703.08",
    };
    const stated = decide({
      values: eur,
      debits: [
        {
          amount: "-628062",
          currency: "HUF",
          original: { amount: "1703.08", currency: "EUR" },
        },
      ],
    });
    assert.equal(stated.approve, true);
    const unstated = decide({
      values: eur,
      debits: [{ amount: "-628062", currency: "HUF", original: null }],
    });
    assert.deepEqual(unstated, {
      approve: false,
      reason: "a terhelés devizája nem EUR, és a bank nem közölt EUR összeget",
    });
  });

  it("BANK: a gross taken from the pairing is not measured against the debit it came from", () => {
    const debits = [{ amount: "-15900", currency: "HUF" }];
    assert.deepEqual(
      decide({ values: FOREIGN, sources: { grossAmount: "PAIRING" }, debits }),
      {
        approve: false,
        reason:
          "a bruttó a banki párosításból jön, nem a számláról: önmagához mérné",
      },
    );
  });

  it("BANK: not approved when the debit differs, when a field is missing, or with no debit", () => {
    const debits = [{ amount: "-15900", currency: "HUF" }];
    assert.equal(
      decide({
        values: FOREIGN,
        debits: [{ amount: "-15902", currency: "HUF" }],
      }).approve,
      false,
    );
    assert.equal(
      decide({ values: { ...FOREIGN, vatAmount: null }, debits }).approve,
      false,
    );
    assert.equal(decide({ values: FOREIGN, debits: [] }).approve, false);
  });

  it("no tax number at all: neither basis approves", () => {
    const debits = [{ amount: "-15900", currency: "HUF" }];
    assert.deepEqual(
      decide({ values: { ...FOREIGN, supplierEuTaxNumber: null }, debits }),
      {
        approve: false,
        reason:
          "nincs adószám: sem magyar (NAV), sem külföldi (banki) alapon nem hagyható jóvá",
      },
    );
  });

  it("the command's report: one line per row, what would go and why the rest stays", () => {
    const text = formatAutoApprove(
      {
        considered: 2,
        approvable: 1,
        approved: 0,
        failed: 0,
        rows: [
          {
            documentId: "d1",
            number: "KIT-0006",
            supplier: "Kitalált Ltd.",
            gross: "15900.00 HUF",
            basis: "BANK",
            reason: null,
            written: false,
          },
          {
            documentId: "d2",
            number: "KIT-0007",
            supplier: "Kitalált Ltd.",
            gross: "15900.00 HUF",
            basis: null,
            reason: "nincs párosított terhelés",
            written: false,
          },
        ],
      },
      false,
    );
    assert.match(text, /^mód: csak olvas\n/);
    assert.match(
      text,
      /\njóváhagyná\tKIT-0006\tKitalált Ltd\.\t15900\.00 HUF\td1\tBANK\n/,
    );
    assert.match(
      text,
      /\nmarad\tKIT-0007\tKitalált Ltd\.\t15900\.00 HUF\td2\tnincs párosított terhelés\n/,
    );
  });
});

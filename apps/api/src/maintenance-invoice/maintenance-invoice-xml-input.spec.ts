import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  maintenanceInvoiceXmlInputFrom,
  MaintenanceInvoiceInputError,
  type MaintenanceInvoiceCertificateSource,
} from "./maintenance-invoice-xml-input.js";

const baseCertificate: MaintenanceInvoiceCertificateSource = {
  number: "TIG-2026-0007",
  issuedAt: new Date("2026-09-24T00:00:00.000Z"),
  serviceJob: {
    customer: {
      id: "customer-1",
      displayName: "Fővárosi Állatkert",
      taxNumber: "12345678-2-42",
      paymentDueDays: null,
      addresses: [
        {
          line1: "Állatkerti körút 6-12.",
          line2: null,
          postalCode: "1146",
          city: "Budapest",
        },
      ],
    },
  },
  items: [
    {
      description: "Akvárium karbantartás",
      quantity: new Prisma.Decimal(3),
      unitNet: new Prisma.Decimal("233333.3333"),
      vatRatePercent: new Prisma.Decimal(27),
    },
  ],
};

describe("maintenanceInvoiceXmlInputFrom", () => {
  it("maps the certificate number to rendelesSzam (orderNumber)", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom(baseCertificate);
    assert.equal(xmlInput.orderNumber, "TIG-2026-0007");
  });

  it("maps the customer's default address into the required buyer fields", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom(baseCertificate);
    assert.equal(xmlInput.buyer.name, "Fővárosi Állatkert");
    assert.equal(xmlInput.buyer.zip, "1146");
    assert.equal(xmlInput.buyer.city, "Budapest");
    assert.equal(xmlInput.buyer.address, "Állatkerti körút 6-12.");
    assert.equal(xmlInput.buyer.taxNumber, "12345678-2-42");
  });

  it("joins line1 and line2 when both are present", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom({
      ...baseCertificate,
      serviceJob: {
        customer: {
          ...baseCertificate.serviceJob.customer,
          addresses: [
            {
              line1: "Fő utca 1.",
              line2: "2. emelet",
              postalCode: "1011",
              city: "Budapest",
            },
          ],
        },
      },
    });
    assert.equal(xmlInput.buyer.address, "Fő utca 1., 2. emelet");
  });

  it("throws NO_BILLING_ADDRESS when the customer has no default address", () => {
    assert.throws(
      () =>
        maintenanceInvoiceXmlInputFrom({
          ...baseCertificate,
          serviceJob: {
            customer: { ...baseCertificate.serviceJob.customer, addresses: [] },
          },
        }),
      (error: unknown) =>
        error instanceof MaintenanceInvoiceInputError &&
        error.code === "NO_BILLING_ADDRESS",
    );
  });

  it("throws BILLING_ADDRESS_INCOMPLETE naming each blank part, whitespace counted as blank", () => {
    const withAddress = (address: {
      line1: string;
      postalCode: string;
      city: string;
    }) => ({
      ...baseCertificate,
      serviceJob: {
        customer: {
          ...baseCertificate.serviceJob.customer,
          addresses: [{ line2: null, ...address }],
        },
      },
    });
    const missingOf = (address: {
      line1: string;
      postalCode: string;
      city: string;
    }) => {
      try {
        maintenanceInvoiceXmlInputFrom(withAddress(address));
      } catch (error) {
        assert.ok(error instanceof MaintenanceInvoiceInputError);
        assert.equal(error.code, "BILLING_ADDRESS_INCOMPLETE");
        return error.missing;
      }
      assert.fail("expected BILLING_ADDRESS_INCOMPLETE");
    };
    const full = { line1: "Fő utca 1.", postalCode: "1146", city: "Budapest" };
    assert.deepEqual(missingOf({ ...full, postalCode: "" }), ["irányítószám"]);
    assert.deepEqual(missingOf({ ...full, city: "  " }), ["város"]);
    assert.deepEqual(missingOf({ ...full, line1: "" }), ["utca, házszám"]);
    assert.deepEqual(missingOf({ line1: "", postalCode: "", city: "" }), [
      "irányítószám",
      "város",
      "utca, házszám",
    ]);
  });

  it("throws NO_ITEMS when the certificate has no line items", () => {
    assert.throws(
      () => maintenanceInvoiceXmlInputFrom({ ...baseCertificate, items: [] }),
      (error: unknown) =>
        error instanceof MaintenanceInvoiceInputError &&
        error.code === "NO_ITEMS",
    );
  });

  it("rounds each line to whole forints, and satisfies unitPrice * quantity(1) = netAmount exactly", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom(baseCertificate);
    const item = xmlInput.items[0]!;
    // 3 * 233333.3333 = 699999.9999 -> kerekítve 700000
    assert.equal(item.netAmount, 700000);
    assert.equal(item.quantity, 1);
    assert.equal(item.netUnitPrice, item.netAmount);
    assert.equal(item.netUnitPrice * item.quantity, item.netAmount);
    assert.equal(item.netAmount + item.vatAmount, item.grossAmount);
  });

  it("sums the whole-forint line amounts into totals, not the raw fractional amounts", () => {
    const { totals } = maintenanceInvoiceXmlInputFrom(baseCertificate);
    assert.equal(totals.netAmount.toNumber(), 700000);
    assert.equal(totals.vatAmount.toNumber(), 189000);
    assert.equal(totals.grossAmount.toNumber(), 889000);
  });

  it("sets fulfillmentDate from issuedAt and paymentDueDate 8 days later", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom(baseCertificate);
    assert.equal(xmlInput.fulfillmentDate, "2026-09-24");
    assert.equal(xmlInput.paymentDueDate, "2026-10-02");
  });

  /** Balazs, 2026-10-03: some partners pay in 8 days, some in 30. The term set
   * on the partner wins; the 8 days above is only what an unset one gets. */
  it("uses the partner's own payment term when it is set", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom({
      ...baseCertificate,
      serviceJob: {
        customer: {
          ...baseCertificate.serviceJob.customer,
          paymentDueDays: 30,
        },
      },
    });
    assert.equal(xmlInput.fulfillmentDate, "2026-09-24");
    assert.equal(xmlInput.paymentDueDate, "2026-10-24");
  });

  /** Zero is a real term (due on the day), not "unset": `||` would turn it
   * into 8 days. */
  it("keeps a zero-day term instead of falling back to the default", () => {
    const { xmlInput } = maintenanceInvoiceXmlInputFrom({
      ...baseCertificate,
      serviceJob: {
        customer: { ...baseCertificate.serviceJob.customer, paymentDueDays: 0 },
      },
    });
    assert.equal(xmlInput.paymentDueDate, "2026-09-24");
  });
});

/**
 * A MEGRENDELÉSES TIG SORA A SZÁMLÁN (Megrendelések S3, acrobot 42206, B). MI
 * PIROSÍT: ha a pontosan szorozható sor nem a valódi mennyiséggel és egységgel
 * megy; ha a nem pontos sor nem "1 db" a sorösszeggel, a mennyiséggel a nevében;
 * ha a szervizes (egység nélküli) sor alakja megváltozik; ha bármelyik sornál
 * az egységár × mennyiség nem a nettó.
 */
describe("a megrendeléses TIG sora a számlán", () => {
  const D = (v: string | number) => new Prisma.Decimal(v);
  const sorok = (items: MaintenanceInvoiceCertificateSource["items"]) =>
    maintenanceInvoiceXmlInputFrom({ ...baseCertificate, items }).xmlInput
      .items;

  it("pontos szorzatnál a valódi mennyiség és egység megy", () => {
    const [sor] = sorok([
      {
        description: "Üvegtisztítás",
        quantity: D("2.5"),
        unitNet: D("2000"),
        vatRatePercent: D(27),
        quantityUnit: "m2",
      },
    ]);
    assert.deepEqual(
      [sor!.name, sor!.quantity, sor!.unit, sor!.netUnitPrice, sor!.netAmount],
      ["Üvegtisztítás", 2.5, "m2", 2000, 5000],
    );
  });

  it("nem pontos szorzatnál 1 db a sorösszeggel, a mennyiség a névben", () => {
    const [sor] = sorok([
      {
        description: "Üvegtisztítás",
        quantity: D("3"),
        unitNet: D("3333.3333"),
        vatRatePercent: D(27),
        quantityUnit: "m2",
      },
    ]);
    assert.deepEqual(
      [sor!.name, sor!.quantity, sor!.unit, sor!.netUnitPrice, sor!.netAmount],
      ["Üvegtisztítás, 3 m2", 1, "db", 10000, 10000],
    );
  });

  it("a szervizes sor (egység nélkül) változatlanul 1 db", () => {
    const [sor] = sorok([
      {
        description: "Akvárium karbantartás",
        quantity: D(1),
        unitNet: D("15000"),
        vatRatePercent: D(27),
      },
    ]);
    assert.deepEqual(
      [sor!.name, sor!.quantity, sor!.unit],
      ["Akvárium karbantartás", 1, "db"],
    );
  });

  it("minden sorban az egységár × mennyiség a nettó (a Számlázz.hu azonossága)", () => {
    for (const sor of sorok([
      {
        description: "A",
        quantity: D("2.5"),
        unitNet: D("2000"),
        vatRatePercent: D(27),
        quantityUnit: "m2",
      },
      {
        description: "B",
        quantity: D("7"),
        unitNet: D("1428.5714"),
        vatRatePercent: D(27),
        quantityUnit: "db",
      },
      {
        description: "C",
        quantity: D("0.125"),
        unitNet: D("8000"),
        vatRatePercent: D(5),
        quantityUnit: "kg",
      },
      {
        description: "D",
        quantity: D(1),
        unitNet: D("15000.4"),
        vatRatePercent: D(27),
      },
    ]))
      assert.equal(
        D(sor.netUnitPrice).times(sor.quantity).toString(),
        D(sor.netAmount).toString(),
        sor.name,
      );
  });

  it("a megjegyzés a forrásé, alapból a karbantartási mondat", () => {
    assert.equal(
      maintenanceInvoiceXmlInputFrom(baseCertificate).xmlInput.comment,
      "Karbantartási teljesítési igazolás: TIG-2026-0007",
    );
    assert.equal(
      maintenanceInvoiceXmlInputFrom({
        ...baseCertificate,
        comment: "Teljesítési igazolás: TI-2026-008, megrendelés M-2026-001",
      }).xmlInput.comment,
      "Teljesítési igazolás: TI-2026-008, megrendelés M-2026-001",
    );
  });
});

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
});

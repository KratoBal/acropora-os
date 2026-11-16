import { isCardPayment, type BillingIssueSummary } from "@acropora/types";

import { issueFingerprint } from "../billing/billing-document-issue.js";
import type { MaintenanceInvoiceXmlInput } from "./maintenance-invoice-xml-input.js";

/**
 * THE TIG INVOICE'S CONFIRMATION WINDOW (card 7ba97e0d, S3), FROM THE SAME MAPPING AS ITS ISSUE: `xmlInput` is what
 * the issue sends to Számlázz.hu (`maintenanceInvoiceXmlInputFrom`), so the window cannot show one buyer while the
 * invoice carries another. The issue date proposed is today in Budapest; the fulfilment date is the certificate's, the
 * due date today plus the buyer's payment days, as the issue has always counted them. The fingerprint is the billing
 * editor's own digest of the same values, the send address included.
 */
export function maintenanceIssueSummary(
  xmlInput: MaintenanceInvoiceXmlInput["xmlInput"],
  sendAddress: string | null,
  today: string,
): BillingIssueSummary {
  const { buyer } = xmlInput;
  const email = sendAddress?.trim() || null;
  return {
    buyerName: buyer.name,
    buyerAddress: [
      [buyer.zip, buyer.city].filter(Boolean).join(" "),
      buyer.address,
    ]
      .filter(Boolean)
      .join(", "),
    buyerTaxNumber: buyer.taxNumber ?? null,
    buyerEuTaxNumber: buyer.euTaxNumber ?? null,
    buyerEmail: email,
    issueDate: today,
    fulfillmentDate: xmlInput.fulfillmentDate,
    dueDate: xmlInput.paymentDueDate,
    paymentMethod: xmlInput.paymentMethod,
    showsPaymentFields: true,
    dueDateFollowsIssueDate: isCardPayment(xmlInput.paymentMethod),
    fingerprint: issueFingerprint({
      documentType: "INVOICE",
      paymentMethod: xmlInput.paymentMethod,
      buyer: {
        name: buyer.name,
        country: buyer.country ?? null,
        zip: buyer.zip,
        city: buyer.city,
        address: buyer.address,
        taxNumber: buyer.taxNumber ?? null,
        euTaxNumber: buyer.euTaxNumber ?? null,
        email,
      },
    }),
  };
}

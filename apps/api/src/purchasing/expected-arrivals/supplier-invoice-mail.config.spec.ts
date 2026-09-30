import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeSupplierInvoiceMailState,
  supplierInvoiceMailCredentials,
  supplierInvoiceMailIntervalMinutes,
  supplierInvoiceMailQuery,
  supplierInvoiceMailSenders,
  supplierInvoiceMailSwitch,
  XML_INVOICE_SENDERS,
} from "./supplier-invoice-mail.config.js";

const key = (prefix: string) => ({
  [`${prefix}_CLIENT_ID`]: `${prefix}-id`,
  [`${prefix}_CLIENT_SECRET`]: `${prefix}-secret`,
  [`${prefix}_REFRESH_TOKEN`]: `${prefix}-refresh`,
});

// What must fail: the pull running unless switched on; an unrecognised switch
// read as off without a word; the wrong key chosen; a malformed sender
// reaching the Gmail query; a query built without any sender.
describe("the supplier invoice mail pull's settings", () => {
  it("is off unless the switch says true, and says why", () => {
    assert.deepEqual(supplierInvoiceMailSwitch(undefined), {
      on: false,
      reason: "NOT_SET",
    });
    assert.deepEqual(supplierInvoiceMailSwitch(" FALSE "), {
      on: false,
      reason: "OFF",
    });
    assert.deepEqual(supplierInvoiceMailSwitch("igen"), {
      on: false,
      reason: "UNRECOGNISED",
    });
    assert.deepEqual(supplierInvoiceMailSwitch(" True "), { on: true });
  });

  it("takes its own key first, then the GLS key, then the Foxpost key", () => {
    assert.equal(supplierInvoiceMailCredentials({})?.source, undefined);
    assert.equal(
      supplierInvoiceMailCredentials(key("GMAIL_FOXPOST"))?.source,
      "GMAIL_FOXPOST",
    );
    assert.equal(
      supplierInvoiceMailCredentials({
        ...key("GMAIL_FOXPOST"),
        ...key("GMAIL_GLS"),
      })?.source,
      "GMAIL_GLS",
    );
    assert.equal(
      supplierInvoiceMailCredentials({
        ...key("GMAIL_GLS"),
        ...key("GMAIL_SUPPLIER_INVOICE"),
      })?.source,
      "GMAIL_SUPPLIER_INVOICE",
    );
    // a half key is no key
    assert.equal(
      supplierInvoiceMailCredentials({ GMAIL_SUPPLIER_INVOICE_CLIENT_ID: "x" }),
      null,
    );
  });

  it("watches the adapters' senders plus the configured ones, lower case, deduplicated, well formed only", () => {
    assert.deepEqual(
      supplierInvoiceMailSenders(["contact@aquarioom.com"], {
        SUPPLIER_INVOICE_MAIL_SENDERS:
          " Info@DeJongMarineLife.nl, contact@aquarioom.com, nem-cim, a b@c.d, x@y) ",
      }),
      ["contact@aquarioom.com", "info@dejongmarinelife.nl"],
    );
  });

  // CoralSands has no PDF adapter to name its sender: its invoice is the XML
  it("names the XML e-invoice senders that have no adapter", () => {
    assert.ok(XML_INVOICE_SENDERS.includes("info@coralsands.de"));
  });

  it("builds the query from the senders, and none without a sender", () => {
    assert.equal(
      supplierInvoiceMailQuery(["a@x.hu", "b@y.hu"]),
      "from:(a@x.hu OR b@y.hu) has:attachment (filename:pdf OR filename:xml) newer_than:120d",
    );
    assert.equal(supplierInvoiceMailQuery([]), null);
  });

  it("runs every 30 minutes unless told otherwise, within 5 to 1440", () => {
    assert.equal(supplierInvoiceMailIntervalMinutes({}), 30);
    assert.equal(
      supplierInvoiceMailIntervalMinutes({
        SUPPLIER_INVOICE_MAIL_SYNC_INTERVAL_MINUTES: "60",
      }),
      60,
    );
    assert.equal(
      supplierInvoiceMailIntervalMinutes({
        SUPPLIER_INVOICE_MAIL_SYNC_INTERVAL_MINUTES: "2",
      }),
      30,
    );
  });

  it("says in one sentence why it runs or not", () => {
    const credentials = supplierInvoiceMailCredentials(key("GMAIL_GLS"));
    assert.match(
      describeSupplierInvoiceMailState(
        { on: false, reason: "UNRECOGNISED" },
        credentials,
        ["a@x.hu"],
        30,
      ),
      /neither true nor false/,
    );
    assert.match(
      describeSupplierInvoiceMailState({ on: true }, null, ["a@x.hu"], 30),
      /no Gmail key/,
    );
    assert.match(
      describeSupplierInvoiceMailState({ on: true }, credentials, [], 30),
      /no sender to watch/,
    );
    assert.equal(
      describeSupplierInvoiceMailState(
        { on: true },
        credentials,
        ["a@x.hu"],
        30,
      ),
      "Supplier invoice mail sync enabled (30 min, 1 sender(s), key: GMAIL_GLS_*)",
    );
  });
});

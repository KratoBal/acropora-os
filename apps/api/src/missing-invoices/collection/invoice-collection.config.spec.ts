import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeInvoiceCollectionState,
  driveFolderId,
  invoiceCollectionDays,
  invoiceCollectionSources,
  invoiceCollectionSwitch,
} from "./invoice-collection.config.js";

const KEY = { CLIENT_ID: "c", CLIENT_SECRET: "s", REFRESH_TOKEN: "r" };
const withKey = (prefix: string) =>
  Object.fromEntries(
    Object.entries(KEY).map(([name, value]) => [`${prefix}_${name}`, value]),
  );
const FOLDER =
  "https://drive.google.com/drive/folders/1YKyszRhtpaGh4302QYFielF5wjQi4oHI?usp=sharing";

describe("the invoice collection settings", () => {
  it("is off unless switched on, and says so", () => {
    assert.deepEqual(invoiceCollectionSwitch({}), {
      on: false,
      reason: "NOT_SET",
    });
    assert.deepEqual(
      invoiceCollectionSwitch({ INVOICE_COLLECTION_ENABLED: "igen" }),
      { on: false, reason: "UNRECOGNISED" },
    );
    assert.match(
      describeInvoiceCollectionState(invoiceCollectionSwitch({}), []),
      /disabled \(INVOICE_COLLECTION_ENABLED is not set\)/,
    );
  });

  it("reads info@ with the existing key, and leaves out a source without its own key", () => {
    const environment = {
      ...withKey("GMAIL_FOXPOST"),
      MISSING_INVOICES_DRIVE_FOLDER_URL: FOLDER,
    };
    const sources = invoiceCollectionSources(environment);
    assert.deepEqual(
      sources.map((s) => [s.source, "user" in s ? s.user : s.folderId]),
      [["INFO_MAIL", "info@acropora.hu"]],
    );
    assert.match(
      describeInvoiceCollectionState({ on: true }, sources, environment),
      /sources: INFO_MAIL; skipped: balazs@ \(GMAIL_BALAZS_\* empty\); Drive \(GOOGLE_DRIVE_\* empty\)/,
    );
  });

  it("takes balazs@ and the Drive folder when their own keys are there", () => {
    const sources = invoiceCollectionSources({
      ...withKey("GMAIL_BALAZS"),
      ...withKey("GOOGLE_DRIVE"),
      MISSING_INVOICES_DRIVE_FOLDER_URL: FOLDER,
    });
    assert.deepEqual(
      sources.map((s) => [s.source, "user" in s ? s.user : s.folderId]),
      [
        ["BALAZS_MAIL", "balazs@acropora.hu"],
        ["DRIVE", "1YKyszRhtpaGh4302QYFielF5wjQi4oHI"],
      ],
    );
  });

  it("finds the folder id in the share link only, and bounds the day count", () => {
    assert.equal(driveFolderId("https://drive.google.com/file/d/abc"), null);
    assert.equal(driveFolderId(undefined), null);
    assert.deepEqual(
      ["3", "90", "x", undefined].map((days) =>
        invoiceCollectionDays({ INVOICE_COLLECTION_DAYS: days }),
      ),
      [150, 90, 150, 150],
    );
  });
});

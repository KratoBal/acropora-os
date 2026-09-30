import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeSimplePaySyncState,
  isSimplePayReportSubject,
  simplePayGmailCredentials,
  simplePaySyncIntervalMinutes,
  simplePaySyncSwitch,
} from "./simplepay-gmail.config.js";

const key = (prefix: string) => ({
  [`${prefix}_CLIENT_ID`]: `${prefix}-id`,
  [`${prefix}_CLIENT_SECRET`]: "s",
  [`${prefix}_REFRESH_TOKEN`]: "r",
});

describe("SimplePay Gmail settings", () => {
  it("is on only for true, and says why when it is not", () => {
    assert.deepEqual(simplePaySyncSwitch(" TRUE "), { on: true });
    assert.deepEqual(simplePaySyncSwitch(undefined), {
      on: false,
      reason: "NOT_SET",
    });
    assert.deepEqual(simplePaySyncSwitch("false"), {
      on: false,
      reason: "OFF",
    });
    assert.deepEqual(simplePaySyncSwitch("1"), {
      on: false,
      reason: "UNRECOGNISED",
    });
    assert.match(
      describeSimplePaySyncState(simplePaySyncSwitch("1"), null, 60),
      /neither true nor false/,
    );
  });

  it("takes its own key first, then the GLS one, then the Foxpost one", () => {
    assert.equal(
      simplePayGmailCredentials({
        ...key("GMAIL_FOXPOST"),
        ...key("GMAIL_GLS"),
        ...key("GMAIL_SIMPLEPAY"),
      })?.source,
      "GMAIL_SIMPLEPAY",
    );
    assert.equal(
      simplePayGmailCredentials({
        ...key("GMAIL_FOXPOST"),
        ...key("GMAIL_GLS"),
      })?.source,
      "GMAIL_GLS",
    );
    assert.equal(
      simplePayGmailCredentials(key("GMAIL_FOXPOST"))?.source,
      "GMAIL_FOXPOST",
    );
    assert.equal(simplePayGmailCredentials({}), null);
  });

  it("keeps the interval between 5 and 1440 minutes", () => {
    assert.equal(simplePaySyncIntervalMinutes({}), 60);
    assert.equal(
      simplePaySyncIntervalMinutes({
        GMAIL_SIMPLEPAY_SYNC_INTERVAL_MINUTES: "2",
      }),
      60,
    );
    assert.equal(
      simplePaySyncIntervalMinutes({
        GMAIL_SIMPLEPAY_SYNC_INTERVAL_MINUTES: "30",
      }),
      30,
    );
  });

  // the same sender also sends these (measured in info@, 2026-09-30)
  it("knows the weekly report by its subject, and nothing else SimplePay sends", () => {
    assert.equal(
      isSimplePayReportSubject("SimplePay - Forgalmi kimutatás"),
      true,
    );
    for (const other of [
      "SimplePay - Sikeres fizetés",
      "SimplePay - Visszatérítés",
      "SimplePay - Elektronikus számla",
      null,
    ])
      assert.equal(isSimplePayReportSubject(other), false, String(other));
  });
});

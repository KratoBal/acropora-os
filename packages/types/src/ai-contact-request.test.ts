import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkAiContactRequestInput } from "./ai-contact-request.js";

const base = {
  channel: "EMAIL",
  value: "vasarlo@example.hu",
  conversationRef: "conv-1",
  requestKey: "msg-1",
};
const check = (over: Record<string, unknown>) =>
  checkAiContactRequestInput({ ...base, ...over });

describe("checkAiContactRequestInput (the hand-over from the AI service)", () => {
  it("accepts an e-mail address and the Hungarian telephone shapes the AI service masks, trimmed", () => {
    assert.deepEqual(check({}), { ok: true, value: base });
    assert.equal(
      (
        check({ value: "  vasarlo@example.hu " }) as {
          value: { value: string };
        }
      ).value.value,
      "vasarlo@example.hu",
    );
    for (const phone of [
      "+36 30 123 4567",
      "06301234567",
      "0036-1-234-5678",
      "06 (20) 123-45-67",
      "+36/70/123.45.67",
    ])
      assert.equal(check({ channel: "PHONE", value: phone }).ok, true, phone);
  });

  it("refuses what is no contact: an order or part number, a foreign number, a number without its prefix, a longer digit string", () => {
    for (const phone of [
      "123456",
      "A-2024-0042",
      "+44 20 7946 0958",
      "301234567",
      "06301234567890",
      "06 30 123",
      "x06301234567",
      "06301234567 hívj",
    ])
      assert.equal(check({ channel: "PHONE", value: phone }).ok, false, phone);
  });

  it("holds the channel to its own shape: a telephone number is no EMAIL and an address is no PHONE", () => {
    assert.equal(check({ value: "06301234567" }).ok, false);
    assert.equal(
      check({ channel: "PHONE", value: "vasarlo@example.hu" }).ok,
      false,
    );
    for (const value of [
      "nincs-kukac.hu",
      "a@b",
      "a b@example.hu",
      "@example.hu",
    ])
      assert.equal(check({ value }).ok, false, value);
  });

  it("refuses a wrong channel, a missing or over-long value and bad references", () => {
    assert.equal(check({ channel: "SMS" }).ok, false);
    assert.equal(check({ channel: undefined }).ok, false);
    assert.equal(check({ value: "" }).ok, false);
    assert.equal(check({ value: 42 }).ok, false);
    assert.equal(check({ value: `${"a".repeat(250)}@example.hu` }).ok, false);
    for (const ref of ["", "a b", "x".repeat(101), 7, null, "a/b"]) {
      assert.equal(check({ conversationRef: ref }).ok, false, String(ref));
      assert.equal(check({ requestKey: ref }).ok, false, String(ref));
    }
    assert.equal(checkAiContactRequestInput(null).ok, false);
    assert.equal(checkAiContactRequestInput("x").ok, false);
  });

  it("returns exactly the four fields, nothing else the caller sent along", () => {
    const checked = check({ extra: "x", handledAt: "2026-01-01" });
    assert.equal(checked.ok, true);
    assert.deepEqual(Object.keys((checked as { value: object }).value).sort(), [
      "channel",
      "conversationRef",
      "requestKey",
      "value",
    ]);
  });
});

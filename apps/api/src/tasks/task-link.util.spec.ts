import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTaskLink } from "./task-link.util.js";

describe("parseTaskLink", () => {
  it("treats an empty or whitespace-only link as no link", () => {
    assert.deepEqual(parseTaskLink(undefined), { valid: true });
    assert.deepEqual(parseTaskLink(""), { valid: true });
    assert.deepEqual(parseTaskLink("   "), { valid: true });
  });

  it("accepts absolute http and https URLs", () => {
    assert.deepEqual(parseTaskLink("https://discord.com/channels/1/2/3"), {
      valid: true,
      value: "https://discord.com/channels/1/2/3",
    });
    assert.deepEqual(parseTaskLink("  http://localhost:3000/thread  "), {
      valid: true,
      value: "http://localhost:3000/thread",
    });
  });

  it("rejects schemes that would execute in the reader's session", () => {
    assert.deepEqual(parseTaskLink("javascript:alert(1)"), { valid: false });
    assert.deepEqual(parseTaskLink("JavaScript:alert(1)"), { valid: false });
    assert.deepEqual(parseTaskLink("data:text/html,<script>x()</script>"), {
      valid: false,
    });
    assert.deepEqual(parseTaskLink("vbscript:msgbox"), { valid: false });
  });

  it("rejects relative and scheme-less values", () => {
    assert.deepEqual(parseTaskLink("discord.com/channels/1"), { valid: false });
    assert.deepEqual(parseTaskLink("/feladataim"), { valid: false });
  });
});

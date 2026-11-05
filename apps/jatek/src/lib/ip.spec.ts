import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latogatoIp } from "./ip.ts";

/*
  WHAT TURNS THIS RED. The FIRST entry taken (a visitor can put anything at the front of the header; the proxy
  appends the real address at the END); a junk entry passed on to the api; a missing header giving a made-up address.
*/
describe("latogatoIp", () => {
  it("is the last valid entry: the one the proxy appended", () => {
    assert.equal(latogatoIp("203.0.113.9"), "203.0.113.9");
    assert.equal(latogatoIp("1.2.3.4, 203.0.113.9"), "203.0.113.9");
    assert.equal(
      latogatoIp(" 1.2.3.4 ,  10.0.0.1 , 203.0.113.9 "),
      "203.0.113.9",
    );
  });

  it("never takes the forged front entry when a later one is valid", () => {
    assert.equal(latogatoIp("198.51.100.77, 203.0.113.9"), "203.0.113.9");
  });

  it("skips junk from the end, and an address with a number over 255 is junk", () => {
    assert.equal(latogatoIp("203.0.113.9, nem-ip"), "203.0.113.9");
    assert.equal(latogatoIp("203.0.113.9, 999.1.1.1"), "203.0.113.9");
    assert.equal(latogatoIp("203.0.113.9, <script>"), "203.0.113.9");
  });

  it("accepts an IPv6 address", () => {
    assert.equal(latogatoIp("2001:db8::1"), "2001:db8::1");
  });

  it("is null without a header or without any valid address", () => {
    for (const v of [null, undefined, "", " , ", "nem ip", "999.999.999.999"])
      assert.equal(latogatoIp(v), null, String(v));
  });
});

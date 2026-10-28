import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedMedusaHosts,
  checkMedusaHost,
} from "./catalog-actions.host-guard.js";

/*
  THE HOST LIST (the second guard). What turns this red: a list entry that is
  not a plain host name being read as one (a wildcard allowing everything); the
  scheme, path or port of an entry breaking the match; a URL matched as text
  instead of parsed.
*/
describe("the allowed Medusa hosts", () => {
  it("takes plain host names, trimmed and lower-cased", () => {
    assert.deepEqual(allowedMedusaHosts(" A.test, b.test ,,"), [
      "a.test",
      "b.test",
    ]);
  });

  it("drops a scheme, a path, a port and a trailing dot from an entry", () => {
    assert.deepEqual(
      allowedMedusaHosts("https://A.test:9000/x?y=1#z, b.test."),
      ["a.test", "b.test"],
    );
  });

  it("ignores anything that is not a plain host name: a wildcard never means 'any'", () => {
    assert.deepEqual(
      allowedMedusaHosts("*, *.test, a_b.test, a b.test, .test, -a.test"),
      [],
    );
  });

  it("an unset or empty list allows nothing", () => {
    assert.deepEqual(allowedMedusaHosts(undefined), []);
    assert.deepEqual(allowedMedusaHosts(""), []);
  });
});

describe("the Medusa host check", () => {
  const env = (url: string | undefined, hosts: string | undefined) => ({
    MEDUSA_ADMIN_URL: url,
    CATALOG_ACTION_MEDUSA_HOSTS: hosts,
  });

  it("passes the listed host and returns it", () => {
    assert.deepEqual(checkMedusaHost(env("https://a.test/admin", "a.test")), {
      ok: true,
      host: "a.test",
    });
  });

  it("refuses an unlisted host, naming only the host", () => {
    const result = checkMedusaHost(
      env("https://b.test/secret?key=1", "a.test"),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /b\.test/);
      assert.doesNotMatch(result.message, /secret|key=1/);
    }
  });

  it("an empty or missing list is refused AS A MISSING SETTING, not as an unlisted host", () => {
    for (const hosts of [undefined, "", " , ", "*"]) {
      const result = checkMedusaHost(env("https://a.test", hosts));
      assert.equal(result.ok, false);
      if (!result.ok)
        assert.match(
          result.message,
          /CATALOG_ACTION_MEDUSA_HOSTS nincs beállítva/,
        );
    }
  });

  it("parses the URL, so user-info in front of the allowed name does not pass", () => {
    assert.equal(
      checkMedusaHost(env("https://a.test@b.test", "a.test")).ok,
      false,
    );
  });
});

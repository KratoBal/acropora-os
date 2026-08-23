import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readApnsConfig } from "./apns.config.js";

const PEM = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";

/**
 * Az alapeset BASE64, mert az élesben ez van: Balázs lemérte a futó
 * konténerben, és az érték nem `-----BEGIN` kezdetű. A tesztek főárama tehát
 * azt az utat járja, amit a rendszer valóban használ - a PEM-ág külön esetként
 * marad, védelemnek egy jövőbeli változás ellen.
 */
const complete = {
  APNS_PRIVATE_KEY_BASE64: Buffer.from(PEM).toString("base64"),
  APNS_KEY_ID: "KEY123",
  APNS_TEAM_ID: "TEAM123",
  APNS_ENVIRONMENT: "production",
};

describe("APNs configuration", () => {
  it("reads a complete set and points at the production host", () => {
    const result = readApnsConfig(complete);

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.host, "api.push.apple.com");
    assert.equal(result.config.keyId, "KEY123");
  });

  it("points at the sandbox host when asked to", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_ENVIRONMENT: "sandbox",
    });

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.host, "api.sandbox.push.apple.com");
  });

  /**
   * A missing key is a development machine, not a fault: the sender says it is
   * off and the assignment carries on. What must never happen is a
   * half-configured sender that looks ready and fails on every send, so the
   * answer names every missing piece at once.
   */
  it("reports what is missing rather than half-starting", () => {
    const result = readApnsConfig({ APNS_KEY_ID: "KEY123" });

    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, [
      "APNS_PRIVATE_KEY_BASE64",
      "APNS_TEAM_ID",
      "APNS_ENVIRONMENT",
    ]);
  });

  /**
   * Choosing a default here would be the expensive kind of helpful: a typo in
   * a staging deployment would start sending real notifications to real
   * phones, and nothing would say why.
   */
  it("refuses an environment it does not recognise instead of guessing", () => {
    const result = readApnsConfig({ ...complete, APNS_ENVIRONMENT: "prod" });

    assert.equal(result.configured, false);
    if (result.configured) return;
    // Beállítva van, csak értelmezhetetlen: ez hiba, nem hiány. A kettő a
    // naplóban is külön mondat, mert aki a Coolify felületén keresné a
    // "hiányzó" változót, azt ott találná.
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, ["APNS_ENVIRONMENT"]);
  });

  /**
   * A PEM has line breaks, and both Docker and Coolify make those easy to lose
   * on the way in. A key pasted with literal backslash-n is put back together
   * here rather than failing later with an unreadable crypto error.
   */
  it("puts a key's line breaks back when they arrive escaped", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_PRIVATE_KEY_BASE64:
        "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.signingKey.includes("\\n"), false);
    assert.equal(result.config.signingKey.split("\n").length, 3);
  });

  /**
   * A változó NEVE azt állítja, hogy base64; a tartalma a tény. A kettő ma
   * este már egyszer eltért egymástól ugyanezen a beállításon, ezért a kód
   * felismeri az alakot, nem feltételezi.
   */
  it("decodes the base64 key the live deployment actually carries", () => {
    const result = readApnsConfig(complete);

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.signingKey, PEM);
  });

  it("accepts the same key as plain PEM, whatever the variable is called", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_PRIVATE_KEY_BASE64: PEM,
    });

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.signingKey, PEM);
  });

  /**
   * A csendes hiba helye: base64, ami nem PEM-et rejt. Ha ez a crypto rétegig
   * jutna, egy értelmezhetetlen kriptográfiai üzenet állítaná meg a küldést,
   * és nem mondaná meg, hogy a beállítás a baj.
   */
  it("refuses base64 that does not decode to a PEM, by name", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_PRIVATE_KEY_BASE64: Buffer.from("nem kulcs, csak szoveg").toString(
        "base64",
      ),
    });

    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, ["APNS_PRIVATE_KEY_BASE64"]);
  });

  /**
   * Neither shape: refused by name, and NOT as a missing variable. A silent
   * skip here would look like an unconfigured deployment while the value sits
   * in the settings, which is exactly the evening we have just had.
   */
  it("names the key as invalid when it is neither PEM nor base64 PEM", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_PRIVATE_KEY_BASE64: "nem-kulcs",
    });

    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, ["APNS_PRIVATE_KEY_BASE64"]);
  });

  /** A titok soha nem kerül a hibaüzenetbe, akkor sem, ha értelmezhetetlen. */
  it("never repeats the key back in its answer", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_PRIVATE_KEY_BASE64: "titkos-ertek-amit-nem-szabad-kiirni",
    });

    assert.equal(
      JSON.stringify(result).includes("titkos-ertek"),
      false,
      "a kulcs értéke nem szerepelhet a válaszban",
    );
  });
});

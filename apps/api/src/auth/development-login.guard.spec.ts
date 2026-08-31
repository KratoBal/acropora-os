import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { developmentLoginRefusal } from "./development-login.guard.js";

/**
 * A függvény kap környezetet paraméterként, ezért ezek a tesztek NEM
 * nyúlnak a `process.env`-hez: nincs sorrend-függésük, és nincs mit
 * visszaállítaniuk.
 */
describe("developmentLoginRefusal", () => {
  it("allows the development login when the development auth provider is selected", () => {
    assert.equal(
      developmentLoginRefusal({
        AUTH_PROVIDER: "development",
        NODE_ENV: "development",
      }),
      null,
    );
  });

  /**
   * EZ A TESZT A LÉTEZÉSÉNEK AZ OKA. Pontosan az a bemenet, amit az első őrző
   * (`node-env.guard.ts`) ELENGED: a `development` ISMERT érték. Ha ez a teszt
   * eltűnik vagy zöldre fordul, a két zár egy zárrá olvadt össze.
   */
  it("refuses when NODE_ENV is a value the first guard accepts but the provider is unset", () => {
    const refusal = developmentLoginRefusal({ NODE_ENV: "development" });
    assert.notEqual(refusal, null);
    assert.match(String(refusal), /AUTH_PROVIDER/);
  });

  it("refuses when the provider names something else", () => {
    assert.notEqual(
      developmentLoginRefusal({
        AUTH_PROVIDER: "oidc",
        NODE_ENV: "development",
      }),
      null,
    );
  });

  it("refuses on an empty or whitespace-only provider", () => {
    assert.notEqual(developmentLoginRefusal({ AUTH_PROVIDER: "" }), null);
    assert.notEqual(developmentLoginRefusal({ AUTH_PROVIDER: "   " }), null);
  });

  /**
   * A `NODE_ENV` ÁGA KÜLÖN MÉRHETŐ, ÉS EZÉRT ÁLL ITT A PROVIDER HELYESEN. Ha
   * a provider itt hiányozna, a teszt akkor is zöld lenne -- csak nem attól,
   * amit a neve állít.
   */
  it("still refuses in production even with the development provider selected", () => {
    const refusal = developmentLoginRefusal({
      AUTH_PROVIDER: "development",
      NODE_ENV: "production",
    });
    assert.notEqual(refusal, null);
    assert.match(String(refusal), /NODE_ENV/);
  });

  it("does not treat a mixed-case provider as the development one", () => {
    assert.notEqual(
      developmentLoginRefusal({ AUTH_PROVIDER: "Development" }),
      null,
    );
  });
});

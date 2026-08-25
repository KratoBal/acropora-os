import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptMedusaCredential,
  encryptMedusaCredential,
  validateActiveMedusaMasterKey,
  validateMedusaCredentialEnvelope,
} from "./medusa-credential-crypto.service.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";

/**
 * A titkosítás DÖNTÉSEI mérve, adatbázis nélkül.
 *
 * Nem az a kérdés, hogy az AES működik-e, hanem hogy a boríték ahhoz a helyhez
 * van-e kötve, ahol áll. Három rontás van itt megírva, és mindháromnak pirosra
 * kell váltania: rossz mesterkulcs, elrontott hitelesítő címke, más revízió. Ha
 * bármelyik zöld maradna, a boríték átcserélhető lenne egy másik rekordéra.
 */

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");

const environment = {
  MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  MEDUSA_CREDENTIAL_MASTER_KEY_V1: key,
};

describe("Medusa credential AES-256-GCM", () => {
  it("round-trips, and never with the same IV twice", () => {
    let counter = 0;
    const random = (size: number) => Buffer.alloc(size, ++counter);

    const first = encryptMedusaCredential("sk_teszt", 3, environment, random);
    const second = encryptMedusaCredential("sk_teszt", 3, environment, random);

    assert.equal(first.encryptionIv.length, 12);
    assert.equal(first.authenticationTag.length, 16);
    assert.notDeepEqual(first.encryptionIv, second.encryptionIv);
    assert.equal(decryptMedusaCredential(first, 3, environment), "sk_teszt");
    assert.doesNotThrow(() =>
      validateMedusaCredentialEnvelope(first, 3, environment),
    );
  });

  /**
   * ELSŐ RONTÁS: másik mesterkulcs. Ez az az eset, amikor valaki a
   * környezeti változót cseréli ki, vagy egy másik telepítés kulcsával
   * próbálja megnyitni a borítékot.
   */
  it("refuses to decrypt with a different master key", () => {
    const envelope = encryptMedusaCredential("sk_teszt", 3, environment);

    assert.throws(
      () =>
        decryptMedusaCredential(envelope, 3, {
          MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
          MEDUSA_CREDENTIAL_MASTER_KEY_V1: otherKey,
        }),
      (error: unknown) =>
        error instanceof MedusaConnectionError &&
        error.code === "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
    );
  });

  /**
   * MÁSODIK RONTÁS: elrontott hitelesítő címke. Ez nem elméleti: egy csonkolt
   * vagy félig felülírt sor pontosan így néz ki, és a GCM címkéje az egyetlen,
   * ami ezt megkülönbözteti egy ép boríléktól.
   */
  it("refuses to decrypt when the authentication tag was altered", () => {
    const envelope = encryptMedusaCredential("sk_teszt", 3, environment);
    const authenticationTag = Buffer.from(envelope.authenticationTag);
    authenticationTag[0] = (authenticationTag[0] ?? 0) ^ 0xff;
    const tampered = { ...envelope, authenticationTag };

    assert.throws(
      () => decryptMedusaCredential(tampered, 3, environment),
      (error: unknown) =>
        error instanceof MedusaConnectionError &&
        error.code === "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
    );
  });

  /**
   * HARMADIK RONTÁS: MÁS REVÍZIÓ. Ez a legfontosabb a háromból, mert ez az,
   * amit egy egyszerű titkosítás nem fogna meg: a boríték ép, a mesterkulcs
   * helyes, csak nem AHHOZ a rekord-állapothoz tartozik. Egy régi boríték
   * visszaírása az új revízió mellé így hibát ad, nem rossz kulcsot.
   */
  it("refuses to decrypt an envelope that belongs to another revision", () => {
    const envelope = encryptMedusaCredential("sk_teszt", 3, environment);

    assert.throws(
      () => decryptMedusaCredential(envelope, 4, environment),
      (error: unknown) =>
        error instanceof MedusaConnectionError &&
        error.code === "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
    );
  });

  /**
   * A boríték ALAKJA is ellenőrizve van, mielőtt a titkosítás elindulna: egy
   * rossz hosszúságú IV vagy címke nem juthat el a visszafejtésig, mert ott
   * már megkülönböztethetetlen lenne egy valódi manipulációtól.
   */
  it("rejects a malformed envelope before it reaches the cipher", () => {
    const envelope = encryptMedusaCredential("sk_teszt", 3, environment);

    assert.throws(
      () =>
        decryptMedusaCredential(
          { ...envelope, encryptionIv: Buffer.alloc(8, 1) },
          3,
          environment,
        ),
      (error: unknown) =>
        error instanceof MedusaConnectionError &&
        error.code === "MEDUSA_CREDENTIAL_ENVELOPE_INVALID",
    );
  });

  /**
   * A mesterkulcs a MEDUSA saját környezeti változójából jön. Ha valaki az
   * UNAS vagy a NAV kulcsát állítja be helyette, az nem "majdnem jó", hanem
   * nincs beállítva: a hiányzó beállítás és a rossz beállítás két külön eset.
   */
  it("tells a missing master key apart from an invalid one", () => {
    assert.throws(
      () =>
        validateActiveMedusaMasterKey({
          MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        }),
      (error: unknown) =>
        error instanceof MedusaConnectionError &&
        error.code === "MEDUSA_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
    );

    assert.throws(
      () =>
        validateActiveMedusaMasterKey({
          MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
          MEDUSA_CREDENTIAL_MASTER_KEY_V1: "nem-base64",
        }),
      (error: unknown) =>
        error instanceof MedusaConnectionError &&
        error.code === "MEDUSA_CREDENTIAL_MASTER_KEY_INVALID",
    );

    assert.doesNotThrow(() => validateActiveMedusaMasterKey(environment));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import type { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import {
  MedusaConnectionError,
  type MedusaConnectionSettingRecord,
} from "./medusa-connection.types.js";

/**
 * A VISSZAESÉS TILALMA, mérve.
 *
 * Ez a fájl egyetlen dolgot őriz, és az a legkönnyebben elrontható rész az
 * egész körben: sérült tárolt hitelesítő adat mellett NINCS visszaesés a
 * környezeti változóra. A kísértés nem elméleti, hanem a tartalék puszta
 * létéből jön: „van env, használjuk" reflexből írható le, és utána a rendszer
 * működni LÁTSZANA, miközben egy sérült titok mellett egy másikat használna.
 *
 * Amíg az indulás megállt egy sérült borítéknál, ezt a hibát elfedte volna,
 * hogy odáig el sem jutunk. A blokkolás megszűnésével viszont ez az egyetlen,
 * ami az utat elzárja.
 */

const environment = {
  MEDUSA_ADMIN_API_KEY: "sk_kornyezeti_tartalek",
  MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  MEDUSA_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 5).toString("base64"),
};

/**
 * ASZINKRON, és ez nem részletkérdés: az első változata szinkron `finally`-vel
 * állította vissza a környezetet, tehát a változók ELTŰNTEK, mielőtt a mért
 * hívás lefutott volna. A teszt ettől pirosra váltott, méghozzá MÁS hibakóddal,
 * mint amit mér, és egy pillanatra úgy nézett ki, mintha a kód romlott volna el.
 */
async function withEnvironment<T>(run: () => Promise<T>): Promise<T> {
  const before = { ...process.env };
  Object.assign(process.env, environment);
  try {
    return await run();
  } finally {
    for (const key of Object.keys(environment))
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
  }
}

const record = (
  extra: Partial<MedusaConnectionSettingRecord>,
): MedusaConnectionSettingRecord =>
  ({
    id: "medusa",
    credentialMode: "DATABASE",
    credentialRevision: 1,
    ...extra,
  }) as MedusaConnectionSettingRecord;

function provider(setting: MedusaConnectionSettingRecord) {
  const repository = {
    getSetting: async () => setting,
  } as unknown as MedusaConnectionRepository;
  return new MedusaCredentialProvider(
    repository,
    new MedusaCredentialCryptoService(),
  );
}

describe("MedusaCredentialProvider", () => {
  /**
   * A LÉNYEG. A környezetben SZÁNDÉKOSAN áll érvényes kulcs: ha lenne
   * visszaesés, ez a teszt zöld maradna, és pont azt fedné el, amit őriz.
   */
  it("never falls back to the environment when the stored credential is corrupt", async () => {
    const subject = provider(
      record({
        encryptedApiKey: Buffer.from("ervenytelen"),
        encryptionIv: Buffer.alloc(12, 1),
        authenticationTag: Buffer.alloc(16, 2),
        keyVersion: "1",
      }),
    );

    await withEnvironment(async () => {
      await assert.rejects(
        () => subject.resolve(),
        (error: unknown) =>
          error instanceof MedusaConnectionError &&
          error.code === "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
        "sérült borítéknál hibát kell dobni, nem a környezeti kulcsot visszaadni",
      );
    });
  });

  /**
   * A HIÁNYZÓ boríték sem vezethet visszaeséshez: a `DATABASE` mód azt jelenti,
   * hogy a tárolóból kell jönnie, és egy üres sor ott hiba, nem tartalék-ok.
   */
  it("does not fall back when the stored envelope is missing entirely", async () => {
    const subject = provider(record({}));

    await withEnvironment(async () => {
      await assert.rejects(
        () => subject.resolve(),
        (error: unknown) =>
          error instanceof MedusaConnectionError &&
          error.code === "MEDUSA_CREDENTIAL_ENVELOPE_INVALID",
      );
    });
  });

  /**
   * A TARTALÉK viszont működik, amikor tényleg az van beállítva, ÉS a hívó
   * megtudja, hogy azon az úton jött. A `source` nem díszítés: amíg a tartalék
   * néma, egy átmenetből észrevétlenül állapot lesz.
   */
  it("uses the environment when that is the configured mode, and says so", async () => {
    const subject = provider(record({ credentialMode: "ENV_FALLBACK" }));

    const resolved = await withEnvironment(async () => subject.resolve());

    assert.equal(resolved.apiKey, "sk_kornyezeti_tartalek");
    assert.equal(resolved.source, "env");
    // A revízió a kulcs AZONOSSÁGA, nem a kulcs: naplóba ez mehet.
    assert.match(resolved.revision, /^env:[0-9a-f]{16}$/);
    assert.equal(resolved.revision.includes(resolved.apiKey), false);
  });

  it("refuses a disabled connection instead of quietly using the environment", async () => {
    const subject = provider(record({ credentialMode: "DISABLED" }));

    await withEnvironment(async () => {
      await assert.rejects(
        () => subject.resolve(),
        (error: unknown) =>
          error instanceof MedusaConnectionError &&
          error.code === "MEDUSA_CONNECTION_DISABLED",
      );
    });
  });
});

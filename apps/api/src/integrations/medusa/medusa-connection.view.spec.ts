import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MedusaConnectionController } from "./medusa-connection.controller.js";
import { MedusaConnectionService } from "./medusa-connection.service.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import type { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import type { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  MedusaConnectionError,
  type MedusaConnectionSettingRecord,
} from "./medusa-connection.types.js";

/**
 * AMIT A FELÜLET KAP, és ami sosem kerülhet bele.
 *
 * A legfontosabb állítás itt olyan, aminek egész életében zöldnek kell lennie,
 * és pont akkor ér valamit, amikor egyszer pirosra vált: a nyers kulcs nem
 * jelenhet meg a válaszban. A többi állítás azt őrzi, hogy a felület ugyanazt
 * az állapotot lássa, amit a modul mér, és ne egy saját, kényelmi másolatot.
 */

const SECRET = "sk_titok_ami_soha_nem_lathato";

const environment = {
  MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  MEDUSA_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 5).toString("base64"),
};

function withEnvironment<T>(run: () => Promise<T>): Promise<T> {
  Object.assign(process.env, environment);
  return run();
}

function harness(
  options: {
    mode?: MedusaConnectionSettingRecord["credentialMode"];
    cooldownClaimed?: boolean;
    validate?: () => void;
    probe?: () => Promise<void>;
  } = {},
) {
  let stored: MedusaConnectionSettingRecord = {
    id: "medusa",
    credentialMode: options.mode ?? "ENV_FALLBACK",
    credentialRevision: 0,
    verificationStatus: "NEVER",
  } as MedusaConnectionSettingRecord;

  const saved: { revision: number }[] = [];

  const repository = {
    getSetting: async () => stored,
    claimCooldown: async () =>
      options.cooldownClaimed === false ? null : stored,
    replaceCredential: async (input: { revision: number }) => {
      saved.push({ revision: input.revision });
      stored = {
        ...stored,
        credentialMode: "DATABASE",
        credentialRevision: input.revision,
        credentialUpdatedAt: new Date("2026-08-25T12:00:00.000Z"),
      };
      return stored;
    },
    disable: async () => {
      stored = {
        ...stored,
        credentialMode: "DISABLED",
        encryptedApiKey: null,
        keyVersion: null,
      };
      return stored;
    },
    recordVerification: async () => stored,
  } as unknown as MedusaConnectionRepository;

  const credentials = {
    validateRecord: options.validate ?? (() => undefined),
    resolve: async () => ({
      apiKey: SECRET,
      source: stored.credentialMode === "DATABASE" ? "database" : "env",
      revision: "db:1",
    }),
  } as unknown as MedusaCredentialProvider;

  const client = {
    probe: options.probe ?? (async () => undefined),
  } as unknown as MedusaAdminClient;

  const service = new MedusaConnectionService(
    repository,
    credentials,
    new MedusaCredentialCryptoService(),
    () => client,
  );

  return {
    service,
    controller: new MedusaConnectionController(service),
    saved,
  };
}

describe("Medusa kapcsolat nézete", () => {
  /**
   * A LEGFONTOSABB. Nem egy mezőt néz, hanem az EGÉSZ választ keresi végig a
   * titokra: egy jövőbeli mező, ami véletlenül továbbadná, így is elbukna.
   */
  it("never returns the raw key, anywhere in the response", async () => {
    const { service } = harness({ mode: "DATABASE" });

    const view = await withEnvironment(() => service.getView());

    assert.equal(JSON.stringify(view).includes(SECRET), false);
    assert.equal(view.masked, "••••••••");
    assert.equal(view.configured, true);
  });

  it("marks an unconfigured connection as such, with no mask", async () => {
    const { service } = harness({
      validate: () => {
        throw new MedusaConnectionError("MEDUSA_CONNECTION_NOT_CONFIGURED");
      },
    });

    const view = await withEnvironment(() => service.getView());

    assert.equal(view.configured, false);
    assert.equal(view.masked, null);
    assert.equal(view.state.kind, "not-configured");
  });

  /**
   * A SÉRÜLT adat a felületen SEM látszhat „nincs beállítva" állapotnak. Ez
   * ugyanaz a kikötés, mint a modulnál, csak most azon az úton, ahol ember
   * olvassa.
   */
  it("shows a corrupt credential as corrupt, not as missing", async () => {
    const { service } = harness({
      mode: "DATABASE",
      validate: () => {
        throw new MedusaConnectionError("MEDUSA_CREDENTIAL_DECRYPT_FAILED");
      },
    });

    const view = await withEnvironment(() => service.getView());

    assert.equal(view.state.kind, "credential-corrupt");
    assert.notEqual(view.state.kind, "not-configured");
  });

  /** A tartalék úton jövő kulcs LÁTSZIK, nem egészséges alapértelmezésként. */
  it("shows which path the key came from", async () => {
    const fallback = harness({ mode: "ENV_FALLBACK" });
    const stored = harness({ mode: "DATABASE" });

    const fallbackView = await withEnvironment(() =>
      fallback.service.getView(),
    );
    const storedView = await withEnvironment(() => stored.service.getView());

    assert.equal(fallbackView.state.source, "env");
    assert.equal(storedView.state.source, "database");
  });

  it("stores a new key under the next revision, and still hides it", async () => {
    const { service, saved } = harness({ mode: "ENV_FALLBACK" });

    const view = await withEnvironment(() =>
      service.replaceCredential(SECRET, "user-1", new Date()),
    );

    assert.deepEqual(saved, [{ revision: 1 }]);
    assert.equal(view.configured, true);
    assert.equal(JSON.stringify(view).includes(SECRET), false);
  });

  /**
   * A VISSZATARTÁS külön kódot ad, mert a teendő más: várni kell, nem javítani.
   * Egy általános hibába olvasztva a felhasználó a kulcsot kezdené cserélni,
   * holott az ép.
   */
  it("refuses a second attempt inside the cooldown, with its own code", async () => {
    const { service } = harness({ cooldownClaimed: false });

    await withEnvironment(async () => {
      await assert.rejects(
        () => service.replaceCredential(SECRET, "user-1", new Date()),
        (error: unknown) =>
          error instanceof MedusaConnectionError &&
          error.code === "MEDUSA_CONNECTION_COOLDOWN",
      );
      await assert.rejects(
        () => service.testStoredCredential(new Date()),
        (error: unknown) =>
          error instanceof MedusaConnectionError &&
          error.code === "MEDUSA_CONNECTION_COOLDOWN",
      );
    });
  });

  it("clears the connection when disabled", async () => {
    const { service } = harness({ mode: "DATABASE" });

    const view = await withEnvironment(() =>
      service.disable("user-1", new Date()),
    );

    assert.equal(view.configured, false);
    assert.equal(view.masked, null);
    assert.equal(view.state.kind, "not-configured");
  });

  /**
   * A VEZÉRLŐ bemeneti kapuja: pontosan egy mező. Egy szélesebb ellenőrzés azt
   * jelentené, hogy a kérés más mezői csendben elvesznek.
   */
  it("rejects anything but a single apiKey field", async () => {
    const { controller } = harness();

    for (const body of [
      null,
      "sk_valami",
      [],
      {},
      { apiKey: "" },
      { apiKey: 42 },
      { apiKey: SECRET, extra: 1 },
    ])
      await assert.rejects(
        async () =>
          controller.replaceCredential(body, {
            id: "user-1",
          } as never),
        /MEDUSA_CREDENTIAL_INPUT_INVALID/,
      );
  });
});

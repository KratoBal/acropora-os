import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SzamlazzConnectionService } from "./szamlazz-connection.service.js";
import { SzamlazzCredentialCryptoService } from "./szamlazz-credential-crypto.service.js";
import type { SzamlazzConnectionRepository } from "./szamlazz-connection.repository.js";
import {
  SzamlazzConnectionError,
  type SzamlazzConnectionSettingRecord,
} from "./szamlazz-connection.types.js";
import type { SzamlazzCredentialProvider } from "./szamlazz-credential.provider.js";

const setting = (
  mode: SzamlazzConnectionSettingRecord["credentialMode"],
  overrides: Partial<SzamlazzConnectionSettingRecord> = {},
): SzamlazzConnectionSettingRecord =>
  ({
    id: "szamlazz",
    credentialMode: mode,
    credentialRevision: 1,
    credentialUpdatedAt: null,
    ...overrides,
  }) as SzamlazzConnectionSettingRecord;

function service(options: {
  record?: SzamlazzConnectionSettingRecord | null;
  validate?: () => void;
  claimed?: SzamlazzConnectionSettingRecord | null;
}) {
  const written: SzamlazzConnectionSettingRecord[] = [];
  let current =
    options.record === undefined ? setting("DATABASE") : options.record;

  const repository = {
    getSetting: async () => current,
    claimCredentialCooldown: async () =>
      options.claimed === undefined ? current : options.claimed,
    replaceCredential: async (input: {
      envelope: unknown;
      revision: number;
      actorUserId: string;
      updatedAt: Date;
    }) => {
      current = setting("DATABASE", {
        credentialRevision: input.revision,
        credentialUpdatedAt: input.updatedAt,
      });
      written.push(current);
      return current;
    },
    disable: async (_actorUserId: string, now: Date) => {
      current = setting("DISABLED", { credentialUpdatedAt: now });
      return current;
    },
  } as unknown as SzamlazzConnectionRepository;

  const credentials = {
    validateRecord: options.validate ?? (() => undefined),
  } as unknown as SzamlazzCredentialProvider;

  return {
    written,
    service: new SzamlazzConnectionService(
      repository,
      new SzamlazzCredentialCryptoService(),
      credentials,
    ),
  };
}

describe("SzamlazzConnectionService állapotai", () => {
  it("says ready, and which path the key came from", async () => {
    const { service: subject } = service({ record: setting("DATABASE") });
    assert.deepEqual(await subject.inspectStoredState(), {
      kind: "ready",
      source: "database",
    });
  });

  it("treats a missing credential as not-configured, not as a failure", async () => {
    const { service: subject } = service({
      record: setting("ENV_FALLBACK"),
      validate: () => {
        throw new SzamlazzConnectionError("SZAMLAZZ_CONNECTION_NOT_CONFIGURED");
      },
    });

    const state = await subject.inspectStoredState();
    assert.equal(state.kind, "not-configured");
    assert.notEqual(state.kind, "credential-corrupt");
  });

  it("tells a corrupt credential apart from a missing one", async () => {
    const { service: subject } = service({
      record: setting("DATABASE"),
      validate: () => {
        throw new SzamlazzConnectionError("SZAMLAZZ_CREDENTIAL_DECRYPT_FAILED");
      },
    });

    const state = await subject.inspectStoredState();
    assert.equal(state.kind, "credential-corrupt");
    assert.equal(
      state.kind === "credential-corrupt" ? state.code : null,
      "SZAMLAZZ_CREDENTIAL_DECRYPT_FAILED",
    );
    assert.notEqual(state.kind, "not-configured");
  });

  it("masks the view when configured, and gives nothing when not", async () => {
    const { service: ready } = service({ record: setting("DATABASE") });
    assert.equal((await ready.getView()).masked, "••••••••");
    assert.equal((await ready.getView()).configured, true);

    const { service: disabled } = service({ record: setting("DISABLED") });
    assert.equal((await disabled.getView()).masked, null);
    assert.equal((await disabled.getView()).configured, false);
  });

  it("refuses to replace the credential when the cooldown is claimed by another request", async () => {
    const { service: subject } = service({ claimed: null });
    await assert.rejects(
      () => subject.replaceCredential("agent-key", "user-1", new Date()),
      /SZAMLAZZ_CONNECTION_COOLDOWN/,
    );
  });

  it("stores the new key at revision+1, and the view reflects it afterwards", async () => {
    const { service: subject, written } = service({
      record: setting("DATABASE", { credentialRevision: 4 }),
    });

    const now = new Date("2026-09-24T18:00:00.000Z");
    const view = await subject.replaceCredential("agent-key", "user-1", now);

    assert.equal(written[0]?.credentialRevision, 5);
    assert.equal(view.configured, true);
    assert.equal(view.modifiedAt, now.toISOString());
  });

  it("disable clears configured/masked", async () => {
    const { service: subject } = service({ record: setting("DATABASE") });
    const view = await subject.disable("user-1", new Date());
    assert.equal(view.configured, false);
    assert.equal(view.masked, null);
  });
});

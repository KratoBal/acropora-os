import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "./medusa-admin.client.js";
import { MedusaConnectionService } from "./medusa-connection.service.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import type { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import {
  MedusaConnectionError,
  type MedusaConnectionSettingRecord,
} from "./medusa-connection.types.js";
import type { MedusaCredentialProvider } from "./medusa-credential.provider.js";

/**
 * A NÉGY ÁLLAPOT mérve, hálózat nélkül.
 *
 * Nem az a kérdés, hogy mind a négy előáll-e, hanem hogy NEM FOLYNAK EGYBE. A
 * legfontosabb a második: egy sérült boríték nem látszhat „még nincs
 * beállítva" állapotnak, mert akkor egy hibás telepítés pontosan úgy nézne ki,
 * mint egy friss.
 */

const setting = (
  mode: MedusaConnectionSettingRecord["credentialMode"],
): MedusaConnectionSettingRecord =>
  ({
    id: "medusa",
    credentialMode: mode,
    credentialRevision: 1,
  }) as MedusaConnectionSettingRecord;

function service(options: {
  record?: MedusaConnectionSettingRecord | null;
  validate?: () => void;
  apiKey?: string;
  probe?: () => Promise<void>;
}) {
  const recorded: {
    status: string;
    code: string | null;
    checkedAt: Date;
  }[] = [];

  const repository = {
    getSetting: async () =>
      options.record === undefined ? setting("DATABASE") : options.record,
    recordVerification: async (input: {
      status: string;
      code: string | null;
      checkedAt: Date;
    }) => {
      recorded.push({
        status: input.status,
        code: input.code,
        checkedAt: input.checkedAt,
      });
      return setting("DATABASE");
    },
  } as unknown as MedusaConnectionRepository;

  const credentials = {
    validateRecord: options.validate ?? (() => undefined),
    resolve: async () => ({
      apiKey: options.apiKey ?? "sk_teszt",
      source: "database" as const,
      revision: "db:1",
    }),
  } as unknown as MedusaCredentialProvider;

  const client = {
    probe: options.probe ?? (async () => undefined),
  } as unknown as MedusaAdminClient;

  return {
    recorded,
    service: new MedusaConnectionService(
      repository,
      credentials,
      new MedusaCredentialCryptoService(),
      () => client,
    ),
  };
}

describe("MedusaConnectionService állapotai", () => {
  it("says ready, and which path the key came from", async () => {
    const { service: subject } = service({ record: setting("ENV_FALLBACK") });

    assert.deepEqual(await subject.probe(), { kind: "ready", source: "env" });
  });

  /**
   * ELSŐ ÁLLAPOT: nincs beállítva. Ez NEM hiba, és külön kell látszania,
   * mert erre az API elindul.
   */
  it("treats a missing credential as not-configured, not as a failure", async () => {
    const { service: subject } = service({
      record: setting("ENV_FALLBACK"),
      validate: () => {
        throw new MedusaConnectionError("MEDUSA_CONNECTION_NOT_CONFIGURED");
      },
    });

    const state = await subject.probe();

    assert.equal(state.kind, "not-configured");
    // És kifejezetten NEM a másik három:
    assert.notEqual(state.kind, "credential-corrupt");
    assert.notEqual(state.kind, "unreachable");
    assert.notEqual(state.kind, "auth-or-permission-failure");
  });

  /**
   * MÁSODIK ÁLLAPOT, és a legfontosabb: a SÉRÜLT boríték. Ez konfigurációs és
   * integritási hiba, tehát nem szabad „még nincs beállítva" állapotnak
   * látszania. Ha ez a kettő egybefolyna, egy hibás telepítés pontosan úgy
   * nézne ki, mint egy friss, és senki nem keresné az okot.
   */
  it("tells a corrupt credential apart from a missing one", async () => {
    const { service: subject } = service({
      record: setting("DATABASE"),
      validate: () => {
        throw new MedusaConnectionError("MEDUSA_CREDENTIAL_DECRYPT_FAILED");
      },
    });

    const state = await subject.probe();

    assert.equal(state.kind, "credential-corrupt");
    assert.equal(
      state.kind === "credential-corrupt" ? state.code : null,
      "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
    );
    assert.notEqual(state.kind, "not-configured");
  });

  /**
   * HARMADIK ÁLLAPOT: nem jött HTTP válasz. Degradált integráció, és nem a
   * kulcsról szól.
   */
  it("treats a network failure as unreachable, not as a bad key", async () => {
    const { service: subject } = service({
      probe: async () => {
        throw new Error("fetch failed");
      },
    });

    const state = await subject.probe();

    assert.equal(state.kind, "unreachable");
    assert.notEqual(state.kind, "auth-or-permission-failure");
    assert.notEqual(state.kind, "credential-corrupt");
  });

  /**
   * NEGYEDIK ÁLLAPOT: a Medusa válaszolt, de elutasított. A `401` és a `403`
   * KÖZÖS néven megy, mert a megkülönböztethetőség nem a kód tulajdonsága,
   * hanem két rajtunk kívül álló beállítás mai állapota.
   */
  it("puts 401 and 403 under one state, and keeps the code as information", async () => {
    for (const status of [401, 403]) {
      const { service: subject } = service({
        probe: async () => {
          throw new MedusaAdminHttpError(status, "{}");
        },
      });

      const state = await subject.probe();

      assert.equal(state.kind, "auth-or-permission-failure");
      assert.equal(
        state.kind === "auth-or-permission-failure" ? state.status : 0,
        status,
      );
      assert.notEqual(state.kind, "unreachable");
    }
  });

  /**
   * A HIBAÜZENET nem állíthatja, hogy rossz a kulcs. Ez Balázs kikötése szó
   * szerint, és azért van rá állítás, mert egy ilyen mondat pontosan addig marad
   * helyes, amíg valaki „egyszerűsíti".
   */
  it("never claims the key is wrong, on either code", async () => {
    for (const status of [401, 403]) {
      const { service: subject } = service({
        probe: async () => {
          throw new MedusaAdminHttpError(status, "{}");
        },
      });

      const state = await subject.probe();
      const detail =
        state.kind === "auth-or-permission-failure" ? state.detail : "";

      assert.match(detail, /NEM jelenti automatikusan/);
      assert.match(detail, /Medusa oldali beállítás változása is okozhatja/);
    }
  });

  /**
   * A HTTP hiba, ami nem hitelesítési: az sem a kulcsról szól, tehát nem
   * kerülhet a közös állapotba.
   */
  it("keeps a 500 out of the auth state", async () => {
    const { service: subject } = service({
      probe: async () => {
        throw new MedusaAdminHttpError(500, "boom");
      },
    });

    const state = await subject.probe();

    assert.equal(state.kind, "unreachable");
    assert.notEqual(state.kind, "auth-or-permission-failure");
  });

  it("records what the probe found, with the shared code on a rejection", async () => {
    const { service: subject, recorded } = service({
      probe: async () => {
        throw new MedusaAdminHttpError(403, "{}");
      },
    });

    const checkedAt = new Date("2026-08-25T12:00:00.000Z");
    await subject.probeAndRecord(checkedAt);

    assert.deepEqual(recorded, [
      {
        status: "FAILED",
        code: "MEDUSA_AUTH_OR_PERMISSION_FAILURE",
        checkedAt,
      },
    ]);
  });

  /**
   * A SIKERES ÁG, AMIT EDDIG SEMMI NEM ŐRZÖTT.
   *
   * A `probeAndRecord` egyetlen állítása a bukó ágra szólt. A sikeres ág
   * ugyanúgy ÍR, csak azt senki nem mérte -- és a 2026-08-26-i lelet éppen
   * arról szólt, hogy a tárolt `verificationStatus` `NEVER` maradt. A mérés
   * szerint a persistálás jó; ez a három állítás azért van itt, hogy ha
   * valaha kiesne, ne egy éles adatbázisból derüljön ki.
   */
  it("writes SUCCESS after a probe the Medusa answered", async () => {
    const { service: subject, recorded } = service({});

    const checkedAt = new Date("2026-08-26T15:40:00.000Z");
    await subject.probeAndRecord(checkedAt);

    assert.deepEqual(recorded, [{ status: "SUCCESS", code: null, checkedAt }]);
  });

  it("writes the moment of the check, not a default", async () => {
    const { service: subject, recorded } = service({});

    const checkedAt = new Date("2026-08-26T15:41:00.000Z");
    await subject.probeAndRecord(checkedAt);

    // A `lastVerifiedAt` a HÍVÁS idejéből jön, nem a repository órájából: így
    // a mérés és a feljegyzett időpont nem csúszhat el egymástól.
    assert.equal(recorded[0]?.checkedAt.toISOString(), checkedAt.toISOString());
  });

  it("leaves no failure code behind after a later success", async () => {
    let reject = true;
    const { service: subject, recorded } = service({
      probe: async () => {
        if (reject) throw new MedusaAdminHttpError(403, "{}");
      },
    });

    await subject.probeAndRecord(new Date("2026-08-26T15:42:00.000Z"));
    reject = false;
    await subject.probeAndRecord(new Date("2026-08-26T15:43:00.000Z"));

    // A sikeres ág `null`-t ír a kódmezőbe. Enélkül a felületen egy régi
    // hibakód maradna egy sikeres ellenőrzés mellett.
    assert.equal(recorded[1]?.status, "SUCCESS");
    assert.equal(recorded[1]?.code, null);
  });

  /**
   * A NEM-RÖGZÍTŐ ÁG, SZÁNDÉKKÉNT KIMONDVA.
   *
   * A „nincs beállítva" állapot nem ír semmit, és ez helyes: nem történt
   * ellenőrzés, tehát `FAILED`-et írni olyan mérést állítana, ami el sem jutott
   * a másik oldalig. Eddig ez sehol nem volt kimondva, csak úgy volt -- és egy
   * ki nem mondott döntés a következő olvasónak véletlennek látszik.
   *
   * Ez az ág EGYÚTTAL nem is tud sikeresnek látszani a felületen: ugyanez az
   * állapot a „Nincs beállítva" jelvényt adja.
   */
  it("records nothing when there was nothing to verify", async () => {
    const { service: subject, recorded } = service({
      record: setting("ENV_FALLBACK"),
      validate: () => {
        throw new MedusaConnectionError("MEDUSA_CONNECTION_NOT_CONFIGURED");
      },
    });

    const state = await subject.probeAndRecord(
      new Date("2026-08-26T15:44:00.000Z"),
    );

    assert.equal(state.kind, "not-configured");
    assert.deepEqual(recorded, []);
  });
});

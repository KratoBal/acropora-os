import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaConfigurationError,
  medusaAdminBaseUrlFromEnv,
  medusaAdminConfigFromEnv,
  medusaClientFromEnvironment,
} from "./medusa-admin.client.js";
import { MedusaConnectionService } from "./medusa-connection.service.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";
import type { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import {
  MedusaConnectionError,
  type MedusaConnectionSettingRecord,
} from "./medusa-connection.types.js";

/**
 * A CÍM és a KULCS szétválasztása, mérve.
 *
 * A javítás előtt a beállítás-olvasó a kettőt együtt követelte meg, a hívó
 * viszont a kulcsot úgyis felülírta a tárolóból. Ép tárolt kulccsal, környezeti
 * kulcs nélkül a próba emiatt „nincs beállítva" állapotot adott: HAMIS
 * állapotot, nem hibát, és pont azon az úton, amit a felület megjelenít.
 */

const STORED = "sk_tarolt_kulcs";
const ENVIRONMENT_KEY = "sk_kornyezeti_kulcs_amit_nem_szabad_hasznalni";

function harness(options: {
  environmentKey?: string;
  validate?: () => void;
  mode?: MedusaConnectionSettingRecord["credentialMode"];
  /**
   * A VALÓDI hitelesítő-szolgáltatót adjuk a próbának, hamis `validate` és
   * hamis `resolve` nélkül. A negatív állításnál pont ez a lényeg: egy
   * hamisított `validate`-tel a hibakód és az állapot közötti LEKÉPEZÉST
   * mérnénk (azt a `medusa-connection.service.spec.ts` már méri), nem azt az
   * utat, amin a hiányzó kulcs valóban „nincs beállítva" állapottá válik.
   */
  realCredentials?: boolean;
}) {
  const seenKeys: string[] = [];

  const setting = {
    id: "medusa",
    credentialMode: options.mode ?? "DATABASE",
    credentialRevision: 1,
  } as MedusaConnectionSettingRecord;

  const repository = {
    getSetting: async () => setting,
    recordVerification: async () => setting,
  } as unknown as MedusaConnectionRepository;

  const crypto = new MedusaCredentialCryptoService();

  const credentials = options.realCredentials
    ? new MedusaCredentialProvider(repository, crypto)
    : ({
        validateRecord: options.validate ?? (() => undefined),
        resolve: async () => ({
          apiKey: STORED,
          source: "database" as const,
          revision: "db:1",
        }),
      } as unknown as MedusaCredentialProvider);

  /**
   * A VALÓDI gyárat hívjuk, csak hamis `fetch`-csel. Az első változatom itt egy
   * saját hamisítványt adott át, és attól a teszt ZÖLD MARADT két olyan rontás
   * mellett is, aminek pirosnak kellett volna lennie: a saját gyáramat mértem,
   * nem a kódét. A kulcsot ezért a KIMENŐ FEJLÉCBŐL olvassuk vissza, mert az az
   * egyetlen hely, ahol az látszik, amit a kliens tényleg használt.
   */
  const factory = (apiKey: string): MedusaAdminClient =>
    medusaClientFromEnvironment(apiKey, process.env, (async (
      _url: string,
      init?: RequestInit,
    ) => {
      /**
       * A KIMENŐ FEJLÉCBŐL olvassuk vissza, mit használt a kliens, nem a
       * paraméterből. Az első változatom a paramétert rögzítette, és attól a
       * mérés zöld maradt egy olyan rontásnál is, ami a fejlécbe csempészte
       * vissza a környezeti kulcsot: a bemenetet mértem, nem a kimenetet.
       */
      const header = (init?.headers as Record<string, string> | undefined)
        ?.authorization;
      const decoded = Buffer.from(
        (header ?? "").replace(/^Basic /, ""),
        "base64",
      ).toString("utf8");
      seenKeys.push(decoded.replace(/:$/, ""));
      return {
        ok: true,
        json: async () => ({ products: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch);

  const before = { ...process.env };
  process.env.MEDUSA_ADMIN_URL = "https://pelda.invalid";
  if (options.environmentKey === undefined)
    delete process.env.MEDUSA_ADMIN_API_KEY;
  else process.env.MEDUSA_ADMIN_API_KEY = options.environmentKey;

  const restore = () => {
    process.env.MEDUSA_ADMIN_URL = before.MEDUSA_ADMIN_URL ?? "";
    if (before.MEDUSA_ADMIN_API_KEY === undefined)
      delete process.env.MEDUSA_ADMIN_API_KEY;
    else process.env.MEDUSA_ADMIN_API_KEY = before.MEDUSA_ADMIN_API_KEY;
  };

  return {
    seenKeys,
    restore,
    service: new MedusaConnectionService(
      repository,
      credentials,
      crypto,
      factory,
    ),
  };
}

describe("Medusa cím és kulcs", () => {
  /**
   * AZ ÚJ ÁLLÍTÁS. Ha a két dolog újra összecsúszik, ennek pirosra kell
   * váltania.
   */
  it("works with a stored key and no environment key at all", async () => {
    const { service, restore } = harness({});

    try {
      assert.deepEqual(await service.probe(), {
        kind: "ready",
        source: "database",
      });
    } finally {
      restore();
    }
  });

  /**
   * A PÁR MÁSIK FELE, szándékosan a pozitív mellett, hogy a kettő egymás alatt
   * legyen olvasható.
   *
   * A fenti állítás azt bizonyítja, hogy a tárolt kulcs MŰKÖDIK. Ez azt, hogy a
   * kulcs HIÁNYA TOVÁBBRA IS LÁTSZIK. Egy pozitív eset önmagában akkor is zöld
   * maradna, ha a kód mindenre „ready" állapotot mondana, és pont ez a másik
   * irány: reggel a hamis „nincs beállítva" volt a hiba egy ép kulcsra, most azt
   * kell őrizni, hogy a hiányból ne legyen hamis „ready".
   *
   * Az indulási állapot a NINCS TÁROLT KULCS: `ENV_FALLBACK` mód, és mellé
   * környezeti kulcs sincs. FALSZIFIKÁCIÓ: ha ez az ág „ready"-t adna, ennek az
   * egy állításnak pirosra kell váltania, a többi ötnek zölden kell maradnia.
   */
  it("stays not-configured with neither a stored key nor an environment key", async () => {
    const { service, seenKeys, restore } = harness({
      mode: "ENV_FALLBACK",
      realCredentials: true,
    });

    try {
      const state = await service.probe();
      assert.equal(state.kind, "not-configured");
      assert.notEqual(state.kind, "ready");
      /** És kifelé nem is indult kérés: nem volt mivel. */
      assert.deepEqual(seenKeys, []);
    } finally {
      restore();
    }
  });

  /**
   * A NEGYEDIK, és a legkönnyebben elrontható: a környezeti kulcs ÉRTÉKE akkor
   * sem használódhat fel, ha véletlenül ott áll. A szétválasztás közben könnyű
   * visszacsempészni egy env-olvasást, és utána minden zöld maradna.
   */
  it("uses the stored key even when an environment key is present", async () => {
    const { service, seenKeys, restore } = harness({
      environmentKey: ENVIRONMENT_KEY,
    });

    try {
      await service.probe();
      assert.deepEqual(seenKeys, [STORED]);
      assert.equal(seenKeys.includes(ENVIRONMENT_KEY), false);
    } finally {
      restore();
    }
  });

  /** A CÍM viszont tényleg kell, és a hiánya továbbra is hiba. */
  it("still refuses to work without a base url", () => {
    assert.throws(
      () => medusaAdminBaseUrlFromEnv({}),
      (error: unknown) =>
        error instanceof MedusaConfigurationError &&
        /MEDUSA_ADMIN_URL/.test(error.message),
    );
    assert.equal(
      medusaAdminBaseUrlFromEnv({ MEDUSA_ADMIN_URL: "https://pelda.invalid/" }),
      "https://pelda.invalid",
    );
  });

  /**
   * A teljes beállítás-olvasó megmarad a parancssori vetítésnek, ahol a
   * környezeti kulcs valóban használatban van. Ott a hiánya joggal hiba.
   */
  it("keeps requiring both for the command line path", () => {
    assert.throws(
      () => medusaAdminConfigFromEnv({ MEDUSA_ADMIN_URL: "https://x.invalid" }),
      (error: unknown) =>
        error instanceof MedusaConfigurationError &&
        /MEDUSA_ADMIN_API_KEY/.test(error.message),
    );
    assert.deepEqual(
      medusaAdminConfigFromEnv({
        MEDUSA_ADMIN_URL: "https://x.invalid",
        MEDUSA_ADMIN_API_KEY: "sk_a",
      }),
      { baseUrl: "https://x.invalid", apiKey: "sk_a" },
    );
  });

  /**
   * A HARMADIK: a sérült adat viselkedése NEM változhat. Ez a ma délután
   * bizonyított állítás, és a szétválasztás nem nyúlhat hozzá.
   */
  it("leaves the corrupt-credential behaviour untouched", async () => {
    const { service, restore } = harness({
      environmentKey: ENVIRONMENT_KEY,
      validate: () => {
        throw new MedusaConnectionError("MEDUSA_CREDENTIAL_DECRYPT_FAILED");
      },
    });

    try {
      const state = await service.probe();
      assert.equal(state.kind, "credential-corrupt");
      assert.notEqual(state.kind, "not-configured");
      assert.notEqual(state.kind, "ready");
    } finally {
      restore();
    }
  });
});

import { Injectable, Logger, Optional } from "@nestjs/common";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
  type MedusaAdminClient,
  MedusaConfigurationError,
  medusaAdminConfigFromEnv,
} from "./medusa-admin.client.js";
import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import {
  MedusaConnectionError,
  type MedusaConnectionSettingRecord,
  type MedusaIntegrationState,
  type MedusaStoredState,
} from "./medusa-connection.types.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import type { MedusaConnectionView } from "@acropora/types";

/**
 * A Medusa kapcsolat ÁLLAPOTA, egy ártalmatlan olvasó kéréssel megmérve.
 *
 * Amit a próba csinál: EGYETLEN olvasó kérés, `limit=1`, írás nulla. Ugyanaz a
 * hívás, amivel a kör méréseit is végeztük, és szándékosan a legkevesebb, ami
 * még bizonyít valamit: ha erre válasz jön, a hálózat áll és a hitelesítés
 * eldőlt.
 */
@Injectable()
export class MedusaConnectionService {
  private readonly logger = new Logger(MedusaConnectionService.name);

  /**
   * A kliens GYÁRA azért paraméter, hogy a négy állapot mérhető legyen hálózat
   * nélkül. Ugyanaz az indok, amiért a `fetch` is paraméter a kliensben: egy
   * állapot, amit csak élesben lehet előállítani, nem is bizonyítható.
   */
  constructor(
    private readonly repository: MedusaConnectionRepository,
    private readonly credentials: MedusaCredentialProvider,
    private readonly crypto: MedusaCredentialCryptoService,
    /**
     * `@Optional()`, mert a Nest különben INJEKTÁLNI próbálná: egy függvény-típusra
     * nincs szolgáltatója, és az alkalmazás a teljes függőségi gráf építésekor
     * hasalna el. Ezt a bootstrap teszt fogta meg, még a beküldés előtt.
     */
    @Optional()
    private readonly clientFactory: (apiKey: string) => MedusaAdminClient = (
      apiKey,
    ) =>
      new HttpMedusaAdminClient({
        ...medusaAdminConfigFromEnv(process.env),
        apiKey,
      }),
  ) {}

  /**
   * A TÁROLT állapot vizsgálata, HÁLÓZAT NÉLKÜL.
   *
   * Ezt hívja az indulás is, és pontosan azért nem hív hálózatot, mert a másik
   * oldal elérhetetlensége nem akadályozhatja meg az API indulását. Amit ez
   * eldönt: van-e egyáltalán hitelesítő adat, és ha van, ép-e.
   */
  async inspectStoredState(): Promise<MedusaStoredState> {
    const setting = await this.repository.getSetting();
    if (!setting)
      return {
        kind: "credential-corrupt",
        code: "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
      };

    try {
      this.credentials.validateRecord(setting);
    } catch (error) {
      if (error instanceof MedusaConnectionError) {
        /**
         * A KÜLÖNBSÉG, amiért ez a szakasz létezik. A „nincs beállítva" és a
         * „le van tiltva" eset nem hiba: egy friss telepítés így néz ki. Minden
         * más viszont igen, és nem szabad ugyanúgy látszania.
         */
        if (
          error.code === "MEDUSA_CONNECTION_NOT_CONFIGURED" ||
          error.code === "MEDUSA_CONNECTION_DISABLED"
        )
          return { kind: "not-configured" };
        return { kind: "credential-corrupt", code: error.code };
      }
      throw error;
    }

    if (setting.credentialMode === "DISABLED")
      return { kind: "not-configured" };
    return {
      kind: "ready",
      source: setting.credentialMode === "DATABASE" ? "database" : "env",
    };
  }

  /**
   * ÁRTALMATLAN OLVASÓ PRÓBA a Medusa felé.
   *
   * Egyetlen kérés, `limit=1`, írás nulla. A visszaadott állapot NEM állítja,
   * hogy rossz a kulcs: a `401` és a `403` közös néven megy, és az üzenet
   * mindkét lehetséges okot kimondja.
   */
  async probe(): Promise<MedusaIntegrationState> {
    const stored = await this.inspectStoredState();
    if (stored.kind !== "ready") return stored;

    let apiKey: string;
    try {
      apiKey = (await this.credentials.resolve()).apiKey;
    } catch (error) {
      if (error instanceof MedusaConnectionError)
        return { kind: "credential-corrupt", code: error.code };
      throw error;
    }

    let client: MedusaAdminClient;
    try {
      client = this.clientFactory(apiKey);
    } catch (error) {
      if (error instanceof MedusaConfigurationError)
        return { kind: "not-configured" };
      throw error;
    }

    try {
      await client.probe();
      return stored;
    } catch (error) {
      if (error instanceof MedusaAdminHttpError) {
        if (error.status === 401 || error.status === 403)
          return {
            kind: "auth-or-permission-failure",
            status: error.status,
            detail: describeAuthFailure(error.status),
          };
        return {
          kind: "unreachable",
          detail: `A Medusa ${error.status} kóddal válaszolt.`,
        };
      }
      /**
       * Hálózati hiba: nem jött HTTP válasz. Ez degradált integráció, nem
       * leállás, és NEM a kulcsról szól.
       */
      return {
        kind: "unreachable",
        detail:
          error instanceof Error
            ? `A Medusa nem érhető el: ${error.message}`
            : "A Medusa nem érhető el.",
      };
    }
  }

  /**
   * Amit a FELÜLET kaphat. A kulcs nincs benne, és nem is lehet: `masked` van,
   * érték nincs. Az állapot ugyanaz, amit a modul ad, nem egy felület-specifikus
   * másolat: ha itt új nevet adnánk, ugyanannak a dolognak két neve lenne.
   */
  async getView(): Promise<MedusaConnectionView> {
    const setting = await this.repository.getSetting();
    const state = await this.inspectStoredState();
    return this.viewOf(setting, state);
  }

  /**
   * Kulcs beállítása vagy cseréje.
   *
   * A visszatartás ELŐBB fut, mint a titkosítás: egy elgépelt kulcs újbóli
   * beírása így nem terheli sem a másik oldalt, sem a saját tárolónkat. A
   * mentés után a próba is lefut, hogy a felhasználó ne a következő
   * művelet közben tudja meg, hogy amit beírt, nem használható.
   */
  async replaceCredential(
    apiKey: string,
    actorUserId: string,
    now: Date,
  ): Promise<MedusaConnectionView> {
    const claimed = await this.repository.claimCooldown("credential");
    if (!claimed) throw new MedusaConnectionError("MEDUSA_CONNECTION_COOLDOWN");

    const revision = claimed.credentialRevision + 1;
    const envelope = this.crypto.encrypt(apiKey.trim(), revision);
    await this.repository.replaceCredential({
      envelope,
      revision,
      actorUserId,
      updatedAt: now,
    });

    const state = await this.probeAndRecord(now);
    return this.viewOf(await this.repository.getSetting(), state);
  }

  async disable(actorUserId: string, now: Date): Promise<MedusaConnectionView> {
    const setting = await this.repository.disable(actorUserId, now);
    return this.viewOf(setting, { kind: "not-configured" });
  }

  /** A tárolt kulcs kipróbálása a felületről, visszatartással. */
  async testStoredCredential(now: Date): Promise<MedusaConnectionView> {
    const claimed = await this.repository.claimCooldown("test");
    if (!claimed) throw new MedusaConnectionError("MEDUSA_CONNECTION_COOLDOWN");

    const state = await this.probeAndRecord(now);
    return this.viewOf(await this.repository.getSetting(), state);
  }

  /**
   * A nézet összeállítása. Egyetlen helyen, mert a maszkolás olyan szabály,
   * aminek nem szabad két változatban léteznie.
   */
  private viewOf(
    setting: MedusaConnectionSettingRecord | null,
    state: MedusaIntegrationState,
  ): MedusaConnectionView {
    const configured = setting?.credentialMode === "DATABASE";
    return {
      configured,
      masked: configured ? "••••••••" : null,
      modifiedAt: setting?.credentialUpdatedAt?.toISOString() ?? null,
      state: {
        kind: state.kind,
        source: state.kind === "ready" ? state.source : null,
        detail:
          state.kind === "auth-or-permission-failure" ||
          state.kind === "unreachable"
            ? state.detail
            : null,
        status:
          state.kind === "auth-or-permission-failure" ? state.status : null,
      },
      verification: {
        status: setting?.verificationStatus ?? "NEVER",
        checkedAt: setting?.lastVerifiedAt?.toISOString() ?? null,
        code: setting?.lastVerificationCode ?? null,
      },
    };
  }

  /** A próba eredményének rögzítése, hogy a felület is lássa. */
  async probeAndRecord(now: Date): Promise<MedusaIntegrationState> {
    const state = await this.probe();
    if (state.kind === "ready") {
      await this.repository.recordVerification({
        status: "SUCCESS",
        code: null,
        checkedAt: now,
      });
      return state;
    }
    if (state.kind === "not-configured") return state;

    await this.repository.recordVerification({
      status:
        state.kind === "auth-or-permission-failure"
          ? "FAILED"
          : "INDETERMINATE",
      code:
        state.kind === "credential-corrupt"
          ? state.code
          : state.kind === "auth-or-permission-failure"
            ? "MEDUSA_AUTH_OR_PERMISSION_FAILURE"
            : null,
      checkedAt: now,
    });
    return state;
  }
}

/**
 * A hibaüzenet, ami NEM állítja, hogy rossz a kulcs.
 *
 * Balázs kikötése szó szerint: egyik hibakód sem jelentheti automatikusan, hogy
 * a hitelesítő adat romlott el, amíg az ok egyértelműsége nincs bizonyítva. A
 * valószínű okot ezért valószínűként mondjuk ki, és a másik lehetőséget is
 * megnevezzük ugyanabban a mondatban.
 */
export function describeAuthFailure(status: number): string {
  const shared =
    "Ez NEM jelenti automatikusan, hogy a kulcs rossz: ugyanezt a választ a " +
    "Medusa oldali beállítás változása is okozhatja.";
  if (status === 403)
    return (
      "A Medusa elutasította a kérést (403). A hitelesítés sikerült, a " +
      "jogosultság-ellenőrzés utasított el, ezért a legvalószínűbb ok az, hogy " +
      "a Medusán bekapcsolták a jogosultsági rendszert. " +
      shared
    );
  return (
    "A Medusa elutasította a kérést (401). A legvalószínűbb ok az, hogy a " +
    "hitelesítő adat nem használható, de a Medusa saját belső hibája is " +
    "ugyanezt a választ adja. " +
    shared
  );
}

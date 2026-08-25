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
  type MedusaIntegrationState,
  type MedusaStoredState,
} from "./medusa-connection.types.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";

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

import { Injectable } from "@nestjs/common";
import type { SzamlazzConnectionView } from "@acropora/types";

import { SzamlazzConnectionRepository } from "./szamlazz-connection.repository.js";
import {
  SzamlazzConnectionError,
  type SzamlazzConnectionErrorCode,
  type SzamlazzConnectionSettingRecord,
} from "./szamlazz-connection.types.js";
import { SzamlazzCredentialCryptoService } from "./szamlazz-credential-crypto.service.js";
import { SzamlazzCredentialProvider } from "./szamlazz-credential.provider.js";

/**
 * Amit a TÁROLT adatból el lehet dönteni, hálózat nélkül -- a Medusa
 * `MedusaStoredState` mintája, a hálózatos ágak (probe) nélkül, mert
 * azok itt nem léteznek (lásd a class doc-commentjét).
 */
export type SzamlazzStoredState =
  | { kind: "ready"; source: "database" | "env" }
  | { kind: "not-configured" }
  | { kind: "credential-corrupt"; code: SzamlazzConnectionErrorCode };

/**
 * A Számlázz.hu Agent Key beállítása és letiltása.
 *
 * SZÁNDÉKOSAN NINCS `probe()`/`testStoredCredential()`, szemben a Medusa
 * kapcsolat-service-szel: a Medusánál ez egy ártalmatlan, ingyenes olvasó
 * kérés (`limit=1`), a Számlázz.hu Agent API-nak nincs ilyen próba-végpontja.
 * Egy automatikus "kipróbálom mentés után" lépés itt VALÓDI hívást
 * jelentene a másik fél felé -- pontosan azt, amit acrobot kikötése szerint
 * Balázs előzetes értesítése nélkül nem szabad elsütni. A kulcs
 * kipróbálása ezért a piszkozat-készítés felelőssége, nem ezé a
 * szolgáltatásé.
 */
@Injectable()
export class SzamlazzConnectionService {
  constructor(
    private readonly repository: SzamlazzConnectionRepository,
    private readonly crypto: SzamlazzCredentialCryptoService,
    private readonly credentials: SzamlazzCredentialProvider,
  ) {}

  /**
   * A TÁROLT állapot vizsgálata, HÁLÓZAT NÉLKÜL -- a Medusa
   * `inspectStoredState` mintája. Ezt hívja az induláskori vizsgálat.
   */
  async inspectStoredState(): Promise<SzamlazzStoredState> {
    const setting = await this.repository.getSetting();
    if (!setting)
      return {
        kind: "credential-corrupt",
        code: "SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING",
      };

    try {
      this.credentials.validateRecord(setting);
    } catch (error) {
      if (error instanceof SzamlazzConnectionError) {
        if (
          error.code === "SZAMLAZZ_CONNECTION_NOT_CONFIGURED" ||
          error.code === "SZAMLAZZ_CONNECTION_DISABLED"
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

  /** Amit a FELÜLET kaphat. A kulcs nincs benne, és nem is lehet. */
  async getView(): Promise<SzamlazzConnectionView> {
    const setting = await this.repository.getSetting();
    return this.viewOf(setting);
  }

  /**
   * Kulcs beállítása vagy cseréje. A visszatartás ELŐBB fut, mint a
   * titkosítás: egy elgépelt kulcs újbóli beírása így nem terheli a
   * tárolónkat.
   */
  async replaceCredential(
    agentKey: string,
    actorUserId: string,
    now: Date,
  ): Promise<SzamlazzConnectionView> {
    const claimed = await this.repository.claimCredentialCooldown();
    if (!claimed)
      throw new SzamlazzConnectionError("SZAMLAZZ_CONNECTION_COOLDOWN");

    const revision = claimed.credentialRevision + 1;
    const envelope = this.crypto.encrypt(agentKey.trim(), revision);
    const setting = await this.repository.replaceCredential({
      envelope,
      revision,
      actorUserId,
      updatedAt: now,
    });
    return this.viewOf(setting);
  }

  async disable(
    actorUserId: string,
    now: Date,
  ): Promise<SzamlazzConnectionView> {
    const setting = await this.repository.disable(actorUserId, now);
    return this.viewOf(setting);
  }

  private viewOf(
    setting: SzamlazzConnectionSettingRecord | null,
  ): SzamlazzConnectionView {
    const configured = setting?.credentialMode === "DATABASE";
    return {
      configured,
      masked: configured ? "••••••••" : null,
      modifiedAt: setting?.credentialUpdatedAt?.toISOString() ?? null,
    };
  }
}

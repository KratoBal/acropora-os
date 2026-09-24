import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { SzamlazzConnectionService } from "./szamlazz-connection.service.js";

/**
 * Induláskori vizsgálat, HÁLÓZAT NÉLKÜL -- a Medusa
 * `MedusaConnectionStartupValidator` mintája. Lásd ott a doc-commentet a
 * "nincs beállítva" és a "sérült" eset közti KÜLÖNBSÉG indoklásáért.
 *
 * A "sérült" eset itt sem állítja meg az indulást, ugyanazért az okért,
 * amiért a Medusánál sem: a legkevésbé kritikus integráció hibája nem
 * állíthatja le a legkritikusabbakat.
 */
@Injectable()
export class SzamlazzConnectionStartupValidator implements OnModuleInit {
  private readonly logger = new Logger(SzamlazzConnectionStartupValidator.name);

  constructor(private readonly connection: SzamlazzConnectionService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;

    const state = await this.connection.inspectStoredState();

    if (state.kind === "not-configured") {
      this.logger.warn(
        "A Számlázz.hu Agent Key még nincs beállítva. Az API elindul, a " +
          "karbantartási piszkozat-számla addig nem hozható létre. " +
          "Beállítani a Beállítások oldalon lehet.",
      );
      return;
    }

    if (state.kind === "credential-corrupt") {
      this.logger.error(
        `A tárolt Számlázz.hu Agent Key nem használható (${state.code}). ` +
          "Ez konfigurációs és integritási hiba. Az API elindul, de a " +
          "karbantartási piszkozat-számla sérült állapotban marad, amíg a " +
          "hitelesítő adatot nem javítják a Beállítások oldalon.",
      );
      return;
    }

    this.logger.log(
      state.source === "database"
        ? "A Számlázz.hu Agent Key a tárolóból jön."
        : "A Számlázz.hu Agent Key a KÖRNYEZETI VÁLTOZÓBÓL jön (tartalék " +
            "út). Ez átmeneti állapot: amíg így megy, a titok a folyamat " +
            "környezetében él.",
    );
  }
}

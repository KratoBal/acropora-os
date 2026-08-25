import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { MedusaConnectionService } from "./medusa-connection.service.js";

/**
 * Induláskori vizsgálat, HÁLÓZAT NÉLKÜL.
 *
 * A négy állapotból kettő dől el itt, és a KÜLÖNBSÉGÜK a lényeg:
 *
 * - **nincs beállítva**: az API elindul, csak a Medusa nem megy. Egy friss
 *   telepítés pontosan így néz ki, és az nem hiba;
 * - **sérült vagy vissza nem fejthető tárolt adat**: konfigurációs és
 *   integritási HIBA, ami MEGÁLLÍTJA az indulást. Ez nem szigor: egy ilyen
 *   állapotban az API elindulna, a Medusa-hívások pedig menet közben, kérésről
 *   kérésre buknának el, és senki nem tudná megmondani, mióta.
 *
 * A másik kettő (elérhetetlenség, hitelesítési vagy jogosultsági bukás) SZÁNDÉKOSAN
 * nem itt dől el: azokhoz hálózat kell, és a másik oldal állapota nem
 * akadályozhatja meg a mi indulásunkat. Azokat a próba méri, futás közben.
 */
@Injectable()
export class MedusaConnectionStartupValidator implements OnModuleInit {
  private readonly logger = new Logger(MedusaConnectionStartupValidator.name);

  constructor(private readonly connection: MedusaConnectionService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;

    const state = await this.connection.inspectStoredState();

    if (state.kind === "not-configured") {
      this.logger.warn(
        "A Medusa kapcsolat még nincs beállítva. Az API elindul, a Medusa-vetítés " +
          "addig nem működik. Beállítani a Beállítások oldalon lehet.",
      );
      return;
    }

    if (state.kind === "credential-corrupt") {
      /**
       * Hangosan, és az indulást megállítva. A kód a naplóba is bekerül, mert
       * ebből derül ki, MELYIK lépés bukott: hiányzó mesterkulcs, rossz
       * kulcsverzió vagy sérült boríték.
       */
      this.logger.error(
        `A tárolt Medusa hitelesítő adat nem használható (${state.code}). ` +
          "Ez konfigurációs és integritási hiba: az API nem indul el, hogy ne " +
          "kérésenként derüljön ki.",
      );
      throw new Error(state.code);
    }

    this.logger.log(
      state.source === "database"
        ? "A Medusa hitelesítő adat a tárolóból jön."
        : "A Medusa hitelesítő adat a KÖRNYEZETI VÁLTOZÓBÓL jön (tartalék út). " +
            "Ez átmeneti állapot: amíg így megy, a titok a folyamat környezetében él.",
    );
  }
}

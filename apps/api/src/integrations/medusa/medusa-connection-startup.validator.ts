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
       * HANGOSAN, de az indulást NEM megállítva.
       *
       * Ez korábban dobott, az UNAS mintájára, és a hatókör mérve az volt, hogy
       * az EGÉSZ API nem indul el: bejelentkezés, POS, UNAS-szinkron, NAV,
       * munkalapok. Vagyis a legkevésbé kritikus integrációnk hibája állította
       * volna le a legkritikusabbakat, miközben a Medusa-vetítés kézzel indul.
       *
       * A blokkolás értéke abból jött, hogy a sérült adat ne maradjon
       * észrevétlen. Azt viszont már az integráció ÁLLAPOTA megoldja: a
       * `credential-corrupt` külön eset, a felület megjeleníti, és minden
       * Medusa-művelet visszautasít. A blokkolás tehát nem az egyetlen hangos
       * jelzés többé, az ára viszont változatlanul az egész bolt volt.
       *
       * Amit ez a döntés NEM lazít: sérült adat mellett nincs visszaesés a
       * környezeti változóra. Az a tiltás független attól, hogy megállunk-e.
       */
      this.logger.error(
        `A tárolt Medusa hitelesítő adat nem használható (${state.code}). ` +
          "Ez konfigurációs és integritási hiba. Az API elindul, de a Medusa " +
          "integráció sérült állapotban marad, és minden Medusa-művelet " +
          "visszautasít, amíg a hitelesítő adatot nem javítják a Beállítások " +
          "oldalon. A rendszer NEM esik vissza a környezeti változóra.",
      );
      return;
    }

    this.logger.log(
      state.source === "database"
        ? "A Medusa hitelesítő adat a tárolóból jön."
        : "A Medusa hitelesítő adat a KÖRNYEZETI VÁLTOZÓBÓL jön (tartalék út). " +
            "Ez átmeneti állapot: amíg így megy, a titok a folyamat környezetében él.",
    );
  }
}

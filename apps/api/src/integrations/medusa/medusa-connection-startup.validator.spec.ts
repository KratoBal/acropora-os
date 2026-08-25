import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MedusaConnectionStartupValidator } from "./medusa-connection-startup.validator.js";
import type { MedusaConnectionService } from "./medusa-connection.service.js";
import type { MedusaStoredState } from "./medusa-connection.types.js";

/**
 * AZ INDULÁS viselkedése, a négy állapot közül a kettőre, ami itt dől el.
 *
 * Az új állítás az elsőben van: egy SÉRÜLT tárolt hitelesítő adat többé nem
 * állítja meg az API indulását. Ez mért döntés, nem kényelem: a hatókör az
 * EGÉSZ alkalmazás volt (bejelentkezés, POS, UNAS-szinkron, NAV, munkalapok),
 * miközben a Medusa-vetítés kézzel indul és nincs ütemezője.
 *
 * A régi állítás viszont zölden marad: a sérült adat NEM olvad össze a „még
 * nincs beállítva" esettel. A változtatás egyiket sem tehette a másikká.
 */

function validator(state: MedusaStoredState) {
  const logged: { level: "error" | "warn" | "log"; message: string }[] = [];
  const connection = {
    inspectStoredState: async () => state,
  } as unknown as MedusaConnectionService;

  const subject = new MedusaConnectionStartupValidator(connection);
  // A naplózás a hangosság egyetlen bizonyítéka, ezért mérjük, nem elnyeljük.
  Object.assign(subject as unknown as Record<string, unknown>, {
    logger: {
      error: (message: string) => logged.push({ level: "error", message }),
      warn: (message: string) => logged.push({ level: "warn", message }),
      log: (message: string) => logged.push({ level: "log", message }),
    },
  });

  return { subject, logged };
}

async function inProduction<T>(run: () => Promise<T>): Promise<T> {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
}

describe("Medusa induláskori vizsgálat", () => {
  /**
   * AZ ÚJ ÁLLÍTÁS. Ha valaki visszateszi a dobást, ennek pirosra kell váltania.
   */
  it("starts the API even when the stored credential is corrupt", async () => {
    const { subject } = validator({
      kind: "credential-corrupt",
      code: "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
    });

    await inProduction(async () => {
      await assert.doesNotReject(() => subject.onModuleInit());
    });
  });

  /**
   * A HANGOSSÁG az, ami a blokkolás helyébe lép, tehát nem elhagyható: a
   * hibakódnak ki kell kerülnie, mert abból derül ki, MELYIK lépés bukott.
   */
  it("says out loud what broke, with the code in the message", async () => {
    const { subject, logged } = validator({
      kind: "credential-corrupt",
      code: "MEDUSA_CREDENTIAL_MASTER_KEY_INVALID",
    });

    await inProduction(() => subject.onModuleInit());

    const error = logged.find((entry) => entry.level === "error");
    assert.ok(error, "sérült hitelesítő adatnál hibaszintű naplósor kell");
    assert.match(error.message, /MEDUSA_CREDENTIAL_MASTER_KEY_INVALID/);
    /**
     * És kimondja azt is, hogy NINCS visszaesés a környezeti változóra. Ez a
     * legkönnyebben elrontható rész, mert a „van env, használjuk" reflexből
     * jön, és a szöveg az egyetlen hely, ahol ez az olvasó elé kerül.
     */
    assert.match(error.message, /NEM esik vissza a környezeti változóra/);
  });

  /**
   * A RÉGI ÁLLÍTÁS, aminek zölden kell maradnia: a két állapot nem olvadhat
   * össze. Egy sérült telepítés nem nézhet ki friss telepítésnek.
   */
  it("keeps a corrupt credential apart from a missing one", async () => {
    const corrupt = validator({
      kind: "credential-corrupt",
      code: "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
    });
    const missing = validator({ kind: "not-configured" });

    await inProduction(() => corrupt.subject.onModuleInit());
    await inProduction(() => missing.subject.onModuleInit());

    assert.equal(
      corrupt.logged.find((entry) => entry.level === "error") !== undefined,
      true,
      "a sérült adat hibaszintű sort kap",
    );
    assert.equal(
      missing.logged.find((entry) => entry.level === "error"),
      undefined,
      "a hiányzó beállítás NEM hiba, tehát nem kaphat hibaszintű sort",
    );
    assert.equal(
      missing.logged.find((entry) => entry.level === "warn") !== undefined,
      true,
      "a hiányzó beállítás figyelmeztetés marad",
    );
  });

  /**
   * A TARTALÉK ÚT nem lehet néma akkor sem, amikor minden rendben van: ha a
   * kulcs a környezeti változóból jön, azt az indulás kimondja.
   */
  it("announces the environment fallback instead of treating it as normal", async () => {
    const { subject, logged } = validator({ kind: "ready", source: "env" });

    await inProduction(() => subject.onModuleInit());

    const line = logged.find((entry) => entry.level === "log");
    assert.ok(line);
    assert.match(line.message, /KÖRNYEZETI VÁLTOZÓBÓL/);
    assert.match(line.message, /átmeneti/);
  });
});

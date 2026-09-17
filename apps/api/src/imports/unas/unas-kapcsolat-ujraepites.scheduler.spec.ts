import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ujraepitesScheduleConfig,
  UnasKapcsolatUjraepitesScheduler,
  type UjraepitesSchedulerDeps,
} from "./unas-kapcsolat-ujraepites.scheduler.js";

const BEKAPCSOLVA = { UNAS_RELATION_REBUILD_SCHEDULE_ENABLED: "true" };

function ido(nap: number, ora: number): Date {
  return new Date(2026, 8, nap, ora, 0, 0, 0);
}

/**
 * AZ UTEMEZO MERHETO RESZEI. A `hivasok` azert tomb, es nem szamlalo, mert a
 * KAPOTT ARGUMENTUMOKRA is allitas all: az egyik legfontosabb allitasunk az,
 * hogy MI NINCS benne.
 */
function utemezo(
  environment: Record<string, string>,
  opciok: {
    most?: Date;
    utolsoFutasKezdete?: Date | null;
    kod?: number;
  } = {},
) {
  const hivasok: string[][] = [];
  const naplo = { sorok: [] as string[] };
  const deps: UjraepitesSchedulerDeps = {
    environment: environment as NodeJS.ProcessEnv,
    most: () => opciok.most ?? ido(17, 3),
    db: {
      utolsoFutasKezdete: async () => opciok.utolsoFutasKezdete ?? null,
    },
    runRebuild: async (argv) => {
      hivasok.push([...argv]);
      return opciok.kod ?? 0;
    },
    logger: {
      log: (uzenet) => naplo.sorok.push(uzenet),
      warn: (uzenet) => naplo.sorok.push(uzenet),
      error: (uzenet) => naplo.sorok.push(uzenet),
    },
  };
  return {
    scheduler: new UnasKapcsolatUjraepitesScheduler(deps),
    hivasok,
    naplo,
  };
}

describe("kapcsolat-újraépítés ütemezője", () => {
  describe("beállítás", () => {
    it("kapcsoló nélkül kikapcsolt", () => {
      assert.equal(ujraepitesScheduleConfig({}).enabled, false);
    });

    it("az alapértelmezés csendes ablak, terv-mód, késleltetett indulás", () => {
      const config = ujraepitesScheduleConfig(BEKAPCSOLVA as NodeJS.ProcessEnv);
      assert.equal(config.enabled, true);
      // AZ IRAS KULON KAPCSOLO: a bekapcsolt utemezo magatol NEM ir.
      assert.equal(config.apply, false);
      assert.equal(config.ablakKezdoOra, 2);
      assert.equal(config.ablakZaroOra, 5);
      assert.equal(config.startupDelayMs, 300_000);
      assert.equal(config.checkIntervalMs, 15 * 60_000);
    });

    it("az éjfélt átlépő ablakot elutasítja", () => {
      assert.throws(
        () =>
          ujraepitesScheduleConfig({
            ...BEKAPCSOLVA,
            UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_START_HOUR: "23",
            UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_END_HOUR: "2",
          } as NodeJS.ProcessEnv),
        /UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_INVALID/,
      );
    });

    it("a tartományon kívüli késleltetést elutasítja", () => {
      assert.throws(
        () =>
          ujraepitesScheduleConfig({
            ...BEKAPCSOLVA,
            UNAS_RELATION_REBUILD_SCHEDULE_STARTUP_DELAY_SECONDS: "99999",
          } as NodeJS.ProcessEnv),
        /STARTUP_DELAY_INVALID/,
      );
    });
  });

  describe("egy ébredés", () => {
    it("az ablakon kívül nem futtat semmit", async () => {
      const { scheduler, hivasok } = utemezo(BEKAPCSOLVA, {
        most: ido(17, 12),
      });
      assert.equal(await scheduler.runOnce(), "SKIPPED");
      assert.deepEqual(hivasok, []);
    });

    it("ha ma már futott, nem futtat újra", async () => {
      const { scheduler, hivasok } = utemezo(BEKAPCSOLVA, {
        most: ido(17, 3),
        utolsoFutasKezdete: ido(17, 2),
      });
      assert.equal(await scheduler.runOnce(), "SKIPPED");
      assert.deepEqual(hivasok, []);
    });

    /**
     * A POZITIV KONTROLL A KET FENTI ALLITASHOZ. Enelkul mind a ketto zold
     * maradna attol is, ha az utemezo SOSEM futtatna semmit.
     */
    it("az ablakban, ma még futás nélkül lefuttatja", async () => {
      const { scheduler, hivasok } = utemezo(BEKAPCSOLVA, {
        most: ido(17, 3),
        utolsoFutasKezdete: ido(16, 3),
      });
      assert.equal(await scheduler.runOnce(), "APPLIED");
      assert.equal(hivasok.length, 1);
    });

    it("apply kapcsoló nélkül tervet futtat", async () => {
      const { scheduler, hivasok } = utemezo(BEKAPCSOLVA);
      await scheduler.runOnce();
      assert.deepEqual(hivasok, [[]]);
    });

    it("apply kapcsolóval írásra indít", async () => {
      const { scheduler, hivasok } = utemezo({
        ...BEKAPCSOLVA,
        UNAS_RELATION_REBUILD_SCHEDULE_APPLY: "true",
      });
      await scheduler.runOnce();
      assert.deepEqual(hivasok, [["--apply"]]);
    });

    /**
     * acrobot NEGYEDIK KIKOTESE, ALLITAS ALAKJABAN: egy nagy valtozasnal
     * megallunk, nem megyunk tovabb. Az utemezo ezt ugy tartja be, hogy a
     * `--nagy-valtozas-is` kapcsolot SEMMILYEN beallitas mellett nem adja at
     * -- a hatar atlepese kimondas, es kimondani embernek kell.
     */
    it("a nagy változás átengedését soha nem adja át", async () => {
      for (const environment of [
        BEKAPCSOLVA,
        { ...BEKAPCSOLVA, UNAS_RELATION_REBUILD_SCHEDULE_APPLY: "true" },
      ]) {
        const { scheduler, hivasok } = utemezo(environment);
        await scheduler.runOnce();
        assert.equal(hivasok.length, 1);
        assert.ok(
          !hivasok[0]!.includes("--nagy-valtozas-is"),
          `átadta: ${hivasok[0]!.join(" ")}`,
        );
      }
    });

    it("a megállást külön kimenetelként adja vissza", async () => {
      const { scheduler } = utemezo(BEKAPCSOLVA, { kod: 2 });
      assert.equal(await scheduler.runOnce(), "STOPPED");
    });

    it("a hibát külön kimenetelként adja vissza", async () => {
      const { scheduler } = utemezo(BEKAPCSOLVA, { kod: 1 });
      assert.equal(await scheduler.runOnce(), "FAILED");
    });
  });

  describe("indítás", () => {
    it("kikapcsolva nem indít időzítőt és nem naplóz", () => {
      const { scheduler, naplo } = utemezo({});
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();
      assert.deepEqual(naplo.sorok, []);
    });

    it("bekapcsolva kimondja, milyen rendben fut", () => {
      const { scheduler, naplo } = utemezo(BEKAPCSOLVA);
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();
      assert.equal(naplo.sorok.length, 1);
      assert.match(naplo.sorok[0]!, /2-5 óra/);
      assert.match(naplo.sorok[0]!, /terv/);
    });
  });
});

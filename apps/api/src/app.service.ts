import { checkDatabaseHealth } from "@acropora/database";
import { Injectable } from "@nestjs/common";
import type { HealthResponse } from "@acropora/types";

import { currentReleaseCommitSha } from "./common/release-info.util.js";
import { checkRedisHealth } from "./health/redis-health.js";

/**
 * A FUTO KIADAS ONLEIRASA, kulon fuggvenyben, hogy MERHETO legyen.
 *
 * A `getHealth` adatbazishoz es Redishez nyul, tehat halozat nelkul nem
 * futtathato; ez a resz viszont tisztan a folyamat sajat allapotarol szol, es
 * pont ez az, amit orizni kell.
 */
export function applicationHealth(): HealthResponse["application"] {
  return {
    status: "ok",
    version: "0.1.0",
    /**
     * MELYIK KOD FUT. A `version` erre nem valaszol: kezzel irt ertek, ami
     * minden kiadasnal ugyanaz. Eddig az `uptime` volt az egyetlen jel arrol,
     * hogy tortent-e telepites -- az viszont csak azt mondja meg, mikor indult a
     * folyamat, nem azt, MIT inditottak el.
     *
     * Az ertek a kepbe beegetett kiadas-azonositobol jon, es `null`, ha nincs
     * beallitva vagy nem ep a formaja. Kitalalt vagy ures ertek nem kerulhet
     * ide: egy rosszul formazott azonosito pontosan olyan felrevezeto lenne,
     * mint egy verziószam, ami sosem valtozik.
     */
    commit: currentReleaseCommitSha(),
  };
}

@Injectable()
export class AppService {
  getWelcome() {
    return {
      name: "Acropora OS API",
      message: "A magyar nyelvű vállalatirányítási rendszer API-ja működik.",
    };
  }

  async getHealth(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);

    return {
      application: applicationHealth(),
      database,
      redis,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

import { checkDatabaseHealth } from "@acropora/database";
import { Injectable, Logger } from "@nestjs/common";
import type { DoseProjectionHealth, HealthResponse } from "@acropora/types";

import { releaseCommitSources } from "./common/release-info.util.js";
import { toDoseProjectionHealth } from "./products/dose-effects/dose-projection.rules.js";
import { readDoseProjectionStatus } from "./products/dose-effects/dose-projection.service.js";
import { checkRedisHealth } from "./health/redis-health.js";

/**
 * A FUTO KIADAS ONLEIRASA, kulon fuggvenyben, hogy MERHETO legyen.
 *
 * A `getHealth` adatbazishoz es Redishez nyul, tehat halozat nelkul nem
 * futtathato; ez a resz viszont tisztan a folyamat sajat allapotarol szol, es
 * pont ez az, amit orizni kell.
 */
export function applicationHealth(): HealthResponse["application"] {
  const release = releaseCommitSources();
  return {
    status: "ok",
    version: "0.1.0",
    /**
     * MELYIK KOD FUT. A `version` erre nem valaszol: kezzel irt ertek, ami
     * minden kiadasnal ugyanaz. Eddig az `uptime` volt az egyetlen jel arrol,
     * hogy tortent-e telepites -- az viszont csak azt mondja meg, mikor indult a
     * folyamat, nem azt, MIT inditottak el.
     *
     * Visszamenoleges kompatibilitas miatt ez a futasideju ertek; az
     * `imageCommit`, `runtimeCommit` es `commitSourceState` egyutt mutatja meg
     * a ket forrast es az egyezesuket. Kitalalt vagy ures ertek nem kerulhet
     * ide: egy rosszul formazott azonosito pontosan olyan felrevezeto lenne,
     * mint egy verziószam, ami sosem valtozik.
     */
    commit: release.runtimeCommit,
    ...release,
  };
}

/**
 * THE DOSE-LIST PROJECTION ON /health (card 2f0d7acd): the fleet's monitor reads it without a
 * login. A failed read is `null`, never an exception: the projection is the fleet's alarm, and it
 * must not make /health answer 503 (the container's health check restarts on that).
 */
export async function doseProjectionHealth(
  read: () => Promise<Parameters<typeof toDoseProjectionHealth>[0]> = () =>
    readDoseProjectionStatus(),
): Promise<DoseProjectionHealth | null> {
  try {
    return toDoseProjectionHealth(await read());
  } catch (error) {
    new Logger("Health").warn(
      `doseProjection could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
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
    const [database, redis, doseProjection] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
      doseProjectionHealth(),
    ]);

    return {
      application: applicationHealth(),
      database,
      redis,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      doseProjection,
    };
  }
}

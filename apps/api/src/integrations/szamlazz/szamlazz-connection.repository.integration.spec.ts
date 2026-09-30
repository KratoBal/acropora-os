import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { prisma, type Prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { SzamlazzConnectionRepository } from "./szamlazz-connection.repository.js";
import { SZAMLAZZ_CONNECTION_ID } from "./szamlazz-connection.types.js";
import { encryptSzamlazzCredential } from "./szamlazz-credential-crypto.service.js";

/**
 * AZ ÜRES TÁBLA, valódi PostgreSQL ellen (acrobot 25089, 2026-09-30).
 *
 * A mért hiba: a `SzamlazzConnectionSetting` sorát semmi nem hozta létre, és a
 * kulcs-mentés üres táblán SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING-gel állt
 * meg. Ezt csak adatbázis tudja bizonyítani: egy hamisított kliens mindig
 * "talál" sort. Ezért a készlet KIÜRÍTI a táblát, lefuttatja rajta a javító
 * migráció SQL-jét, és azon menti a kulcsot.
 *
 * Amit elbuktatnia kell: a sort nem létrehozó migráció (a mentés MISSING-gel
 * áll meg); a kétszeri futtatásra elhasaló migráció (a stage-en már kézzel
 * beszúrt sor mellett); egy olyan migráció, ami a meglévő, mentett kulcsot
 * felülírja.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_ACTOR_PREFIX = "szamlazz-connection-";

const MIGRATION = new URL(
  "../../../../../packages/database/prisma/migrations/20260930160000_seed_szamlazz_connection_setting/migration.sql",
  import.meta.url,
);

const masterKeyEnvironment = {
  SZAMLAZZ_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  SZAMLAZZ_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
};

describe(
  "SzamlazzConnectionRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new SzamlazzConnectionRepository();
    const seed = () =>
      prisma.$executeRawUnsafe(readFileSync(MIGRATION, "utf8"));
    let actorId = "";
    // the row as the suite found it, put back afterwards
    let found: Prisma.SzamlazzConnectionSettingCreateInput | null = null;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const row = await prisma.szamlazzConnectionSetting.findUnique({
        where: { id: SZAMLAZZ_CONNECTION_ID },
      });
      if (row) {
        const { credentialUpdatedByUserId: _by, ...rest } = row;
        found = rest;
      }
      actorId = (
        await prisma.user.create({
          data: {
            email: `${TEST_ACTOR_PREFIX}${Date.now()}@example.invalid`,
            displayName: "Szamlazz connection integration actor",
            role: "ADMIN",
          },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.auditLog.deleteMany({
        where: { entityType: "SzamlazzConnectionSetting", userId: actorId },
      });
      await prisma.szamlazzConnectionSetting.deleteMany({
        where: { id: SZAMLAZZ_CONNECTION_ID },
      });
      if (found) await prisma.szamlazzConnectionSetting.create({ data: found });
      else await seed();
      if (actorId) await prisma.user.delete({ where: { id: actorId } });
      nincsMaradek([
        {
          nev: "User by test actor prefix",
          darab: await prisma.user.count({
            where: { email: { startsWith: TEST_ACTOR_PREFIX } },
          }),
        },
      ]);
    });

    it("on an empty table the migration creates the row, and the key can be saved", async () => {
      await prisma.szamlazzConnectionSetting.deleteMany({
        where: { id: SZAMLAZZ_CONNECTION_ID },
      });
      // the failure Balázs met on stage, before the migration
      await assert.rejects(
        () =>
          repository.replaceCredential({
            envelope: encryptSzamlazzCredential(
              "agent-key-0",
              1,
              masterKeyEnvironment,
            ),
            revision: 1,
            actorUserId: actorId,
            updatedAt: new Date(),
          }),
        /SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING/,
      );

      await seed();
      const seeded = await repository.getSetting();
      assert.deepEqual(
        [seeded?.credentialMode, seeded?.credentialRevision],
        ["ENV_FALLBACK", 0],
      );

      const saved = await repository.replaceCredential({
        envelope: encryptSzamlazzCredential(
          "agent-key-1",
          1,
          masterKeyEnvironment,
        ),
        revision: 1,
        actorUserId: actorId,
        updatedAt: new Date(),
      });
      assert.deepEqual(
        [saved.credentialMode, saved.credentialRevision],
        ["DATABASE", 1],
      );
    });

    it("running the migration again keeps the saved key", async () => {
      // the stage row inserted by hand: the migration must not fail on it,
      // nor reset what was saved in it
      await seed();
      const row = await repository.getSetting();
      assert.deepEqual(
        [
          row?.credentialMode,
          row?.credentialRevision,
          row?.encryptedAgentKey !== null,
        ],
        ["DATABASE", 1, true],
      );
    });
  },
);

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { DeviceTokenRepository } from "./device-token.repository.js";

/**
 * A KIKAPCSOLT KESZULEK NE KAPJON ERTESITEST -- es ez az igeret adatbazis-szintu,
 * mockkal nem bizonyithato.
 *
 * A kapcsolo azert torli a sort, es nem allit egy jelolot, mert a kuldo a
 * `recipients` valaszabol dolgozik: amig a token ott van, oda is kuld. Egy
 * kapcsolo, ami hazudik, rosszabb, mint a hianyzo kapcsolo -- tehat azt kell
 * megmerni, hogy a torles UTAN a cimzettek kozott TENYLEG nincs ott.
 *
 * A masik igeret ugyanilyen fontos, es ugyanugy csak adatbazison latszik: a
 * torles a FELHASZNALORA is szur. A token onmagaban azonosit egy sort, tehat
 * enelkul barki, aki egy masik telefon tokenjet ismeri, le tudna kapcsolni azt
 * a keszuleket.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "device-token-integration.invalid";

describe(
  "DeviceTokenRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new DeviceTokenRepository();
    const suffix = `${process.pid}`;
    const ownToken = `a${suffix}`.padEnd(64, "0").slice(0, 64);
    const otherToken = `b${suffix}`.padEnd(64, "0").slice(0, 64);
    let ownerId = "";
    let strangerId = "";

    async function removeLeftovers() {
      await prisma.deviceToken.deleteMany({
        where: { token: { in: [ownToken, otherToken] } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const owner = await prisma.user.create({
        data: {
          email: `owner-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Eszköz Tulajdonos",
          role: "SERVICE",
          isActive: true,
        },
      });
      ownerId = owner.id;

      const stranger = await prisma.user.create({
        data: {
          email: `stranger-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Másik Kolléga",
          role: "SERVICE",
          isActive: true,
        },
      });
      strangerId = stranger.id;

      await repository.register({
        userId: ownerId,
        token: ownToken,
        bundleId: "hu.acropora.os",
        platform: "IOS",
      });
      await repository.register({
        userId: strangerId,
        token: otherToken,
        bundleId: "hu.acropora.os",
        platform: "IOS",
      });
    });

    after(async () => {
      await removeLeftovers();
    });

    it("cannot take off a device that belongs to somebody else", async () => {
      const removed = await repository.forget({
        userId: ownerId,
        token: otherToken,
      });

      assert.equal(removed, 0);
      const stillThere = await repository.recipients([strangerId]);
      assert.deepEqual(
        stillThere.map((row) => row.token),
        [otherToken],
      );
    });

    it("removes the device, so the sender has nowhere to send", async () => {
      const before = await repository.recipients([ownerId]);
      assert.deepEqual(
        before.map((row) => row.token),
        [ownToken],
      );

      const removed = await repository.forget({
        userId: ownerId,
        token: ownToken,
      });

      assert.equal(removed, 1);
      assert.deepEqual(await repository.recipients([ownerId]), []);
    });

    /**
     * MASODSZOR IS LEFUT, es nem hibazik: a telefon ismetelheti a kikapcsolast
     * (elveszett valasz, ujratelepites), es ilyenkor a helyes valasz a nulla,
     * nem egy hiba.
     */
    it("says zero the second time, instead of failing", async () => {
      assert.equal(
        await repository.forget({ userId: ownerId, token: ownToken }),
        0,
      );
    });
  },
);

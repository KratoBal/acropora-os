import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { INTERNAL_ROLES, PERMISSIONS } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
import { usersWithPermissionWhere } from "./permission-holders.js";

/**
 * A FELHASZNÁLÓNKÉNTI JOG-ELTÉRÉS, VALÓDI POSTGRESEN (Balázs döntése,
 * 2026-10-06: szerepkör-sablon + egyéni eltérés).
 *
 * Két dolgot mér, amit mockkal nem lehet: hogy a „ki hordozza X-et” szűrő
 * reláció-feltételeit (`none`/`some`) az adatbázis úgy érti, ahogy szánjuk,
 * és hogy a belépéskor feloldott felhasználó jog-listája az eltéréseket
 * tartalmazza.
 *
 * A négy fiók: a sablonból kapja (marad), a sablonból kapja de elvették
 * (kiesik), a sablonból nem kapja de megadták (bekerül), és egy, akinek sem
 * sablonja, sem eltérése nincs (kimarad). Mind a négy irány külön sor, hogy
 * egy elrontott ág ne bújhasson a többi mögé.
 */
const gate = integrationDatabaseGate(process.env);
const DOMAIN = "permission-holders.invalid";

describe(
  "Felhasználónkénti jog-eltérés adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const ids: Record<"marad" | "elvett" | "kapott" | "nincs", string> = {
      marad: "",
      elvett: "",
      kapott: "",
      nincs: "",
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const user = (name: string, role: "SERVICE" | "VIEWER") =>
        prisma.user.create({
          data: {
            email: `${name}-${suffix}@${DOMAIN}`,
            displayName: `Jog ${name}`,
            role,
            isActive: true,
          },
        });
      ids.marad = (await user("marad", "SERVICE")).id;
      ids.elvett = (await user("elvett", "SERVICE")).id;
      ids.kapott = (await user("kapott", "VIEWER")).id;
      ids.nincs = (await user("nincs", "VIEWER")).id;
      await prisma.userPermissionOverride.createMany({
        data: [
          {
            userId: ids.elvett,
            permission: PERMISSIONS.SERVICE_MANAGE,
            effect: "REVOKE",
          },
          {
            userId: ids.kapott,
            permission: PERMISSIONS.SERVICE_MANAGE,
            effect: "GRANT",
          },
          // egy MÁSIK jog eltérése nem hathat erre a kérdésre
          {
            userId: ids.marad,
            permission: PERMISSIONS.DASHBOARD_VIEW,
            effect: "REVOKE",
          },
        ],
      });
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      // az eltérések a felhasználóval együtt mennek (onDelete: Cascade)
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${DOMAIN}` } },
      });
    }

    async function holders(extra: object = {}) {
      const rows = await prisma.user.findMany({
        where: {
          email: { endsWith: `@${DOMAIN}` },
          ...usersWithPermissionWhere(
            PERMISSIONS.SERVICE_MANAGE,
            INTERNAL_ROLES,
          ),
          ...extra,
        },
        select: { id: true },
      });
      return rows.map((row) => row.id).sort();
    }

    it("a szűrő a sablont, az elvételt és a megadást is érti", async () => {
      assert.deepEqual(await holders(), [ids.marad, ids.kapott].sort());
    });

    it("a hívó saját OR-ja mellett is (az üzenet-partnerek keresője)", async () => {
      assert.deepEqual(
        await holders({
          OR: [{ displayName: { contains: "kapott" } }],
        }),
        [ids.kapott],
      );
    });

    it("a feloldott felhasználó jog-listája az eltérésekkel számol", async () => {
      const resolver = new AuthUserResolver();
      const elvett = await resolver.resolveById(ids.elvett);
      const kapott = await resolver.resolveById(ids.kapott);
      const marad = await resolver.resolveById(ids.marad);
      assert.equal(
        elvett.permissions?.includes(PERMISSIONS.SERVICE_MANAGE),
        false,
      );
      assert.equal(
        kapott.permissions?.includes(PERMISSIONS.SERVICE_MANAGE),
        true,
      );
      assert.equal(
        marad.permissions?.includes(PERMISSIONS.SERVICE_MANAGE),
        true,
      );
      assert.equal(
        marad.permissions?.includes(PERMISSIONS.DASHBOARD_VIEW),
        false,
      );
    });
  },
);

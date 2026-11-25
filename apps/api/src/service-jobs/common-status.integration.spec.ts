import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma, type WorksheetVersionStatus } from "@acropora/database";
import {
  partnerStatusFromCommon,
  type AuthenticatedUser,
  type CommonServiceStatus,
  type CommonServiceStatusReason,
} from "@acropora/types";

import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A KÖZÖS ÁLLAPOT HÁROM HELYE, UGYANAZON AZ ADATON (kártya 7f23785c, terv 8/c).
 *
 * A levezetett Elkészült egy állítmány, és három úton jut a felületre: a sor
 * feliratán (`commonJobStatus` a kötegelt lap-tényekből), a számlálón
 * (`commonCounts`, a `COMMON_DONE_WHERE` darabszámából) és a fül szűrőjén
 * (`commonStatuses`, ugyanabból a feltételből). A tiszta függvényt a
 * `@acropora/types` táblás specje méri, a where-t csak valódi adatbázis tudja:
 * ez a fájl a hármat veti össze, minden esetre külön jeggyel.
 *
 * AZ ESETEK a táblás spec sorai, plusz kettő, ami csak az adatbázisban áll elő:
 * a több verziós lap (a LEGUTOLSÓ verzió számít, nem az első), és a rejtett lap
 * (a lezárás kapujához hasonlóan nem mentesül).
 *
 * Csak tesztelésre megnevezett adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "common-status-integration.invalid";
const TEST_CUSTOMER_PREFIX = "CST-INT-";
const TEST_JOB_PREFIX = "HJ-CST-";

type Lap = {
  versions: WorksheetVersionStatus[];
  handedOver?: boolean;
  hidden?: boolean;
};

interface Eset {
  nev: string;
  status:
    | "NEW"
    | "TRIAGED"
    | "IN_PROGRESS"
    | "WAITING_FOR_CUSTOMER"
    | "COMPLETED"
    | "CANCELLED";
  lapok: Lap[];
  vart: CommonServiceStatus;
  ok: CommonServiceStatusReason | null;
  /** Alapból hibajegy; a karbantartás a jelvény szabályát kapja (2c). */
  kind?: "MAINTENANCE";
}

const ESETEK: Eset[] = [
  { nev: "új", status: "NEW", lapok: [], vart: "NEW", ok: null },
  {
    nev: "felmérve",
    status: "TRIAGED",
    lapok: [],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "folyamatban, lap nélkül",
    status: "IN_PROGRESS",
    lapok: [],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "folyamatban, piszkozat",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["DRAFT"] }],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "aláírásra vár",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["AWAITING_SIGNATURE"] }],
    vart: "DONE",
    ok: "AWAITING_SIGNATURE",
  },
  {
    nev: "aláírva, nincs átadva",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["SIGNED"] }],
    vart: "DONE",
    ok: "AWAITING_HANDOVER",
  },
  {
    nev: "aláírva és átadva",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["SIGNED"], handedOver: true }],
    vart: "DONE",
    ok: "READY_TO_CLOSE",
  },
  {
    nev: "kész lap mellett egy piszkozat",
    status: "IN_PROGRESS",
    lapok: [
      { versions: ["SIGNED"], handedOver: true },
      { versions: ["DRAFT"] },
    ],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "a legutolsó verzió piszkozat, az első aláírásra várt",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["AWAITING_SIGNATURE", "DRAFT"] }],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "rejtett, kész lap: nem mentesül, számít",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["SIGNED"], handedOver: true, hidden: true }],
    vart: "DONE",
    ok: "READY_TO_CLOSE",
  },
  {
    nev: "8/b: ügyfélre vár, kész lappal",
    status: "WAITING_FOR_CUSTOMER",
    lapok: [{ versions: ["AWAITING_SIGNATURE"] }],
    vart: "WAITING",
    ok: "CUSTOMER",
  },
  {
    nev: "8/a: új jegy, kész lappal",
    status: "NEW",
    lapok: [{ versions: ["SIGNED"], handedOver: true }],
    vart: "NEW",
    ok: null,
  },
  { nev: "lezárva", status: "COMPLETED", lapok: [], vart: "CLOSED", ok: null },
  {
    nev: "meghiúsult",
    status: "CANCELLED",
    lapok: [],
    vart: "CLOSED",
    ok: "CANCELLED",
  },
  // a karbantartás: Lezárt, ha minden lap legutolsó verziója aláírt; különben Folyamatban, a tárolt állapottól függetlenül
  {
    nev: "karbantartás, lap nélkül",
    kind: "MAINTENANCE",
    status: "NEW",
    lapok: [],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "karbantartás, aláírásra vár",
    kind: "MAINTENANCE",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["AWAITING_SIGNATURE"] }],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "karbantartás, aláírva, átadás nélkül",
    kind: "MAINTENANCE",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["SIGNED"] }],
    vart: "CLOSED",
    ok: null,
  },
  {
    nev: "karbantartás, tárolt NEW, aláírt lappal",
    kind: "MAINTENANCE",
    status: "NEW",
    lapok: [{ versions: ["SIGNED"], handedOver: true }],
    vart: "CLOSED",
    ok: null,
  },
  {
    nev: "karbantartás, tárolt COMPLETED, piszkozat lappal",
    kind: "MAINTENANCE",
    status: "COMPLETED",
    lapok: [{ versions: ["DRAFT"] }],
    vart: "IN_PROGRESS",
    ok: null,
  },
  {
    nev: "karbantartás, a legutolsó verzió piszkozat",
    kind: "MAINTENANCE",
    status: "IN_PROGRESS",
    lapok: [{ versions: ["SIGNED", "DRAFT"] }],
    vart: "IN_PROGRESS",
    ok: null,
  },
];

describe(
  "a közös állapot a soron, a számlálón és a fül szűrőjén ugyanaz",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    /** A keresés szűkíti a listát ÉS a számlálókat: csak ennek a futásnak a jegyei számítanak. */
    const KERESES = `KozosAllapot${suffix}`;
    const service = new ServiceJobsService(new ServiceJobsRepository());
    const jegyek = new Map<string, Eset>();
    let belsos: AuthenticatedUser;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: "Közös állapot Vevő",
        },
        select: { id: true },
      });
      const unit = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "KA", name: "Közös" },
        select: { id: true },
      });
      const user = await prisma.user.create({
        data: {
          email: `internal-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Belsős kolléga",
          role: "OWNER",
          isActive: true,
        },
        select: { id: true },
      });
      belsos = await new AuthUserResolver().resolveById(user.id);

      let sorszam = 0;
      for (const eset of ESETEK) {
        sorszam += 1;
        const job = await prisma.serviceJob.create({
          data: {
            jobNumber: `${TEST_JOB_PREFIX}${suffix}-${sorszam}`,
            title: `${KERESES} ${eset.nev}`,
            kind: eset.kind ?? "REPAIR",
            status: eset.status,
            customerId: customer.id,
            departmentId: unit.id,
            openedById: user.id,
          },
          select: { id: true },
        });
        jegyek.set(job.id, eset);
        for (const lap of eset.lapok)
          await prisma.worksheet.create({
            data: {
              customerId: customer.id,
              departmentId: unit.id,
              serviceJobId: job.id,
              hiddenAt: lap.hidden ? new Date() : null,
              handedOverAt: lap.handedOver ? new Date() : null,
              versions: {
                create: lap.versions.map((status, index) => ({
                  version: index + 1,
                  status,
                  subject: `${eset.nev} lap`,
                  // a séma CHECK-jei: nem piszkozat csak lezárási idővel, a második verziótól indoklás
                  closedAt: status === "DRAFT" ? null : new Date(),
                  changeReason: index === 0 ? null : "Javítás",
                })),
              },
            },
          });
      }
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
    });

    const lista = (commonStatuses?: CommonServiceStatus[]) =>
      service.list(
        { scope: "all", search: KERESES, kind: "ALL", commonStatuses },
        belsos,
      );

    it("a sor felirata minden esetben a várt közös állapot és ok", async () => {
      const valasz = await lista();
      assert.equal(valasz.items.length, ESETEK.length);
      const kapott = Object.fromEntries(
        valasz.items.map((item) => [
          jegyek.get(item.id)!.nev,
          [item.commonStatus, item.commonReason],
        ]),
      );
      const vart = Object.fromEntries(
        ESETEK.map((eset) => [eset.nev, [eset.vart, eset.ok]]),
      );
      assert.deepEqual(kapott, vart);
    });

    it("a számláló az esetek összesítése", async () => {
      const vart = { NEW: 0, IN_PROGRESS: 0, WAITING: 0, DONE: 0, CLOSED: 0 };
      for (const eset of ESETEK) vart[eset.vart] += 1;
      assert.deepEqual((await lista()).commonCounts, vart);
    });

    it("a fül szűrője pontosan azokat a jegyeket adja, amiket a sor és a számláló mond", async () => {
      const osszes = await lista();
      for (const allapot of [
        "NEW",
        "IN_PROGRESS",
        "WAITING",
        "DONE",
        "CLOSED",
      ] as const) {
        const szurt = await lista([allapot]);
        const vart = [...jegyek]
          .filter(([, eset]) => eset.vart === allapot)
          .map(([id]) => id)
          .sort();
        assert.deepEqual(
          szurt.items.map((item) => item.id).sort(),
          vart,
          allapot,
        );
        assert.equal(
          szurt.items.length,
          osszes.commonCounts![allapot],
          allapot,
        );
      }
    });

    it("az adatlap ugyanazt mondja, mint a sor", async () => {
      for (const [id, eset] of jegyek) {
        const reszlet = await service.detail(id, belsos);
        assert.deepEqual(
          [
            (reszlet as { commonStatus?: unknown }).commonStatus,
            (reszlet as { commonReason?: unknown }).commonReason,
          ],
          [eset.vart, eset.ok],
          eset.nev,
        );
      }
    });

    /*
      A PARTNER RÖVIDEBB LISTÁJA UGYANABBÓL AZ ÁLLAPOTBÓL (4. szelet, terv 3. és 10. pont): a sor és az adatlap partner-mezői a várt
      közös állapot rövidítései. A „kész lapú IN_PROGRESS" eset itt Elkészült, a COMPLETED Lezárva, a CANCELLED Lezárva + CANCELLED
      kimenetel; ha a szerver a tárolt állapotból képezne (a 3. szeletig így volt), a kész lapú jegyek Feldolgozás alatt maradnának.
    */
    it("a partner négy szava a sor és az adatlap közös állapotából jön", async () => {
      const sorok = new Map(
        (await lista()).items.map((item) => [item.id, item]),
      );
      for (const [id, eset] of jegyek) {
        const vart = partnerStatusFromCommon({
          status: eset.vart,
          reason: eset.ok,
        });
        const sor = sorok.get(id)!;
        const reszlet = (await service.detail(id, belsos)) as {
          partnerStatus?: unknown;
          partnerClosedReason?: unknown;
        };
        assert.deepEqual(
          [
            sor.partnerStatus,
            sor.partnerClosedReason,
            reszlet.partnerStatus,
            reszlet.partnerClosedReason,
          ],
          [vart.status, vart.closedReason, vart.status, vart.closedReason],
          eset.nev,
        );
      }
    });

    it("a takarítás tényleg lefut: nem marad sor a teszt előtaggal", async () => {
      await removeLeftovers();
      assert.equal(
        await prisma.serviceJob.count({
          where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
        }),
        0,
      );
      assert.equal(
        await prisma.customer.count({
          where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        }),
        0,
      );
      assert.equal(
        await prisma.user.count({
          where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        }),
        0,
      );
    });

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((row) => row.id);
      if (customerIds.length > 0)
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: customerIds } },
        });
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      if (customerIds.length > 0) {
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        await prisma.customer.deleteMany({
          where: { id: { in: customerIds } },
        });
      }
    }
  },
);

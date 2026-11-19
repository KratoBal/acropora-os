import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { worksheetUnitWhere } from "../worksheets/worksheet-unit-scope.js";
import { ServiceJobLinkedWorksheetsRepository } from "./service-job-linked-worksheets.repository.js";

/**
 * THE LINK OF A WORKSHEET TO A MAINTENANCE SHEET ON A REAL DATABASE (card 5b366f5d). What only Postgres can show: the unique
 * `worksheetId` (one worksheet, one sheet), the link and its log entry written in ONE transaction (the loser of a race leaves
 * no entry), a REFERENCE that does not move the worksheet (`serviceJobId` stays), the cascade of both foreign keys, and the
 * picker's two-query order (same location and below first) with the hidden, the own and the already-linked worksheets left out.
 *
 * Fixture, one customer: units PARK > MEDENCE and a separate BEJARAT; two maintenance sheets A and B at PARK; a repair ticket.
 *   w-medence   at MEDENCE, older                       -> offered, in the same location (below PARK)
 *   w-bejarat   at BEJARAT, newer                       -> offered, after the same-location ones
 *   w-rejtett   at PARK, hidden                         -> never offered
 *   w-sajat     at PARK, lives under sheet A            -> not offered for A (its own)
 *   w-jegy      at BEJARAT, lives under the ticket      -> offered, and linking it must not move it
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "KLW-TEST";
const EMAIL_DOMAIN = "service-job-linked-worksheets-integration.invalid";

describe(
  "a karbantartási laphoz kapcsolt munkalapok valódi adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobLinkedWorksheetsRepository();
    let customerId = "";
    let userId = "";
    let parkId = "";
    let medenceId = "";
    let bejaratId = "";
    let jobA = "";
    let jobB = "";
    let ticket = "";
    const ws: Record<string, string> = {};

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: PREFIX } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (ids.length) {
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.serviceJob.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.customer.deleteMany({ where: { id: { in: ids } } });
      }
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const suffix = Date.now() % 1_000_000;
      const user = await prisma.user.create({
        data: {
          email: `klw-${suffix}@${EMAIL_DOMAIN}`,
          displayName: "Kapcsoló Karcsi",
          role: "SERVICE",
        },
        select: { id: true },
      });
      userId = user.id;
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-${suffix}`,
          type: "COMPANY",
          displayName: "Kapcsolás teszt",
        },
        select: { id: true },
      });
      customerId = customer.id;
      const park = await prisma.worksheetDepartment.create({
        data: { customerId, code: "KLP", name: "Park" },
        select: { id: true },
      });
      parkId = park.id;
      const medence = await prisma.worksheetDepartment.create({
        data: { customerId, code: "KLM", name: "Medence", parentId: parkId },
        select: { id: true },
      });
      medenceId = medence.id;
      const bejarat = await prisma.worksheetDepartment.create({
        data: { customerId, code: "KLB", name: "Bejárat" },
        select: { id: true },
      });
      bejaratId = bejarat.id;

      const job = (kind: "MAINTENANCE" | "REPAIR", tag: string) =>
        prisma.serviceJob.create({
          data: {
            jobNumber: `${PREFIX}-${suffix}-${tag}`,
            kind,
            title: tag,
            customerId,
            departmentId: parkId,
          },
          select: { id: true },
        });
      jobA = (await job("MAINTENANCE", "A")).id;
      jobB = (await job("MAINTENANCE", "B")).id;
      ticket = (await job("REPAIR", "T")).id;

      const sheet = async (
        name: string,
        departmentId: string,
        createdAt: string,
        extra: { serviceJobId?: string; hiddenAt?: Date } = {},
      ) => {
        const row = await prisma.worksheet.create({
          data: {
            customerId,
            departmentId,
            createdAt: new Date(createdAt),
            ...extra,
          },
          select: { id: true },
        });
        await prisma.worksheetVersion.create({
          data: {
            worksheetId: row.id,
            version: 1,
            status: "DRAFT",
            subject: name,
          },
        });
        ws[name] = row.id;
      };
      await sheet("w-medence", medenceId, "2026-11-01T10:00:00Z");
      await sheet("w-bejarat", bejaratId, "2026-11-05T10:00:00Z");
      await sheet("w-rejtett", parkId, "2026-11-06T10:00:00Z", {
        hiddenAt: new Date(),
      });
      await sheet("w-sajat", parkId, "2026-11-07T10:00:00Z", {
        serviceJobId: jobA,
      });
      await sheet("w-jegy", bejaratId, "2026-11-04T10:00:00Z", {
        serviceJobId: ticket,
      });
    });

    after(async () => {
      await removeLeftovers();
    });

    const subjectsOf = (rows: { subject: string }[]) =>
      rows.map((row) => row.subject);
    const note = (name: string) => `${name}: ${name}`;

    it("a választó a lap helyszínén és alatta lévőket adja előbb, a rejtettet és a saját munkalapot kihagyja", async () => {
      const result = await repository.linkable({
        jobId: jobA,
        customerId,
        departmentId: parkId,
        search: {},
      });
      assert.deepEqual(subjectsOf(result.rows), [
        "w-medence",
        "w-bejarat",
        "w-jegy",
      ]);
      assert.deepEqual(
        result.rows.map((row) => row.inSameLocation),
        [true, false, false],
      );
      assert.equal(result.truncated, false);
    });

    it("egy munkalap hozzákapcsolása hivatkozás: a helyén marad, és a naplósor is megvan", async () => {
      const linked = await repository.link({
        jobId: jobA,
        worksheetId: ws["w-jegy"]!,
        actorUserId: userId,
        note: note("w-jegy"),
      });
      assert.deepEqual(linked, { ok: true });
      const row = await prisma.worksheet.findUniqueOrThrow({
        where: { id: ws["w-jegy"]! },
        select: { serviceJobId: true },
      });
      assert.equal(row.serviceJobId, ticket);
      const history = await repository.history(jobA);
      assert.deepEqual(
        history.map((event) => [event.kind, event.worksheetId, event.note]),
        [["WORKSHEET_LINKED", ws["w-jegy"], note("w-jegy")]],
      );
    });

    it("a már kapcsolt munkalapot a választó többé nem kínálja, sem ennek, sem másik lapnak", async () => {
      for (const jobId of [jobA, jobB]) {
        const result = await repository.linkable({
          jobId,
          customerId,
          departmentId: parkId,
          search: {},
        });
        assert.ok(!subjectsOf(result.rows).includes("w-jegy"), jobId);
      }
    });

    it("másik laphoz ugyanazt a munkalapot nem lehet: a vesztes nem hagy naplósort", async () => {
      const second = await repository.link({
        jobId: jobB,
        worksheetId: ws["w-jegy"]!,
        actorUserId: userId,
        note: note("w-jegy"),
      });
      assert.deepEqual(second, { ok: false, reason: "duplicate" });
      assert.equal(
        await prisma.serviceJobLinkedWorksheet.count({
          where: { worksheetId: ws["w-jegy"]! },
        }),
        1,
      );
      assert.equal(
        await prisma.serviceJobEvent.count({
          where: { serviceJobId: jobB, kind: "WORKSHEET_LINKED" },
        }),
        0,
      );
    });

    it("a hozzákapcsolt lista a helyszín útvonalát és a kapcsoló nevét adja", async () => {
      const rows = await repository.listLinked(jobA, customerId, {});
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.subject, "w-jegy");
      assert.deepEqual(rows[0]?.departmentPath, ["Bejárat"]);
      assert.equal(rows[0]?.linkedByName, "Kapcsoló Karcsi");
    });

    it("a partner egység-szabálya a listán is érvényes: más egység munkalapja nem látszik", async () => {
      const scope = { kind: "customer", customerId } as const;
      const hidden = await repository.listLinked(
        jobA,
        customerId,
        worksheetUnitWhere(scope, [medenceId]),
      );
      assert.equal(hidden.length, 0);
      const shown = await repository.listLinked(
        jobA,
        customerId,
        worksheetUnitWhere(scope, [bejaratId]),
      );
      assert.equal(shown.length, 1);
    });

    it("a levétel a hivatkozást törli, a munkalapot nem, és naplósort ír; a másodszori levétel nem ír semmit", async () => {
      const removed = await repository.unlink({
        jobId: jobA,
        worksheetId: ws["w-jegy"]!,
        actorUserId: userId,
        note: note("w-jegy"),
      });
      assert.deepEqual(removed, { ok: true });
      assert.equal(
        await prisma.worksheet.count({ where: { id: ws["w-jegy"]! } }),
        1,
      );
      const again = await repository.unlink({
        jobId: jobA,
        worksheetId: ws["w-jegy"]!,
        actorUserId: userId,
        note: note("w-jegy"),
      });
      assert.deepEqual(again, { ok: false, reason: "gone" });
      assert.deepEqual(
        (await repository.history(jobA)).map((event) => event.kind),
        ["WORKSHEET_LINKED", "WORKSHEET_UNLINKED"],
      );
    });

    /*
      A TORLES A NAPLOSOR MELLETT (barracuda, #2753): a `ServiceJobEvent.worksheetId` `ON DELETE SET NULL`, a Postgres pedig a CHECK-et a
      hivatkozasi muvelet altal modositott sorra is lefuttatja. Egy munkalap torlese, amelyhez HOZZAKAPCSOLAS vagy LEVETEL naplosor
      tartozik, ezert elbukna, ha a megkotes a munkalap-fajtakon `worksheetId IS NOT NULL`-t kovetelne. A fixture munkalapjai szam
      nelkuli piszkozatok: a torlesuket a szolgaltatas is engedi.
    */
    it("a hozzákapcsolt, majd törölt munkalap törlése sikerül, a naplósor megmarad worksheetId nélkül, a jegyzettel", async () => {
      await repository.link({
        jobId: jobB,
        worksheetId: ws["w-medence"]!,
        actorUserId: userId,
        note: note("w-medence"),
      });
      await repository.link({
        jobId: jobB,
        worksheetId: ws["w-bejarat"]!,
        actorUserId: userId,
        note: note("w-bejarat"),
      });
      await prisma.worksheet.delete({ where: { id: ws["w-bejarat"]! } });
      const events = await prisma.serviceJobEvent.findMany({
        where: { serviceJobId: jobB, kind: "WORKSHEET_LINKED" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { worksheetId: true, note: true },
      });
      assert.deepEqual(events, [
        { worksheetId: ws["w-medence"]!, note: note("w-medence") },
        { worksheetId: null, note: note("w-bejarat") },
      ]);
    });

    it("a levett kapcsolat naplósora mellett a munkalap törlése is sikerül (a mainen ma is álló DETACHED eset párja)", async () => {
      // `w-jegy` a korábbi tesztben már hozzá lett kapcsolva és le lett véve: UNLINKED sor tartozik hozzá
      assert.equal(
        await prisma.serviceJobEvent.count({
          where: { worksheetId: ws["w-jegy"]!, kind: "WORKSHEET_UNLINKED" },
        }),
        1,
      );
      await prisma.worksheet.delete({ where: { id: ws["w-jegy"]! } });
      assert.equal(
        await prisma.serviceJobEvent.count({
          where: {
            serviceJobId: jobA,
            kind: "WORKSHEET_UNLINKED",
            worksheetId: null,
          },
        }),
        1,
      );
    });

    it("a lap törlése elviszi a hivatkozást, a munkalapot nem bántja", async () => {
      await prisma.serviceJob.delete({ where: { id: jobB } });
      assert.equal(
        await prisma.serviceJobLinkedWorksheet.count({
          where: { worksheetId: ws["w-medence"]! },
        }),
        0,
      );
      assert.equal(
        await prisma.worksheet.count({ where: { id: ws["w-medence"]! } }),
        1,
      );
    });
  },
);

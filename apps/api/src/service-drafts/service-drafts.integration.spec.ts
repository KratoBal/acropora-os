import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it, after } from "node:test";
import { prisma } from "@acropora/database";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceDraftsRepository } from "./service-drafts.repository.js";
import { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";
import { capasuliConfig } from "./capasuli-gmail.config.js";
const gate = integrationDatabaseGate(process.env);
if (gate.mode === "refuse") throw new Error(gate.reason);
const repository = new ServiceDraftsRepository(new ServiceJobsRepository());
const fixture = readFileSync(
  new URL(
    "../../src/service-drafts/fixtures/capasuli-2026-10-03.txt",
    import.meta.url,
  ),
  "utf8",
);
describe("Cápasuli draft transactions", { skip: gate.mode === "skip" }, () => {
  const suffix = randomUUID();
  const mailbox = `draft-test-${suffix}@example.test`;
  let customerId: string,
    departmentId: string,
    openerId: string,
    adminId: string;
  const config = () =>
    capasuliConfig({
      GMAIL_CAPASULI_USER: mailbox,
      CAPASULI_DEPARTMENT_ID: departmentId,
      CAPASULI_OPENED_BY_USER_ID: openerId,
    });
  it("sets up only local fixtures", async () => {
    const customer = await prisma.customer.create({
      data: {
        displayName: "Cápasuli draft test",
        customerNumber: `draft-${suffix}`,
        type: "COMPANY",
      },
    });
    customerId = customer.id;
    departmentId = (
      await prisma.worksheetDepartment.create({
        data: { customerId, code: "CAP", name: "Cápasuli" },
      })
    ).id;
    openerId = (
      await prisma.user.create({
        data: {
          email: `opener-${suffix}@example.test`,
          displayName: "Cápasuli",
          role: "PARTNER_SERVICE",
          customerId,
        },
      })
    ).id;
    adminId = (
      await prisma.user.create({
        data: {
          email: `admin-${suffix}@example.test`,
          displayName: "Admin",
          role: "ADMIN",
        },
      })
    ).id;
  });
  it("ingests the fixture once, no ticket and no unrelated photos", async () => {
    const attachments = [
      "IMG_0843.jpeg",
      "IMG_0844.jpeg",
      "IMG_0846.jpeg",
      "f7798143291a9e740d90a34c68f60e27.jpeg",
    ].map((fileName, i) => ({
      fileName,
      contentType: "image/jpeg",
      buffer: Buffer.from(`photo-${i}`),
    }));
    const m = {
      id: "message-1",
      reporterPersonName: "Szilveszter Roland",
      subject: "Napi jelentő",
      receivedAt: new Date(),
      text: fixture,
      attachments,
    };
    const result = await repository.ingest(m, config());
    assert.equal(result.added, 2);
    assert.equal((await repository.ingest(m, config())).added, 0);
    assert.equal(await prisma.serviceJob.count({ where: { customerId } }), 0);
    const drafts = await prisma.serviceTicketDraft.findMany({
      where: { mailbox },
      include: { attachments: true },
    });
    assert.equal(drafts.length, 2);
    assert.deepEqual(drafts.map((d) => d.attachments.length).sort(), [0, 3]);
  });
  it("dedupes a Re copy by report day, and adds only a genuinely new problem", async () => {
    const text = fixture.replace(
      "A(z) iOS Outlook appból küldve",
      "A sókeverő szivattyú nem működik.\nA(z) iOS Outlook appból küldve",
    );
    assert.equal(
      (
        await repository.ingest(
          {
            id: "reply-1",
            subject: "Re: Napi jelentő",
            receivedAt: new Date(),
            text,
            attachments: [],
          },
          config(),
        )
      ).added,
      1,
    );
  });
  it("rejects without consuming a job number", async () => {
    const draft = await prisma.serviceTicketDraft.findFirstOrThrow({
      where: { mailbox, originalProblem: { contains: "LCD" } },
    });
    const before = await prisma.serviceJob.count();
    await repository.decide(draft.id, adminId, "reject", undefined, config());
    assert.equal(await prisma.serviceJob.count(), before);
    assert.equal(
      (
        await prisma.serviceTicketDraft.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).status,
      "REJECTED",
    );
    await assert.rejects(() =>
      repository.decide(draft.id, adminId, "accept", departmentId, config()),
    );
  });
  it("invalid configuration leaves draft and ticket count unchanged", async () => {
    const draft = await prisma.serviceTicketDraft.findFirstOrThrow({
      where: { mailbox, repeatKey: "lehabzo-venturi" },
    });
    const before = await prisma.serviceJob.count();
    await assert.rejects(() =>
      repository.decide(draft.id, adminId, "accept", departmentId, {
        ...config(),
        openedById: null,
      }),
    );
    await assert.rejects(() =>
      repository.decide(draft.id, adminId, "accept", "outside", config()),
    );
    assert.equal(await prisma.serviceJob.count(), before);
    assert.equal(
      (
        await prisma.serviceTicketDraft.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).status,
      "PENDING",
    );
  });
  it("concurrent acceptance creates exactly one NEW repair with original opener, event and photos", async () => {
    const draft = await prisma.serviceTicketDraft.findFirstOrThrow({
      where: { mailbox, repeatKey: "lehabzo-venturi" },
    });
    const r = await Promise.all([
      repository.decide(draft.id, adminId, "accept", departmentId, config()),
      repository.decide(draft.id, adminId, "accept", departmentId, config()),
    ]);
    assert.equal(r[0]!.serviceJobId, r[1]!.serviceJobId);
    assert.equal(r.filter((x) => x.created).length, 1);
    const job = await prisma.serviceJob.findUniqueOrThrow({
      where: { id: r[0]!.serviceJobId! },
      include: { documents: true, events: true },
    });
    assert.equal(job.kind, "REPAIR");
    assert.equal(job.status, "NEW");
    assert.equal(job.openedById, openerId);
    assert.equal(job.reporterPersonName, "Szilveszter Roland");
    assert.equal(job.departmentId, departmentId);
    assert.equal(job.customerId, customerId);
    assert.equal(job.description, draft.originalProblem);
    assert.equal(job.documents.length, 3);
    assert.equal(job.events.length, 1);
    assert.equal(await prisma.serviceJob.count({ where: { customerId } }), 1);
  });
  it("repeated reports keep separate days and expose the earlier draft", async () => {
    const text = (date: string) =>
      `Cápasuli: 2026. szeptember ${date}.\nNap folyamán felmerülő hibák, intézkedések: volt\nAz elkülönítő bioszűrőjének felnyomó motorja leesik.`;
    for (const date of ["24", "26"])
      await repository.ingest(
        {
          id: `motor-${date}`,
          subject: "Napi jelentő",
          receivedAt: new Date(),
          text: text(date),
          attachments: [],
        },
        config(),
      );
    const drafts = await prisma.serviceTicketDraft.findMany({
      where: { mailbox, repeatKey: "elkulonito-bioszuro-felnyomo-motor" },
      orderBy: { reportDate: "asc" },
    });
    assert.equal(drafts.length, 2);
    assert.equal(drafts[1]!.repeatedFromId, drafts[0]!.id);
    const list = await repository.list("PENDING");
    assert.equal(list.items.find((d) => d.id === drafts[1]!.id)!.occurrence, 2);
  });
  it("persists a corrected author on both the draft and accepted ticket", async () => {
    const draft = await prisma.serviceTicketDraft.findFirstOrThrow({
      where: {
        mailbox,
        status: "PENDING",
        repeatKey: "elkulonito-bioszuro-felnyomo-motor",
      },
    });
    const result = await repository.decide(
      draft.id,
      adminId,
      "accept",
      departmentId,
      config(),
      "  Kovács Anna  ",
    );
    assert.equal(
      (
        await prisma.serviceJob.findUniqueOrThrow({
          where: { id: result.serviceJobId! },
        })
      ).reporterPersonName,
      "Kovács Anna",
    );
    assert.equal(
      (
        await prisma.serviceTicketDraft.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).reporterPersonName,
      "Kovács Anna",
    );
  });
  after(async () => {
    await prisma.serviceTicketDraft.deleteMany({ where: { mailbox } });
    await prisma.serviceDraftMail.deleteMany({ where: { mailbox } });
    if (customerId) {
      await prisma.serviceJob.deleteMany({ where: { customerId } });
      await prisma.worksheetDepartment.deleteMany({ where: { customerId } });
      await prisma.user.deleteMany({
        where: { id: { in: [openerId, adminId] } },
      });
      await prisma.customer.delete({ where: { id: customerId } });
    }
    await prisma.$disconnect();
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { ServiceJobsRepository } from "../../service-jobs/service-jobs.repository.js";
import { ServiceDraftsRepository } from "../service-drafts.repository.js";
import type { TicketMailMessage } from "./ticket-mail-gmail.client.js";
import { draftContentOf } from "./ticket-mail-intake.js";
import {
  TICKET_MAIL_SOURCE,
  TicketMailRepository,
} from "./ticket-mail.repository.js";

/**
 * THE TICKET@ INTAKE'S DATABASE SIDE (card ec7b947b, S2b), on a real database (`verify-db`): the sender lookup (who counts as a known sender),
 * the one-row-per-message record, the hourly count, and the refusal to accept a ticket draft through the Cápasuli path.
 *
 * WHAT TURNS RED: a partner, inactive or service account taken as a known sender; the lookup case-sensitive; a message recorded twice or a draft
 * made twice; a skipped mail leaving a draft; the hourly count including a machine's mail or a mail older than the window; duplicate attachments
 * stored twice; a ticket draft accepted through the Cápasuli path (it would get the wrong place and opener).
 */
const gate = integrationDatabaseGate(process.env);
if (gate.mode === "refuse") throw new Error(gate.reason);
const repository = new TicketMailRepository();

describe("Ticket mailbox intake store", { skip: gate.mode === "skip" }, () => {
  const suffix = randomUUID();
  const mailbox = `ticket-test-${suffix}@example.test`;
  let customerId: string;
  let departments: string[] = [];
  const userIds: string[] = [];

  const message = (
    id: string,
    overrides: Partial<TicketMailMessage> = {},
  ): TicketMailMessage => ({
    id,
    threadId: null,
    receivedAt: new Date(),
    subject: "Szűrő hiba",
    from: `anna-${suffix}@example.test`,
    fromAddress: `anna-${suffix}@example.test`,
    fromDisplayName: null,
    headers: {
      autoSubmitted: null,
      precedence: null,
      listId: null,
      authenticationResults: [],
    },
    text: "A szűrő csöpög.",
    attachments: [],
    droppedAttachments: [],
    ...overrides,
  });
  const newUser = async (name: string, data: object) => {
    const user = await prisma.user.create({
      data: {
        email: `${name}-${suffix}@example.test`,
        displayName: name,
        role: "ADMIN",
        ...data,
      },
    });
    userIds.push(user.id);
    return user;
  };

  it("sets up only local fixtures", async () => {
    customerId = (
      await prisma.customer.create({
        data: {
          displayName: "Ticket intake test",
          customerNumber: `tkt-${suffix}`,
          type: "COMPANY",
        },
      })
    ).id;
    for (const code of ["TA", "TB"])
      departments.push(
        (
          await prisma.worksheetDepartment.create({
            data: { customerId, code, name: `Hely ${code}` },
          })
        ).id,
      );
    const colleague = await newUser("anna", {});
    for (const departmentId of departments)
      await prisma.userWorksheetDepartment.create({
        data: { userId: colleague.id, departmentId },
      });
    await prisma.userServiceCapability.create({
      data: { userId: colleague.id, capability: "TICKET_MAIL_AI_WATCH" },
    });
    await newUser("partner", { role: "PARTNER_SERVICE", customerId });
    await newUser("inactive", { isActive: false });
    await newUser("robot", { isServiceAccount: true });
    await newUser("plain", {});
  });

  it("resolves an active internal user with the capability and the assigned places, case-insensitively", async () => {
    const sender = await repository.resolveSender(
      `ANNA-${suffix}@Example.Test`.toLowerCase().toUpperCase(),
    );
    assert.ok(sender);
    assert.equal(sender.watching, true);
    assert.deepEqual([...sender.departmentIds].sort(), [...departments].sort());
    assert.equal(sender.displayName, "anna");
  });

  it("a user without the capability is a known sender with watching off and no places", async () => {
    const sender = await repository.resolveSender(
      `plain-${suffix}@example.test`,
    );
    assert.ok(sender);
    assert.equal(sender.watching, false);
    assert.deepEqual(sender.departmentIds, []);
  });

  it("CONTROL: a partner account, an inactive user, a service account and a stranger are not known senders", async () => {
    for (const name of ["partner", "inactive", "robot", "nobody"])
      assert.equal(
        await repository.resolveSender(`${name}-${suffix}@example.test`),
        null,
        name,
      );
  });

  it("records a draft once: the mail, the draft with its fields, and the attachments without duplicates", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);
    const m = message("msg-draft", {
      attachments: [
        { fileName: "a.png", contentType: "image/png", buffer: png },
        { fileName: "copy.png", contentType: "image/png", buffer: png },
      ],
      droppedAttachments: [{ fileName: "x.zip", reason: "TYPE" }],
    });
    const input = {
      mailbox,
      message: m,
      authVerdict: "DMARC_PASS",
      outcome: {
        kind: "DRAFT" as const,
        intakeState: "AI_UNAVAILABLE" as const,
        senderUserId: userIds[0]!,
        reporterPersonName: "anna",
        proposedDepartmentId: null,
      },
      content: draftContentOf(m),
    };
    assert.deepEqual(await repository.record(input), {
      recorded: true,
      drafts: 1,
    });
    assert.deepEqual(await repository.record(input), {
      recorded: false,
      drafts: 0,
    });
    assert.ok(await repository.hasMessage(mailbox, "msg-draft"));
    const drafts = await prisma.serviceTicketDraft.findMany({
      where: { mailbox, source: TICKET_MAIL_SOURCE },
      include: { attachments: true, mail: true },
    });
    assert.equal(drafts.length, 1);
    const draft = drafts[0]!;
    assert.equal(draft.intakeState, "AI_UNAVAILABLE");
    assert.equal(draft.senderUserId, userIds[0]);
    assert.equal(draft.title, "Szűrő hiba");
    assert.equal(draft.status, "PENDING");
    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.mail.fromAddress, `anna-${suffix}@example.test`);
    assert.equal(draft.mail.authVerdict, "DMARC_PASS");
    assert.equal(draft.mail.droppedAttachments, 1);
    assert.equal(draft.mail.skipReason, null);
  });

  it("a skipped or capped mail leaves a mail row with its reason and NO draft", async () => {
    for (const [id, outcome, reason] of [
      [
        "msg-skip",
        { kind: "SKIP" as const, reason: "AUTO_SUBMITTED" as const },
        "AUTO_SUBMITTED",
      ],
      ["msg-capped", { kind: "CAPPED" as const }, "CAPPED"],
    ] as const) {
      const m = message(id);
      await repository.record({
        mailbox,
        message: m,
        authVerdict: "NO_HEADER",
        outcome,
        content: draftContentOf(m),
      });
      const mail = await prisma.serviceDraftMail.findUnique({
        where: {
          source_mailbox_messageId: {
            source: TICKET_MAIL_SOURCE,
            mailbox,
            messageId: id,
          },
        },
        include: { drafts: true },
      });
      assert.equal(mail?.skipReason, reason);
      assert.equal(mail?.drafts.length, 0);
    }
  });

  it("counts an address's listed and capped mail in the window, not a machine's mail and not an older one", async () => {
    const address = `anna-${suffix}@example.test`;
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // listed (msg-draft) + capped (msg-capped) count; skipped (msg-skip) does not
    assert.equal(
      await repository.unknownCountSince(mailbox, address, hourAgo),
      2,
    );
    await prisma.serviceDraftMail.update({
      where: {
        source_mailbox_messageId: {
          source: TICKET_MAIL_SOURCE,
          mailbox,
          messageId: "msg-capped",
        },
      },
      data: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    });
    assert.equal(
      await repository.unknownCountSince(mailbox, address, hourAgo),
      1,
    );
    assert.equal(
      await repository.unknownCountSince(
        mailbox,
        `other-${suffix}@example.test`,
        hourAgo,
      ),
      0,
    );
  });

  it("CONTROL: a ticket draft cannot be accepted through the Cápasuli path", async () => {
    const draft = await prisma.serviceTicketDraft.findFirstOrThrow({
      where: { mailbox, source: TICKET_MAIL_SOURCE },
    });
    const drafts = new ServiceDraftsRepository(new ServiceJobsRepository());
    await assert.rejects(
      drafts.decide(draft.id, userIds[0]!, "accept", departments[0]),
      (error: unknown) => error instanceof ConflictException,
    );
    assert.equal(
      (
        await prisma.serviceTicketDraft.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).status,
      "PENDING",
    );
  });

  after(async () => {
    await prisma.serviceTicketDraft.deleteMany({ where: { mailbox } });
    await prisma.serviceDraftMail.deleteMany({ where: { mailbox } });
    if (customerId) {
      await prisma.userWorksheetDepartment.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userServiceCapability.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.worksheetDepartment.deleteMany({ where: { customerId } });
      await prisma.customer.delete({ where: { id: customerId } });
    }
    await prisma.$disconnect();
  });
});

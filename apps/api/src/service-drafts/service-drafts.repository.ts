import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "../service-jobs/service-job-number.js";
import { extractCapasuliReports } from "./capasuli-extractor.js";
import type { CapasuliGmailMessage } from "./capasuli-gmail.client.js";
import { capasuliConfig } from "./capasuli-gmail.config.js";

@Injectable()
export class ServiceDraftsRepository {
  constructor(private readonly jobs: ServiceJobsRepository) {}
  async locations(
    rootId: string | null,
    db: Pick<Prisma.TransactionClient, "worksheetDepartment"> = prisma,
  ) {
    if (!rootId) return [];
    const root = await db.worksheetDepartment.findUnique({
      where: { id: rootId },
    });
    if (!root || !root.isActive) return [];
    const rows = await db.worksheetDepartment.findMany({
      where: { customerId: root.customerId, isActive: true },
      select: { id: true, parentId: true, name: true, customerId: true },
    });
    const ids = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows)
        if (r.parentId && ids.has(r.parentId) && !ids.has(r.id)) {
          ids.add(r.id);
          changed = true;
        }
    }
    return rows.filter((r) => ids.has(r.id));
  }
  hasMessage(source: string, mailbox: string, messageId: string) {
    return prisma.serviceDraftMail.findUnique({
      where: { source_mailbox_messageId: { source, mailbox, messageId } },
      select: { id: true },
    });
  }
  async ingest(message: CapasuliGmailMessage, config = capasuliConfig()) {
    const source = "CAPASULI_DAILY_REPORT",
      mailbox = config.user;
    const reports = extractCapasuliReports(message.text);
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`service-drafts-ingest:${source}:${mailbox}`}))`;
        const previous = await tx.serviceDraftMail.findUnique({
          where: {
            source_mailbox_messageId: {
              source,
              mailbox,
              messageId: message.id,
            },
          },
        });
        if (previous) return { mailId: previous.id, added: 0 };
        const mail = await tx.serviceDraftMail.create({
          data: {
            source,
            mailbox,
            messageId: message.id,
            subject: message.subject,
            receivedAt: message.receivedAt,
            originalText: message.text,
          },
        });
        let added = 0;
        for (const report of reports)
          for (const problem of report.problems) {
            const where = {
              source,
              mailbox,
              reportDate: report.reportDate,
              fingerprint: problem.fingerprint,
            };
            const existing = await tx.serviceTicketDraft.findUnique({
              where: { source_mailbox_reportDate_fingerprint: where },
            });
            if (existing) continue;
            const earlier = problem.repeatKey
              ? await tx.serviceTicketDraft.findFirst({
                  where: {
                    source,
                    mailbox,
                    repeatKey: problem.repeatKey,
                    reportDate: { lt: report.reportDate },
                  },
                  orderBy: { reportDate: "desc" },
                })
              : null;
            const files = message.attachments.filter((a) =>
              problem.attachmentNames.some(
                (n) => n.toLowerCase() === a.fileName.toLowerCase(),
              ),
            );
            const unique = new Map(
              files.map((a) => [
                createHash("sha256").update(a.buffer).digest("hex"),
                a,
              ]),
            );
            await tx.serviceTicketDraft.create({
              data: {
                ...where,
                mailId: mail.id,
                originalProblem: problem.text,
                title: problem.title,
                reporterPersonName: message.reporterPersonName ?? null,
                repeatKey: problem.repeatKey,
                proposedDepartmentId: config.departmentId,
                repeatedFromId: earlier?.id,
                attachments: {
                  create: [...unique].map(([sha256, a]) => ({
                    fileName: a.fileName,
                    contentType: a.contentType,
                    content: new Uint8Array(a.buffer),
                    sizeBytes: a.buffer.length,
                    sha256,
                  })),
                },
              },
            });
            added++;
          }
        return { mailId: mail.id, added };
      },
      { timeout: 30_000 },
    );
  }
  async list(status: "PENDING" | "ACCEPTED" | "REJECTED", cursor?: string) {
    const rows = await prisma.serviceTicketDraft.findMany({
      where: { status },
      orderBy: [{ reportDate: "desc" }, { id: "desc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        mail: { select: { originalText: true, subject: true, mailbox: true } },
        attachments: {
          select: {
            id: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
          },
        },
      },
    });
    const items = await Promise.all(
      rows.slice(0, 50).map(async (r) => {
        const earlier = r.repeatKey
          ? await prisma.serviceTicketDraft.findMany({
              where: {
                source: r.source,
                mailbox: r.mailbox,
                repeatKey: r.repeatKey,
                reportDate: { lt: r.reportDate },
              },
              orderBy: { reportDate: "asc" },
              select: {
                id: true,
                reportDate: true,
                acceptedServiceJobId: true,
                status: true,
              },
            })
          : [];
        return {
          ...r,
          reportDate: r.reportDate.toISOString().slice(0, 10),
          createdAt: r.createdAt.toISOString(),
          decidedAt: r.decidedAt?.toISOString() ?? null,
          occurrence: earlier.length + 1,
          earlier: earlier.map((e) => ({
            ...e,
            reportDate: e.reportDate.toISOString().slice(0, 10),
          })),
        };
      }),
    );
    return { items, nextCursor: rows.length > 50 ? rows[49]!.id : null };
  }
  async decide(
    id: string,
    actorId: string,
    decision: "accept" | "reject",
    departmentId: string | undefined,
    c = capasuliConfig(),
    reporterPersonName?: string | null,
  ) {
    for (let attempt = 0; attempt < 5; attempt++)
      try {
        return await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('service-drafts-accept-number'))`;
            await tx.$queryRaw`SELECT "id" FROM "ServiceTicketDraft" WHERE "id"=${id} FOR UPDATE`;
            const draft = await tx.serviceTicketDraft.findUnique({
              where: { id },
              include: { attachments: true },
            });
            if (!draft)
              throw new NotFoundException("A piszkozat nem található.");
            if (draft.status !== "PENDING") {
              if (decision === "accept" && draft.status === "ACCEPTED")
                return {
                  serviceJobId: draft.acceptedServiceJobId,
                  created: false,
                  title: draft.title,
                  openedById: c.openedById,
                };
              if (decision === "reject" && draft.status === "REJECTED")
                return {
                  serviceJobId: null,
                  created: false,
                  title: draft.title,
                  openedById: null,
                };
              throw new ConflictException(
                "A piszkozatról már megszületett a döntés.",
              );
            }
            if (decision === "reject") {
              await tx.serviceTicketDraft.update({
                where: { id },
                data: {
                  status: "REJECTED",
                  decidedById: actorId,
                  decidedAt: new Date(),
                },
              });
              return {
                serviceJobId: null,
                created: false,
                title: draft.title,
                openedById: null,
              };
            }
            const locations = await this.locations(c.departmentId, tx);
            const department = locations.find((d) => d.id === departmentId);
            if (!department)
              throw new BadRequestException(
                "Válassz aktív Cápasuli helyszínt.",
              );
            const opener = c.openedById
              ? await tx.user.findUnique({ where: { id: c.openedById } })
              : null;
            if (
              !opener ||
              !opener.isActive ||
              opener.role !== "PARTNER_SERVICE" ||
              opener.customerId !== department.customerId ||
              opener.supplierId
            )
              throw new BadRequestException(
                "Állítsd be a Cápasuli aktív partnerfelhasználóját (CAPASULI_OPENED_BY_USER_ID).",
              );
            const year = new Date().getFullYear();
            const last = await tx.serviceJob.findFirst({
              where: {
                jobNumber: { startsWith: serviceJobNumberPrefix(year) },
              },
              orderBy: { jobNumber: "desc" },
              select: { jobNumber: true },
            });
            const job = await this.jobs.createInTransaction(
              {
                jobNumber: nextServiceJobNumber({
                  year,
                  lastNumber: last?.jobNumber ?? null,
                }),
                title: draft.title,
                description: draft.originalProblem,
                customerId: department.customerId,
                departmentId: department.id,
                actorUserId: opener.id,
                reporterPersonName:
                  reporterPersonName === undefined
                    ? draft.reporterPersonName
                    : reporterPersonName?.trim() || null,
                assetIds: [],
                assigneeIds: [],
                kind: "REPAIR",
                contractId: null,
                clientOperationId: `service-draft:${id}`,
              },
              tx,
            );
            const photos = draft.attachments.filter((a) =>
              /^image\/(jpeg|png|webp|gif)$/.test(a.contentType),
            );
            for (const a of photos)
              await tx.serviceJobDocument.create({
                data: {
                  serviceJobId: job.id,
                  type: "PHOTO",
                  fileName: a.fileName,
                  contentType: a.contentType,
                  sizeBytes: a.sizeBytes,
                  sha256: a.sha256,
                  content: a.content,
                  uploadedById: actorId,
                },
              });
            await tx.serviceTicketDraft.update({
              where: { id },
              data: {
                status: "ACCEPTED",
                decidedById: actorId,
                decidedAt: new Date(),
                acceptedServiceJobId: job.id,
                proposedDepartmentId: department.id,
                reporterPersonName:
                  reporterPersonName === undefined
                    ? draft.reporterPersonName
                    : reporterPersonName?.trim() || null,
              },
            });
            return {
              serviceJobId: job.id,
              created: true,
              title: draft.title,
              openedById: opener.id,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 30_000,
          },
        );
      } catch (error) {
        if (
          attempt < 4 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (["P2034", "P2002"].includes(error.code) ||
            (error.code === "P2010" &&
              ["40001", "40P01"].includes(String(error.meta?.code))))
        )
          continue;
        throw error;
      }
    throw new ConflictException("Próbáld újra a döntést.");
  }
  attachment(id: string) {
    return prisma.serviceDraftAttachment.findUnique({ where: { id } });
  }
  async reviewSettings(c = capasuliConfig()) {
    const locations = await this.locations(c.departmentId);
    const opener = c.openedById
      ? await prisma.user.findUnique({
          where: { id: c.openedById },
          select: {
            id: true,
            displayName: true,
            role: true,
            isActive: true,
            customerId: true,
            supplierId: true,
          },
        })
      : null;
    const valid =
      !!opener &&
      opener.isActive &&
      opener.role === "PARTNER_SERVICE" &&
      !opener.supplierId &&
      locations.some((l) => l.customerId === opener.customerId);
    return {
      locations,
      openedBy: valid ? { id: opener.id, name: opener.displayName } : null,
    };
  }
  async reviewer(id: string | null) {
    return id
      ? prisma.user.findFirst({
          where: {
            id,
            isActive: true,
            role: { in: ["OWNER", "ADMIN"] },
            customerId: null,
            supplierId: null,
          },
          select: { id: true },
        })
      : null;
  }
  markNotified(id: string) {
    return prisma.serviceDraftMail.update({
      where: { id },
      data: { notifiedAt: new Date() },
    });
  }
}

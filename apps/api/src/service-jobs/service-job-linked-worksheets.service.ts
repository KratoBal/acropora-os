import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  ServiceJobLinkableWorksheetsResponse,
  ServiceJobLinkedWorksheetsResponse,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { worksheetUnitWhere } from "../worksheets/worksheet-unit-scope.js";
import { worksheetCreatedRange } from "../worksheets/worksheet-created-range.js";
import {
  LINK_WORKSHEET_REFUSAL_MESSAGE,
  linkEventNote,
  linkWorksheetRefusal,
  type LinkWorksheetRefusal,
} from "./service-job-linked-worksheets.rules.js";
import { ServiceJobLinkedWorksheetsRepository } from "./service-job-linked-worksheets.repository.js";
import { serviceJobVisibilityWhere } from "./service-job-visibility.js";
import { mayWriteServiceJob } from "./service-job-write-scope.js";

const NOT_FOUND = "A karbantartási lap nem található.";

/**
 * THE WORKSHEETS LINKED TO A MAINTENANCE SHEET (card 5b366f5d, Luca 2026-11-19). A link is a REFERENCE: the worksheet stays
 * where it is, and nothing of it counts into the sheet's hours, price, settlement or invoice. The link only makes the
 * settlement traceable ("which worksheets did the work for this month belong to").
 *
 * READING follows the sheet's visibility and, for a partner, the same unit rule as the worksheet list and PDF
 * (`worksheetUnitWhere`). WRITING is internal only and answers 404 to anyone else (`mayWriteServiceJob`), the same as the
 * other writes of this module: the worksheets are our internal data.
 */
@Injectable()
export class ServiceJobLinkedWorksheetsService {
  constructor(
    private readonly repository: ServiceJobLinkedWorksheetsRepository,
  ) {}

  async list(
    jobId: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobLinkedWorksheetsResponse> {
    const scope = partnerScopeOf(user);
    const unitIds =
      scope.kind === "internal"
        ? []
        : await this.repository.assignedUnitIds(user.id);
    const job = await this.repository.jobState(
      jobId,
      scope.kind === "internal"
        ? {}
        : serviceJobVisibilityWhere({ scope, userId: user.id, unitIds }),
    );
    if (job === null) throw new NotFoundException(NOT_FOUND);

    const rows = await this.repository.listLinked(
      job.id,
      job.customerId,
      worksheetUnitWhere(scope, unitIds),
    );
    // The history is the internal log (who linked), a partner gets the list only.
    const history =
      scope.kind === "internal" ? await this.repository.history(job.id) : [];
    return {
      items: rows.map((row) => ({
        worksheetId: row.worksheetId,
        number: row.number,
        subject: row.subject,
        createdAt: row.createdAt.toISOString(),
        handedOverAt: row.handedOverAt?.toISOString() ?? null,
        status: row.status,
        departmentPath: row.departmentPath,
        homeJobNumber: row.homeJobNumber,
        linkedAt: row.linkedAt.toISOString(),
        linkedByName: scope.kind === "internal" ? row.linkedByName : null,
      })),
      history: history.flatMap((event) =>
        event.kind === "WORKSHEET_LINKED" || event.kind === "WORKSHEET_UNLINKED"
          ? [
              {
                id: event.id,
                kind:
                  event.kind === "WORKSHEET_LINKED"
                    ? ("LINKED" as const)
                    : ("UNLINKED" as const),
                worksheetId: event.worksheetId,
                note: event.note,
                actorName: event.actor?.displayName ?? null,
                createdAt: event.createdAt.toISOString(),
              },
            ]
          : [],
      ),
    };
  }

  async linkable(
    jobId: string,
    query: { q?: string; createdFrom?: string; createdTo?: string },
    user: AuthenticatedUser,
  ): Promise<ServiceJobLinkableWorksheetsResponse> {
    this.requireWriteScope(user);
    const job = await this.repository.jobState(jobId, {});
    if (job === null) throw new NotFoundException(NOT_FOUND);
    // No partner, nothing to offer: the refusal names the reason instead of an empty list that looks like "no worksheets".
    if (job.kind !== "MAINTENANCE" || job.customerId === null)
      throw new BadRequestException(
        LINK_WORKSHEET_REFUSAL_MESSAGE[
          job.kind !== "MAINTENANCE"
            ? "job-not-maintenance"
            : "job-has-no-partner"
        ],
      );

    const text = query.q?.trim();
    const search: Prisma.WorksheetWhereInput = {
      AND: [
        worksheetCreatedRange(query.createdFrom, query.createdTo),
        text
          ? {
              OR: [
                { number: { contains: text, mode: "insensitive" } },
                {
                  versions: {
                    some: { subject: { contains: text, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const result = await this.repository.linkable({
      jobId: job.id,
      customerId: job.customerId,
      departmentId: job.departmentId,
      search,
    });
    return {
      items: result.rows.map((row) => ({
        worksheetId: row.worksheetId,
        number: row.number,
        subject: row.subject,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        departmentPath: row.departmentPath,
        homeJobNumber: row.homeJobNumber,
        inSameLocation: row.inSameLocation,
      })),
      truncated: result.truncated,
    };
  }

  async link(jobId: string, worksheetId: string, user: AuthenticatedUser) {
    this.requireWriteScope(user);
    const job = await this.repository.jobState(jobId, {});
    if (job === null) throw new NotFoundException(NOT_FOUND);
    const sheet = await this.repository.worksheetState(worksheetId);
    // A hidden worksheet reads as missing: the picker never offers it, and a hand-made request must not learn that it exists.
    if (sheet === null || sheet.hidden)
      throw new NotFoundException("A munkalap nem található.");

    const refusal = linkWorksheetRefusal({
      jobId: job.id,
      jobKind: job.kind,
      jobCustomerId: job.customerId,
      worksheetCustomerId: sheet.customerId,
      worksheetServiceJobId: sheet.serviceJobId,
      existingLinkJobId: sheet.linkedToJobId,
    });
    if (refusal !== null) throw refusalException(refusal);

    const linked = await this.repository.link({
      jobId: job.id,
      worksheetId: sheet.id,
      actorUserId: user.id,
      note: linkEventNote(sheet),
    });
    // The unique `worksheetId` decided a race between two people: the loser says what happened instead of overwriting.
    if (!linked.ok)
      throw new ConflictException(
        "A munkalap időközben egy karbantartási laphoz lett kapcsolva. Töltsd újra.",
      );
    return { ok: true };
  }

  async unlink(jobId: string, worksheetId: string, user: AuthenticatedUser) {
    this.requireWriteScope(user);
    const job = await this.repository.jobState(jobId, {});
    if (job === null) throw new NotFoundException(NOT_FOUND);
    const sheet = await this.repository.worksheetState(worksheetId);
    if (sheet === null)
      throw new NotFoundException("A munkalap nem található.");
    // Unlinking does not look at the customer or at "hidden": taking an existing link away must stay possible even after the
    // worksheet was hidden or the sheet moved on, or the very state we want to close could not be closed.
    if (sheet.linkedToJobId !== job.id)
      throw new ConflictException(
        "Ez a munkalap nincs ehhez a karbantartási laphoz kapcsolva.",
      );
    const removed = await this.repository.unlink({
      jobId: job.id,
      worksheetId: sheet.id,
      actorUserId: user.id,
      note: linkEventNote(sheet),
    });
    if (!removed.ok)
      throw new ConflictException(
        "A kapcsolat időközben megszűnt. Töltsd újra, és nézd meg, mi történt.",
      );
    return { ok: true };
  }

  private requireWriteScope(user: AuthenticatedUser): void {
    if (!mayWriteServiceJob(partnerScopeOf(user)))
      throw new NotFoundException(NOT_FOUND);
  }
}

/** The kind of refusal decides the status: a wrong target is a 400 (choose another), a state clash is a 409 (reload). */
function refusalException(refusal: LinkWorksheetRefusal) {
  const message = LINK_WORKSHEET_REFUSAL_MESSAGE[refusal];
  return refusal === "own-worksheet" ||
    refusal === "already-linked-here" ||
    refusal === "linked-elsewhere"
    ? new ConflictException(message)
    : new BadRequestException(message);
}

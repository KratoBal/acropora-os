import { Injectable } from "@nestjs/common";
import {
  partnerNewsOf,
  partnerNewsSince,
  partnerTodosOf,
  type AuthenticatedUser,
  type PartnerOverview,
  type PartnerSeenArea,
  type WorksheetListItem,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { CompletionCertificatesPortalService } from "../completion-certificates/completion-certificates-portal.service.js";
import { CompletionCertificatesRepository } from "../completion-certificates/completion-certificates.repository.js";
import { MaintenanceOrdersPortalService } from "../maintenance-orders/maintenance-orders-portal.service.js";
import { MaintenanceOrdersRepository } from "../maintenance-orders/maintenance-orders.repository.js";
import { ServiceJobListQueryDto } from "../service-jobs/dto.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { WorksheetListQueryDto } from "../worksheets/dto/worksheet.dto.js";
import { budapestDayKey } from "../dashboard/budapest-day.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";

import { PartnerSeenRepository } from "./partner-seen.repository.js";

/** A page of the sheet list at a time, at most this many pages (10 000 sheets waiting is no portal case). */
const SHEET_PAGE_SIZE = 100;
const SHEET_PAGES = 100;

/**
 * THE PARTNER'S OVERVIEW, "TEENDŐIM" (card 28f31715). EVERY SOURCE IS THE PARTNER'S OWN LIST: the ticket list, the sheet list,
 * the certificate list and the maintenance order list, each with the visibility its own page has, so the overview counts exactly what the linked page
 * shows. The upload rights are the same capabilities the detail pages give (`canUploadSigned`). What is a to-do is the shared,
 * auth-independent rule (`partnerTodosOf`, packages/types).
 *
 * A caller that is not a customer (internal, supplier) has no partner to-dos: the lists themselves answer them nothing.
 */
@Injectable()
export class PartnerOverviewService {
  constructor(
    private readonly serviceJobs: ServiceJobsService,
    private readonly worksheets: WorksheetsService,
    private readonly certificates: CompletionCertificatesPortalService,
    private readonly certificateRepository: CompletionCertificatesRepository,
    private readonly maintenanceOrders: MaintenanceOrdersPortalService,
    private readonly maintenanceOrderRepository: MaintenanceOrdersRepository,
    private readonly seen: PartnerSeenRepository,
  ) {}

  /** The partner opened a list (card 28f31715, PR 2): from now on only what comes after is new there. A non-customer has no news. */
  async markSeen(
    user: AuthenticatedUser,
    area: PartnerSeenArea,
    now = new Date(),
  ): Promise<void> {
    if (partnerScopeOf(user).kind !== "customer") return;
    await this.seen.markSeen(user.id, area, now);
  }

  async overview(
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<PartnerOverview> {
    if (partnerScopeOf(user).kind !== "customer")
      return { todos: [], news: [] };
    const lastSeen = await this.seen.lastSeen(user.id);
    const since = {
      TICKETS: partnerNewsSince(lastSeen.TICKETS?.toISOString(), now),
      WORKSHEETS: partnerNewsSince(lastSeen.WORKSHEETS?.toISOString(), now),
    };
    // the open tickets of both kinds; the waiting count is the server's own per-status count, the list is capped
    const ticketQuery = Object.assign(new ServiceJobListQueryDto(), {
      scope: "open",
      kind: "ALL",
    });
    const [
      tickets,
      sheets,
      newSheets,
      certificates,
      orders,
      canCertificate,
      canOrder,
    ] = await Promise.all([
      this.serviceJobs.list(ticketQuery, user),
      this.sheetsAwaitingSignature(user),
      this.sheetsSince(user, since.WORKSHEETS),
      this.certificates.list(user),
      this.maintenanceOrders.list(user),
      this.certificateRepository.hasUploadSignedCapability(user.id),
      this.maintenanceOrderRepository.hasUploadSignedCapability(user.id),
    ]);
    const { todos } = partnerTodosOf({
      tickets: tickets.items,
      waitingTicketCount: tickets.counts.WAITING_FOR_CUSTOMER,
      worksheets: sheets,
      certificates: certificates.items,
      maintenanceOrders: orders.items,
      canUploadSignedCertificate: canCertificate,
      canUploadSignedMaintenanceOrder: canOrder,
    });
    return {
      todos,
      news: partnerNewsOf({
        tickets: tickets.items,
        worksheets: newSheets,
        since,
      }),
    };
  }

  /** The sheets opened since that moment: the list's own day filter (Budapest day), then the exact moment (`partnerNewsOf`). */
  private async sheetsSince(
    user: AuthenticatedUser,
    since: string,
  ): Promise<WorksheetListItem[]> {
    const rows: WorksheetListItem[] = [];
    for (let page = 1; page <= SHEET_PAGES; page++) {
      const query = Object.assign(new WorksheetListQueryDto(), {
        page,
        pageSize: SHEET_PAGE_SIZE,
        createdFrom: budapestDayKey(new Date(since)),
      });
      const answer = await this.worksheets.list(query, user);
      rows.push(...answer.items);
      if (page >= answer.pagination.totalPages) break;
    }
    return rows;
  }

  /** The sheet list filtered to "aláírásra vár", every page of it (the to-do itself is `worksheetAwaitsPartnerSignature`). */
  private async sheetsAwaitingSignature(
    user: AuthenticatedUser,
  ): Promise<WorksheetListItem[]> {
    const rows: WorksheetListItem[] = [];
    for (let page = 1; page <= SHEET_PAGES; page++) {
      const query = Object.assign(new WorksheetListQueryDto(), {
        page,
        pageSize: SHEET_PAGE_SIZE,
        status: "AWAITING_SIGNATURE",
      });
      const answer = await this.worksheets.list(query, user);
      rows.push(...answer.items);
      if (page >= answer.pagination.totalPages) break;
    }
    return rows;
  }
}

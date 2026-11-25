import { Injectable } from "@nestjs/common";
import {
  partnerTodosOf,
  type AuthenticatedUser,
  type PartnerOverview,
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
import { WorksheetsService } from "../worksheets/worksheets.service.js";

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
  ) {}

  async overview(user: AuthenticatedUser): Promise<PartnerOverview> {
    if (partnerScopeOf(user).kind !== "customer") return { todos: [] };
    // the open tickets of both kinds; the waiting count is the server's own per-status count, the list is capped
    const ticketQuery = Object.assign(new ServiceJobListQueryDto(), {
      scope: "open",
      kind: "ALL",
    });
    const [tickets, sheets, certificates, orders, canCertificate, canOrder] =
      await Promise.all([
        this.serviceJobs.list(ticketQuery, user),
        this.sheetsAwaitingSignature(user),
        this.certificates.list(user),
        this.maintenanceOrders.list(user),
        this.certificateRepository.hasUploadSignedCapability(user.id),
        this.maintenanceOrderRepository.hasUploadSignedCapability(user.id),
      ]);
    return partnerTodosOf({
      tickets: tickets.items,
      waitingTicketCount: tickets.counts.WAITING_FOR_CUSTOMER,
      worksheets: sheets,
      certificates: certificates.items,
      maintenanceOrders: orders.items,
      canUploadSignedCertificate: canCertificate,
      canUploadSignedMaintenanceOrder: canOrder,
    });
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

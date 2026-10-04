import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import { ServiceDraftsRepository } from "./service-drafts.repository.js";
import { CapasuliGmailClient } from "./capasuli-gmail.client.js";
import {
  capasuliConfig,
  describeCapasuliSync,
} from "./capasuli-gmail.config.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
export function requireDraftAdmin(user: AuthenticatedUser) {
  if (
    !["OWNER", "ADMIN"].includes(user.role) ||
    user.customerId ||
    user.supplierId
  )
    throw new ForbiddenException(
      "A piszkozatok csak belső adminisztrátoroknak érhetők el.",
    );
}
@Injectable()
export class ServiceDraftsService {
  private readonly logger = new Logger(ServiceDraftsService.name);
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  constructor(
    private readonly repository: ServiceDraftsRepository,
    private readonly gmail: CapasuliGmailClient,
    private readonly jobs: ServiceJobsService,
    private readonly notifications: NotificationsService,
  ) {}
  async list(
    user: AuthenticatedUser,
    status: "PENDING" | "ACCEPTED" | "REJECTED",
    cursor?: string,
  ) {
    requireDraftAdmin(user);
    return {
      ...(await this.repository.list(status, cursor)),
      ...(await this.repository.reviewSettings()),
    };
  }
  status(user: AuthenticatedUser) {
    requireDraftAdmin(user);
    const c = capasuliConfig();
    return {
      enabled: c.enabled,
      switchReason: c.switchReason,
      configured: c.configured,
      mailbox: c.user,
      query: c.query,
      intervalMinutes: c.intervalMinutes,
      description: describeCapasuliSync(c),
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
    };
  }
  async decide(
    id: string,
    user: AuthenticatedUser,
    decision: "accept" | "reject",
    departmentId?: string,
    reporterPersonName?: string | null,
  ) {
    requireDraftAdmin(user);
    const result = await this.repository.decide(
      id,
      user.id,
      decision,
      departmentId,
      capasuliConfig(),
      reporterPersonName,
    );
    if (result.created && result.serviceJobId && result.openedById)
      await this.jobs.notifyAcceptedDraft(
        result.serviceJobId,
        result.title,
        result.openedById,
      );
    return { serviceJobId: result.serviceJobId };
  }
  async attachment(id: string, user: AuthenticatedUser) {
    requireDraftAdmin(user);
    const a = await this.repository.attachment(id);
    if (!a) throw new NotFoundException("A csatolmány nem található.");
    return a;
  }
  async sync() {
    if (this.running)
      throw new ConflictException("CAPASULI_SYNC_ALREADY_RUNNING");
    const c = capasuliConfig();
    if (!c.enabled) return { added: 0, processed: 0 };
    this.running = true;
    this.lastError = null;
    let added = 0,
      processed = 0;
    try {
      const ids = await this.gmail.listMessageIds();
      // Gmail lists newest first; ingest historical messages oldest first for repeat links.
      for (const id of [...ids].reverse()) {
        if (
          await this.repository.hasMessage("CAPASULI_DAILY_REPORT", c.user, id)
        )
          continue;
        let result: Awaited<ReturnType<ServiceDraftsRepository["ingest"]>>;
        try {
          result = await this.repository.ingest(
            await this.gmail.getMessage(id),
            c,
          );
        } catch (error) {
          // A malformed/oversized historical mail must not block later reports.
          // Leave it uningested so the next pull can retry; log only a safe code.
          this.lastError =
            error instanceof Error &&
            /^CAPASULI_[A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "CAPASULI_SYNC_FAILED";
          this.logger.warn(this.lastError);
          continue;
        }
        added += result.added;
        processed++;
        if (result.added) {
          const reviewer = await this.repository.reviewer(c.reviewerId);
          if (reviewer) {
            try {
              await this.notifications.deliverServiceDraftsArrived({
                mailId: result.mailId,
                userIds: [reviewer.id],
                count: result.added,
              });
              await this.repository.markNotified(result.mailId);
            } catch {
              this.logger.warn("CAPASULI_DRAFT_NOTIFICATION_FAILED");
            }
          } else this.logger.warn("CAPASULI_REVIEWER_NOT_CONFIGURED");
        }
      }
      return { added, processed };
    } catch (error) {
      this.lastError =
        error instanceof Error && /^CAPASULI_[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "CAPASULI_SYNC_FAILED";
      throw error;
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
  }
}

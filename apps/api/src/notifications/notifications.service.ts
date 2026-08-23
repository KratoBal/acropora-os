import { Injectable, Logger } from "@nestjs/common";

import type { ApnsMessage } from "./apns.client.js";
import { ApnsSender } from "./apns.sender.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { NotificationLogRepository } from "./notification-log.repository.js";

export interface WorksheetAssignmentNotice {
  worksheetId: string;
  /** What the sheet is about, as the technician will read it on the lock screen. */
  subject: string;
  /** The colleagues now responsible for the sheet. */
  userIds: readonly string[];
}

/**
 * Sends the notifications the worksheet assignment triggers.
 *
 * Two rules hold this together, and both come from the system as it is today.
 *
 * There is no queue in this API - no BullMQ, no scheduler, nothing that picks
 * work up later. So the send happens inline, AFTER the assignment is stored,
 * and a failure never reaches the caller: an office colleague pressing "save"
 * must not be left waiting on Apple, and must never see the assignment fail
 * because a phone could not be reached. What is lost in that trade is a retry,
 * and that is the honest cost of having no queue.
 *
 * Missing configuration is not a failure either. A development machine has no
 * signing key; the sender says so once and stays quiet.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly deviceTokens: DeviceTokenRepository,
    private readonly sender: ApnsSender,
    private readonly log: NotificationLogRepository,
  ) {}

  /**
   * Fire and forget, on purpose: the caller has already stored the assignment
   * and its answer must not depend on this.
   */
  notifyWorksheetAssignment(notice: WorksheetAssignmentNotice): void {
    void this.deliverWorksheetAssignment(notice).catch((cause: unknown) => {
      this.logger.warn(
        `A munkalap-értesítés küldése nem sikerült (${notice.worksheetId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    });
  }

  /** The same work, awaited. Exists so the tests can observe the outcome. */
  async deliverWorksheetAssignment(
    notice: WorksheetAssignmentNotice,
  ): Promise<{ sent: number; retired: number; failed: number }> {
    const empty = { sent: 0, retired: 0, failed: 0 };
    if (notice.userIds.length === 0) return empty;

    if (!this.sender.configured()) return empty;

    const recipients = await this.deviceTokens.recipients(notice.userIds);
    if (recipients.length === 0) return empty;

    const message = (recipient: {
      token: string;
      bundleId: string;
    }): ApnsMessage => ({
      deviceToken: recipient.token,
      bundleId: recipient.bundleId,
      title: "Új munkalap került hozzád",
      body: notice.subject,
      data: { worksheetId: notice.worksheetId },
    });

    const results = await Promise.all(
      recipients.map(async (recipient) => {
        const result = await this.sender.send(message(recipient));
        if (!result.ok && result.retired)
          await this.deviceTokens.retire(recipient.token);
        return { recipient, result };
      }),
    );

    const summary = results.reduce(
      (totals, { result }) => ({
        sent: totals.sent + (result.ok ? 1 : 0),
        retired: totals.retired + (!result.ok && result.retired ? 1 : 0),
        failed: totals.failed + (!result.ok && !result.retired ? 1 : 0),
      }),
      empty,
    );

    // Written down whether it went well or not. A log line answers the
    // question while somebody is watching; this answers it tomorrow, when
    // somebody asks whether the technician was told at all.
    await this.log.recordWorksheetAssignment({
      worksheetId: notice.worksheetId,
      attempts: results.map(({ recipient, result }) => ({
        userId: recipient.userId,
        delivered: result.ok,
        ...(result.ok
          ? {}
          : { reason: result.reason, retired: result.retired }),
      })),
    });

    if (summary.failed > 0)
      this.logger.warn(
        `Munkalap-értesítés: ${summary.sent} kiment, ${summary.failed} nem sikerült, ${summary.retired} eszköz-token elévült (${notice.worksheetId}).`,
      );

    return summary;
  }
}

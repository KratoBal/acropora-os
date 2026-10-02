import { Injectable } from "@nestjs/common";
import { Repository } from "@acropora/database";

export interface AssistantAuditRequest {
  actorUserId: string;
  sessionId: string;
  endpoint: string;
  method: string;
  timestamp: string;
}

@Injectable()
export class AssistantAuditRepository extends Repository {
  constructor() {
    super();
  }

  async begin(request: AssistantAuditRequest): Promise<string> {
    const row = await this.database.auditLog.create({
      data: {
        userId: request.actorUserId,
        entityType: "Session",
        entityId: request.sessionId,
        action: "assistant.request",
        metadata: { ...request, result: "PENDING", status: null },
      },
    });
    return row.id;
  }

  async complete(
    id: string,
    request: AssistantAuditRequest,
    status: number,
    result: string,
  ): Promise<void> {
    await this.database.auditLog.update({
      where: { id },
      data: {
        metadata: {
          ...request,
          status,
          result,
          completedAt: new Date().toISOString(),
        },
      },
    });
  }
}

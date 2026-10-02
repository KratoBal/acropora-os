import { HttpException, Injectable } from "@nestjs/common";
import { Repository } from "@acropora/database";
@Injectable()
export class AssistantBudgetRepository extends Repository {
  constructor() {
    super();
  }
  async consume(userId: string): Promise<void> {
    await this.database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const now = new Date();
        const where = { userId, action: "assistant.ask" };
        const [minute, hour] = await Promise.all([
          tx.auditLog.count({
            where: {
              ...where,
              createdAt: { gt: new Date(now.getTime() - 60_000) },
            },
          }),
          tx.auditLog.count({
            where: {
              ...where,
              createdAt: { gt: new Date(now.getTime() - 3_600_000) },
            },
          }),
        ]);
        if (minute >= 6 || hour >= 60)
          throw new HttpException(
            "Sutyeráknak percenként legfeljebb 6, óránként legfeljebb 60 kérdést tehetsz fel. Próbáld meg később.",
            429,
          );
        await tx.auditLog.create({
          data: {
            userId,
            action: "assistant.ask",
            entityType: "User",
            entityId: userId,
            createdAt: now,
          },
        });
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}

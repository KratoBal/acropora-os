import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import {
  DASHBOARD_LAYOUT_VERSION,
  type DashboardLayoutEntry,
  type DashboardTasksWidgetData,
  type ServiceCapabilityValue,
} from "@acropora/types";

const LATEST_TASKS = 3;

/**
 * THE USER'S DASHBOARD LAYOUT AND THE SMALL WIDGET QUERIES THE FRAMEWORK
 * NEEDS. Every query here is a count or a short `take`: the dashboard never
 * fetches a whole list to count it.
 */
@Injectable()
export class DashboardLayoutRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /** The stored entries, or `null` when the user never customized. */
  async findLayout(userId: string): Promise<unknown> {
    const row = await this.database.userDashboardLayout.findUnique({
      where: { userId },
      select: { widgets: true },
    });
    return row ? row.widgets : null;
  }

  async saveLayout(
    userId: string,
    widgets: DashboardLayoutEntry[],
  ): Promise<void> {
    const value = widgets as unknown as Prisma.InputJsonValue;
    await this.database.userDashboardLayout.upsert({
      where: { userId },
      create: { userId, widgets: value, version: DASHBOARD_LAYOUT_VERSION },
      update: { widgets: value, version: DASHBOARD_LAYOUT_VERSION },
    });
  }

  /** Reset to the preset: the row goes, the preset applies again. */
  async deleteLayout(userId: string): Promise<void> {
    await this.database.userDashboardLayout.deleteMany({ where: { userId } });
  }

  /** The per-user capabilities a widget may require on top of a permission. */
  async capabilities(userId: string): Promise<ServiceCapabilityValue[]> {
    const rows = await this.database.userServiceCapability.findMany({
      where: { userId },
      select: { capability: true },
    });
    return rows.map((row) => row.capability);
  }

  /** Feladataim: my open tasks, a count and the newest few. */
  async tasksWidget(userId: string): Promise<DashboardTasksWidgetData> {
    const where = { assigneeId: userId, status: "OPEN" as const };
    const [openCount, latest] = await Promise.all([
      this.database.task.count({ where }),
      this.database.task.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LATEST_TASKS,
        select: { id: true, title: true, createdAt: true },
      }),
    ]);
    return {
      openCount,
      latest: latest.map((task) => ({
        id: task.id,
        title: task.title,
        createdAt: task.createdAt.toISOString(),
      })),
    };
  }
}

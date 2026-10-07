import type { Prisma } from "@acropora/database";

import type {
  RedirectRule,
  RedirectRuleData,
  RedirectStore,
} from "./redirect-writer.js";

const SZABALY = {
  id: true,
  sourcePath: true,
  destinationPath: true,
  isActive: true,
} as const;

/**
 * AZ ÁTIRÁNYÍTÁS-TÁROLÓ EGY TRANZAKCIÓN (SEO P0 PR 6). A hívó adja a
 * tranzakciót, mert a szabály a vele járó változással együtt íródik: a slug-csere a
 * `SlugHistory` sorral, a kézi írás a lánc-összevonással.
 */
export class PrismaRedirectStore implements RedirectStore {
  constructor(private readonly db: Prisma.TransactionClient) {}

  findBySourceLower(sourceLower: string): Promise<RedirectRule | null> {
    return this.db.urlRedirect.findUnique({
      where: { sourcePathLower: sourceLower },
      select: SZABALY,
    });
  }

  findActiveByDestinationLower(
    destinationLower: string,
  ): Promise<RedirectRule[]> {
    return this.db.urlRedirect.findMany({
      where: {
        isActive: true,
        destinationPath: { equals: destinationLower, mode: "insensitive" },
      },
      select: SZABALY,
    });
  }

  create(data: RedirectRuleData): Promise<RedirectRule> {
    return this.db.urlRedirect.create({ data, select: SZABALY });
  }

  async update(
    id: string,
    data: Partial<Omit<RedirectRuleData, "sourcePath" | "sourcePathLower">>,
  ): Promise<void> {
    await this.db.urlRedirect.update({ where: { id }, data });
  }

  listActive(): Promise<RedirectRule[]> {
    return this.db.urlRedirect.findMany({
      where: { isActive: true },
      select: SZABALY,
    });
  }
}

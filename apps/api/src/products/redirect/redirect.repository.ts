import type { Prisma } from "@acropora/database";

import type {
  RedirectRule,
  RedirectRuleData,
  RedirectStore,
} from "./redirect-writer.js";

/**
 * MINDEN ÁTIRÁNYÍTÁS-ÍRÁS SORBA ÁLL (barracuda, #1597 4.). Az író egy
 * tranzakción belül olvas, aztán ír; két egyszerre futó írás (A→B kézi és B→A
 * slug-csere) egymás sorait nem látná, és kör lenne belőle. A zár a tranzakció
 * végéig tart; a tranzakció ELEJÉN kell kérni.
 */
export async function lockRedirectWrites(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('url-redirect-write'))`;
}

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
        // pontos egyenlőség: a `mode: "insensitive"` ILIKE-ja a `_`-t jokernek
        // venné, és idegen szabályt írna át (barracuda, #1597 2.)
        destinationPathLower: destinationLower,
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

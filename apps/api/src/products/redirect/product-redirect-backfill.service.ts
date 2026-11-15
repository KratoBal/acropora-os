import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma, PrismaClient } from "@acropora/database";

import type { RedirectBackfillReport } from "./redirect-backfill.js";
import {
  planProductRedirectsFromDb,
  productRedirectPlanHash,
  type RedirectInspection,
} from "./product-redirect-backfill.load.js";
import { lockRedirectWrites } from "./redirect.repository.js";

export const PRODUCT_BACKFILL_DB = Symbol("PRODUCT_BACKFILL_DB");

/** Ugyanaz az időkorlát és indok, mint a kategória-betöltőnél: a tranzakcióban a teljes betöltés és a tervezés is benne van. */
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

export interface ProductRedirectBackfillResult {
  applied: boolean;
  planHash: string;
  report: RedirectBackfillReport;
  /** Az `inspect` címek vizsgálata (csak szárazfutásnál és ha kértek ilyet). */
  inspections: RedirectInspection[];
}

type Db = Pick<PrismaClient, "$transaction" | "product" | "urlRedirect">;

/**
 * A TERMÉK-ÁTIRÁNYÍTÁS VÉGPONTJA (`POST /seo/redirects/product-backfill`, `seo.redirects.manage`; a kategória-betöltő mintájára). A parancs
 * (`redirect-backfill.cli.ts`) marad, de a teszt gépen a flotta nem futtathat parancsot és nem olvashatja a kimenetét (Coolify egyszeri
 * feladat: csak az állapot látszik), ezért a szárazfutás jelentése itt JSON-ban jön vissza.
 *
 * KÉT LÉPÉS: a szárazfutás (`apply` nélkül) semmit nem ír, és visszaadja a jelentést meg a terv `planHash`-ét (az `inspect` címekre külön, miért
 * van vagy nincs szabályuk). Az írás (`apply: true`) csak ezzel a `planHash`-sel megy, az írás tranzakciójában újratervezve; más lenyomatra 409.
 * Elutasítás vagy lánc a tervben: 422, nem ír. Az írás a többi átirányítás-írás zárával megy, és AuditLogot hagy.
 */
@Injectable()
export class ProductRedirectBackfillService {
  constructor(@Inject(PRODUCT_BACKFILL_DB) private readonly db: Db) {}

  async run(
    input: { apply?: boolean; planHash?: string; inspect?: string[] },
    userId: string,
  ): Promise<ProductRedirectBackfillResult> {
    if (!input.apply) {
      const plan = await planProductRedirectsFromDb(this.db, input.inspect);
      return {
        applied: false,
        planHash: productRedirectPlanHash(plan),
        report: plan.report,
        inspections: plan.inspections,
      };
    }
    if (!input.planHash)
      throw new BadRequestException("apply needs the planHash of the dry run");
    const planHash = input.planHash;
    return this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockRedirectWrites(tx);
      const plan = await planProductRedirectsFromDb(tx);
      if (productRedirectPlanHash(plan) !== planHash)
        throw new ConflictException(
          "the plan is not the one the dry run returned (the data changed): run the dry run again",
        );
      const { store, report } = plan;
      if (report.refused.length || report.invariantViolations.length)
        throw new UnprocessableEntityException(
          "the plan shows a refused rule or a chain: nothing was written",
        );
      const ujak = store.created();
      const modositasok = store.updated();
      if (ujak.length) await tx.urlRedirect.createMany({ data: ujak });
      for (const m of modositasok)
        await tx.urlRedirect.update({ where: { id: m.id }, data: m.data });
      await tx.auditLog.create({
        data: {
          userId,
          action: "seo.redirects.product-backfill",
          entityType: "UrlRedirect",
          metadata: {
            products: report.products,
            created: ujak.length,
            updated: modositasok.length,
            planHash,
          } as Prisma.InputJsonValue,
        },
      });
      return { applied: true, planHash, report, inspections: [] };
    }, TRANSACTION_OPTIONS);
  }
}

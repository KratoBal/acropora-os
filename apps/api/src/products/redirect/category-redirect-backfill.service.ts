import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma, PrismaClient } from "@acropora/database";

import type {
  CategoryHandleForm,
  CategoryRedirectReport,
} from "./category-redirect-backfill.js";
import {
  categoryRedirectPlanHash,
  planCategoryRedirectsFromDb,
} from "./category-redirect-backfill.load.js";
import { lockRedirectWrites } from "./redirect.repository.js";

export const CATEGORY_BACKFILL_DB = Symbol("CATEGORY_BACKFILL_DB");

/**
 * A tranzakció időkorlátja: benne van a teljes betöltés (minden kategória és minden meglévő
 * átirányítás, ma több ezer sor), a tervezés és az írás. A Prisma alapértéke 5 mp, efölött
 * "transaction already closed" lenne, a hiba okának látszata nélkül (barracuda #1972 a).
 */
export const TRANSACTION_OPTIONS = {
  timeout: 60_000,
  maxWait: 10_000,
} as const;

export interface CategoryRedirectBackfillResult {
  applied: boolean;
  planHash: string;
  form: CategoryHandleForm;
  report: CategoryRedirectReport;
}

type Db = Pick<
  PrismaClient,
  "$transaction" | "category" | "externalReference" | "urlRedirect"
>;

/**
 * A KATEGÓRIA-ÁTIRÁNYÍTÁS VÉGPONTJA (`POST /seo/redirects/category-backfill`,
 * `seo.redirects.manage`; commerce audit P1). Ugyanaz a terv, mint a parancsé, és a
 * parancs marad: a végpont azért kell, mert a teszt gépen a flotta nem futtathat
 * parancsot, és ismétlődő lépés nem lehet kézi parancs (Balázs 2026-10-13).
 *
 * KÉT LÉPÉS, EGYIK SEM TITKOS: a szárazfutás (`apply` nélkül) semmit nem ír, és
 * visszaadja a jelentést meg a terv `planHash`-ét. Az írás (`apply: true`) csak ezzel
 * a `planHash`-sel megy: a szerver az írás tranzakciójában újra megtervezi, és ha a
 * lenyomat más (közben változott az adatbázis, a lista vagy a képlet), 409, és nem ír.
 * Így az íródik, amit valaki a szárazfutáson látott, és a hívó szavában nincs
 * bizonyíték. Elutasítás vagy lánc a tervben: 422, nem ír (mint a parancs). Az írás
 * ugyanazzal a zárral megy, mint a többi átirányítás-írás, és AuditLogot hagy.
 */
@Injectable()
export class CategoryRedirectBackfillService {
  constructor(@Inject(CATEGORY_BACKFILL_DB) private readonly db: Db) {}

  async run(
    input: {
      paths: string[];
      form: CategoryHandleForm;
      apply?: boolean;
      planHash?: string;
    },
    userId: string,
  ): Promise<CategoryRedirectBackfillResult> {
    const { paths, form } = input;
    if (!input.apply) {
      const plan = await planCategoryRedirectsFromDb(this.db, paths, form);
      return {
        applied: false,
        planHash: categoryRedirectPlanHash(form, plan),
        form,
        report: plan.report,
      };
    }
    if (!input.planHash)
      throw new BadRequestException(
        "apply needs the planHash of the dry run (send the same paths and form)",
      );
    const planHash = input.planHash;
    return this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockRedirectWrites(tx);
      const plan = await planCategoryRedirectsFromDb(tx, paths, form);
      if (categoryRedirectPlanHash(form, plan) !== planHash)
        throw new ConflictException(
          "the plan is not the one the dry run returned (the data, the list or the form changed): run the dry run again",
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
          action: "seo.redirects.category-backfill",
          entityType: "UrlRedirect",
          metadata: {
            form,
            paths: paths.length,
            created: ujak.length,
            updated: modositasok.length,
            planHash,
          } as Prisma.InputJsonValue,
        },
      });
      return { applied: true, planHash, form, report };
    }, TRANSACTION_OPTIONS);
  }
}

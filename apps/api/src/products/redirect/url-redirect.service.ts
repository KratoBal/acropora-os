import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  PrismaRedirectStore,
  lockRedirectWrites,
} from "./redirect.repository.js";
import {
  RedirectError,
  writeRedirect,
  type RedirectStore,
  type WriteRedirectResult,
} from "./redirect-writer.js";

export const REDIRECT_TRANSACTOR = Symbol("REDIRECT_TRANSACTOR");

/** Egy tranzakció egy átirányítás-tárolón; a Prisma-változat alább. */
export type RedirectTransactor = <T>(
  fn: (store: RedirectStore) => Promise<T>,
) => Promise<T>;

export const prismaRedirectTransactor: RedirectTransactor = (fn) =>
  prisma.$transaction(async (tx) => {
    await lockRedirectWrites(tx);
    return fn(new PrismaRedirectStore(tx));
  });

/**
 * A KÉZI ÁTIRÁNYÍTÁS (SEO P0 PR 6, D2). Ugyanaz az író, mint a backfillé és a
 * slug-csere: a lánc összevonódik, a kör és a csak betűméretben eltérő forrás
 * elutasítva. Egy MÁS célú meglévő szabályt csak `replace: true` ír felül; enélkül
 * 409 a meglévő céllal, hogy egy UNAS-szabály ne íródjon felül véletlenül.
 */
@Injectable()
export class UrlRedirectService {
  constructor(
    @Inject(REDIRECT_TRANSACTOR)
    private readonly transactor: RedirectTransactor,
  ) {}

  async create(
    body: Record<string, unknown> | undefined,
    userId: string,
  ): Promise<WriteRedirectResult> {
    const { source, destination, replace } = body ?? {};
    if (typeof source !== "string" || typeof destination !== "string")
      throw new BadRequestException("source and destination are paths");
    if (replace !== undefined && typeof replace !== "boolean")
      throw new BadRequestException("replace is a boolean");
    let eredmeny: WriteRedirectResult;
    try {
      eredmeny = await this.transactor((store) =>
        writeRedirect(store, {
          source,
          destination,
          reason: "MANUAL",
          createdById: userId,
          onExisting: replace ? "replace" : "keep",
        }),
      );
    } catch (error) {
      if (!(error instanceof RedirectError)) throw error;
      if (error.kind === "case-collision")
        throw new ConflictException(error.message);
      throw new BadRequestException(`${error.kind}: ${error.message}`);
    }
    if (eredmeny.status === "conflict")
      throw new ConflictException(
        `the source already redirects to ${eredmeny.existingDestination}; send replace: true to overwrite`,
      );
    return eredmeny;
  }
}

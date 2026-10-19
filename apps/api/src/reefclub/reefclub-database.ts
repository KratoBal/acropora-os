import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@acropora/database";

/**
 * THE REEFCLUB PROCESS HAS ITS OWN DATABASE CLIENT (plan v6.1, 2.1).
 *
 * The shared `prisma` singleton of `@acropora/database` connects with
 * `DATABASE_URL`, which the ReefClub environment must not contain (see
 * `reefclub-environment.ts`). This client connects with
 * `REEFCLUB_DATABASE_URL` instead, which slice 6 points at a restricted,
 * column-level role. Until then it may name the same role in development; the
 * point of this slice is that the ReefClub code never reaches for the internal
 * address, so narrowing the role later changes a connection string, not code.
 *
 * Every ReefClub repository receives this class by injection. None of them
 * extends the shared `Repository` base, because that one defaults to the
 * internal singleton.
 */
export function reefClubDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const url = environment.REEFCLUB_DATABASE_URL?.trim();
  if (!url)
    throw new Error(
      "REEFCLUB_DATABASE_URL hiányzik: a ReefClub folyamat a belső DATABASE_URL-t nem használhatja.",
    );
  return url;
}

/** The address the client connects with; `ReefClubModule.forRoot` provides it. */
export const REEFCLUB_DATABASE_ADDRESS = Symbol("REEFCLUB_DATABASE_ADDRESS");

@Injectable()
export class ReefClubDatabase extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(REEFCLUB_DATABASE_ADDRESS) address: string) {
    // Constructing does not connect: the first query does.
    super({ datasourceUrl: address });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

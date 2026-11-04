import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Repository, prisma, Prisma } from "@acropora/database";
import type {
  PartnerMigrationApplyResult,
  PartnerMigrationRestorePreview,
  PartnerMigrationRestoreResult,
  PartnerMigrationRunPreview,
} from "@acropora/types";

import { describeTarget } from "./partner-migration.cli.js";
import {
  applyOperations,
  restoreRegistered,
  StalePlanError,
  type RestoreOutcome,
} from "./partner-migration.executor.js";
import {
  decideOperations,
  type BindChoices,
  type MigrationDecisions,
} from "./partner-migration-run.js";
import { PartnerMigrationPlanService } from "./partner-migration.service.js";

/**
 * AZ ÁTVEZETÉS FUTTATÁSA AZ OLDALRÓL: UGYANAZ A MAG, MINT A `partner:migrate` PARANCS (`decideOperations`, `applyOperations`,
 * `restoreRegistered`), csak a hívó más. Az írás itt is a próba lenyomatával megy (ha a terv közben változott, 409), egy Serializable
 * tranzakcióban; a visszaállítás ugyanúgy: a próba lenyomatát kéri vissza, és a tranzakcióban újraszámolja.
 */
export interface MigrationSteps {
  apply: typeof applyOperations;
  restore: typeof restoreRegistered;
}
export const MIGRATION_STEPS = Symbol("PARTNER_MIGRATION_STEPS");
const REAL_STEPS: MigrationSteps = {
  apply: applyOperations,
  restore: restoreRegistered,
};

@Injectable()
export class PartnerMigrationRunRepository extends Repository {
  constructor() {
    super(prisma);
  }

  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.database.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120_000,
      maxWait: 30_000,
    });
  }
}

/**
 * AMI KIMEGY A KLIENSNEK: csak az író saját, várt hibája (elavult terv) és a szerializációs ütközés egy "próbáld újra" mondattal. A
 * többi hiba (Prisma, kényszer: tábla- és mezőnevekkel) 500 marad.
 */
export function translateWriteError(error: unknown): unknown {
  if (error instanceof StalePlanError || error instanceof ConflictException)
    return error instanceof ConflictException
      ? error
      : new ConflictException(error.message);
  if ((error as { code?: unknown } | null)?.code === "P2034")
    return new ConflictException(
      "A művelet ütközött egy másik írással: próbáld újra.",
    );
  return error;
}

/** A kötési döntések: csak szöveg-szöveg párok, felső korláttal (a törzs nem megbízható). */
export function cleanBinds(input: unknown): BindChoices {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new BadRequestException("A binds döntések objektum kell legyenek.");
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 200)
    throw new BadRequestException("Túl sok kötési döntés.");
  for (const [code, value] of entries)
    if (typeof value !== "string" || !value || value.length > 64)
      throw new BadRequestException(
        `A(z) ${code} kötési döntése nem vevő-sor azonosító.`,
      );
  return Object.fromEntries(entries) as BindChoices;
}

/** A visszaállítási próba lenyomata: partnerenként a vevő-sor és az eredmény. */
export function restoreFingerprint(
  outcomes: readonly RestoreOutcome[],
): string {
  const ordered = outcomes
    .map((o) => [o.supplierId, o.customerId, o.result])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

const toPreview = (
  decisions: MigrationDecisions,
  target: string,
): PartnerMigrationRunPreview => {
  const count = (kind: string) =>
    decisions.operations.filter((op) => op.kind === kind).length;
  return {
    target,
    operations: decisions.operations.map((op) => ({
      kind: op.kind,
      supplierId: op.supplierId,
      code: op.code,
      ...(op.kind === "BIND" ? { customerId: op.customerId } : {}),
      ...(op.kind === "SKIP" ? { reason: op.reason } : {}),
    })),
    problems: decisions.problems,
    counts: {
      create: count("CREATE"),
      bind: count("BIND"),
      skip: count("SKIP"),
    },
    fingerprint: decisions.fingerprint,
  };
};

@Injectable()
export class PartnerMigrationRunService {
  private readonly steps: MigrationSteps;

  constructor(
    private readonly plan: PartnerMigrationPlanService,
    private readonly repository: PartnerMigrationRunRepository,
    @Optional() @Inject(MIGRATION_STEPS) steps?: MigrationSteps,
  ) {
    this.steps = steps ?? REAL_STEPS;
  }

  private target = (): string => describeTarget(process.env.DATABASE_URL);

  private async decide(binds: unknown): Promise<MigrationDecisions> {
    return decideOperations(await this.plan.build(), cleanBinds(binds));
  }

  /** PRÓBA: semmi nem íródik. */
  async preview(binds?: unknown): Promise<PartnerMigrationRunPreview> {
    return toPreview(await this.decide(binds), this.target());
  }

  async apply(
    fingerprint: string,
    binds: unknown,
    actorUserId: string,
  ): Promise<PartnerMigrationApplyResult> {
    const decisions = await this.decide(binds);
    if (decisions.problems.length)
      throw new BadRequestException(
        `A döntések hibásak: ${decisions.problems.join(" ")}`,
      );
    if (decisions.fingerprint !== fingerprint)
      throw new ConflictException(
        "A terv közben változott (vagy a lenyomat nem ehhez a tervhez tartozik): nézd meg újra a próbát.",
      );
    try {
      const outcomes = await this.repository.transaction((tx) =>
        this.steps.apply(tx, decisions.operations, actorUserId),
      );
      return { target: this.target(), outcomes };
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  /** VISSZAÁLLÍTÁSI PRÓBA: mit állítana vissza, nem ír. */
  async restorePreview(): Promise<PartnerMigrationRestorePreview> {
    const outcomes = await this.repository.transaction((tx) =>
      this.steps.restore(tx, null, true),
    );
    return {
      target: this.target(),
      outcomes,
      fingerprint: restoreFingerprint(outcomes),
    };
  }

  async restoreApply(
    fingerprint: string,
    actorUserId: string,
  ): Promise<PartnerMigrationRestoreResult> {
    const outcomes = await this.repository
      .transaction(async (tx) => {
        // ugyanabban a tranzakcióban újraszámoljuk a próbát: csak azt állítjuk vissza, amit az ember látott
        const dry = await this.steps.restore(tx, actorUserId, true);
        if (restoreFingerprint(dry) !== fingerprint)
          throw new ConflictException(
            "A visszaállítandó partnerek közben változtak: nézd meg újra a próbát.",
          );
        return this.steps.restore(tx, actorUserId, false);
      })
      .catch((error: unknown) => {
        throw translateWriteError(error);
      });
    return { target: this.target(), outcomes };
  }
}

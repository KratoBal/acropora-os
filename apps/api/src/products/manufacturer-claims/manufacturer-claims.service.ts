import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  hasPermission,
  isMachineRole,
  PERMISSIONS,
  type AuthenticatedUser,
} from "@acropora/types";

import { stepBackContentOnClaimDrop } from "../../content/content-claim-stepback.js";
import { requireInternalWriter } from "../../worksheets/worksheet-internal-write.js";
import {
  CLAIM_TYPES,
  claimOutput,
  type ClaimOutput,
  type ClaimSourceKind,
  type ClaimStatus,
  type ClaimType,
  DOSING_FACT_FIELDS,
  isDosingFactField,
  knowledgeLinkState,
  type KnowledgeLinkState,
  reviewQueueRank,
  statusChangeRefusal,
} from "./manufacturer-claim.rules.js";
import type {
  CreateManufacturerClaimDto,
  SetManufacturerClaimStatusDto,
  UpdateManufacturerClaimDto,
} from "./manufacturer-claims.dto.js";

/**
 * THE MANUFACTURER CLAIMS OF A PRODUCT (T5.3, korall's spec, points 1-4; point 5 is out). The OS
 * keeps them; content takes its "a gyártó szerint" marking and its may-it-go-out answer from each
 * claim's `output` (`manufacturer-claim.rules.ts`).
 *
 *   - a claim is recorded by one account and checked by ANOTHER (a person or a different agent);
 *     "independently confirmed" only by a person with `content.approve`;
 *   - an edit of the claim itself (type, text, source, number, the fact it stands on) is a new
 *     version, clears the check and makes the editor the recorder; a note or recheck date edit is
 *     a new version too, and keeps the check;
 *   - a dosing claim on a product that has an accepted Product Knowledge dosing fact names that
 *     fact and has no number of its own, so the two places cannot say two things (point 3);
 *   - withdrawn by archiving, never deleted; every step is a row in the claim log, with the full
 *     value after it (`ProductManufacturerClaimEvent`);
 *   - a claim that drops out (disputed, unchecked again, edited, archived) sends the approved
 *     content standing on it back to approval, in the same transaction (`content-claim-stepback.ts`).
 *
 * Nothing here writes the product, the Product Knowledge, the UNAS or the Medusa.
 */
export interface ManufacturerClaimView {
  id: string;
  productId: string;
  productName: string;
  /** From the product, not stored on the claim. */
  brand: { id: string; name: string } | null;
  claimType: ClaimType;
  claimText: string;
  sourceKind: ClaimSourceKind;
  sourceRef: string;
  sourcePublishedOn: string | null;
  sourceReadOn: string;
  valueAmount: number | null;
  valueUnit: string | null;
  note: string | null;
  recheckOn: string | null;
  /** The Product Knowledge fact a dosing claim stands on, as it is now. */
  knowledgeFact: {
    id: string;
    field: string;
    value: string | null;
    unit: string | null;
    revision: number;
  } | null;
  /** The fact's revision when the claim was linked or last re-linked. */
  knowledgeFactRevision: number | null;
  knowledgeLink: KnowledgeLinkState;
  status: ClaimStatus;
  version: number;
  recordedBy: { id: string; name: string } | null;
  recordedAt: string;
  verifiedBy: { id: string; name: string } | null;
  verifiedAt: string | null;
  archivedAt: string | null;
  archivedBy: { id: string; name: string } | null;
  output: ClaimOutput;
}

const CLAIM_SELECT = {
  id: true,
  productId: true,
  claimType: true,
  claimText: true,
  sourceKind: true,
  sourceRef: true,
  sourcePublishedOn: true,
  sourceReadOn: true,
  valueAmount: true,
  valueUnit: true,
  note: true,
  recheckOn: true,
  knowledgeFactId: true,
  knowledgeFactRevision: true,
  status: true,
  version: true,
  recordedById: true,
  recordedAt: true,
  verifiedById: true,
  verifiedAt: true,
  archivedAt: true,
  archivedById: true,
  product: {
    select: { name: true, brand: { select: { id: true, name: true } } },
  },
  knowledgeFact: {
    select: { id: true, field: true, value: true, unit: true, revision: true },
  },
  recordedBy: { select: { id: true, displayName: true } },
  verifiedBy: { select: { id: true, displayName: true } },
  archivedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.ProductManufacturerClaimSelect;

type Row = Prisma.ProductManufacturerClaimGetPayload<{
  select: typeof CLAIM_SELECT;
}>;
type Tx = Prisma.TransactionClient;
type Db = typeof prisma | Tx;

/** The fields that ARE the claim: a change to one is a new claim to check. */
const SUBSTANCE_FIELDS = [
  "claimType",
  "claimText",
  "sourceKind",
  "sourceRef",
  "sourcePublishedOn",
  "sourceReadOn",
  "valueAmount",
  "valueUnit",
  "knowledgeFactId",
  "knowledgeFactRevision",
] as const;
const OTHER_FIELDS = ["note", "recheckOn"] as const;

type Values = {
  claimType: ClaimType;
  claimText: string;
  sourceKind: ClaimSourceKind;
  sourceRef: string;
  sourcePublishedOn: Date | null;
  sourceReadOn: Date;
  valueAmount: number | null;
  valueUnit: string | null;
  note: string | null;
  recheckOn: Date | null;
  knowledgeFactId: string | null;
  knowledgeFactRevision: number | null;
};

const LIST_LIMIT = 500;
/** The review queue's rank groups, in order (`reviewQueueRank`). */
const RANK_GROUPS: readonly (readonly ClaimType[])[] = (() => {
  const groups = new Map<number, ClaimType[]>();
  for (const type of CLAIM_TYPES) {
    const rank = reviewQueueRank(type);
    groups.set(rank, [...(groups.get(rank) ?? []), type]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, t]) => t);
})();

/** `YYYY-MM-DD` to the stored calendar day (a `@db.Date`, read back at UTC midnight). */
function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayText(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return value;
}

/** The claim's fields after a step, for the log: plain JSON, the number as text. */
function snapshotOf(row: {
  claimType: string;
  claimText: string;
  sourceKind: string;
  sourceRef: string;
  sourcePublishedOn: Date | null;
  sourceReadOn: Date;
  valueAmount: Prisma.Decimal | null;
  valueUnit: string | null;
  note: string | null;
  recheckOn: Date | null;
  knowledgeFactId: string | null;
  knowledgeFactRevision: number | null;
  status: string;
  version: number;
  recordedById: string | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  archivedAt: Date | null;
  archivedById: string | null;
}): Prisma.InputJsonObject {
  return {
    claimType: row.claimType,
    claimText: row.claimText,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    sourcePublishedOn: dayText(row.sourcePublishedOn),
    sourceReadOn: dayText(row.sourceReadOn),
    valueAmount: row.valueAmount?.toString() ?? null,
    valueUnit: row.valueUnit,
    note: row.note,
    recheckOn: dayText(row.recheckOn),
    knowledgeFactId: row.knowledgeFactId,
    knowledgeFactRevision: row.knowledgeFactRevision,
    status: row.status,
    version: row.version,
    recordedById: row.recordedById,
    verifiedById: row.verifiedById,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedById: row.archivedById,
  };
}

/** The product-level dosing facts with a value: what a dosing claim must stand on (point 3). */
export function dosingFactsOf(productIds: readonly string[], db: Db = prisma) {
  return db.productKnowledgeFact.findMany({
    where: {
      productId: { in: [...productIds] },
      scopeKey: "",
      field: { in: [...DOSING_FACT_FIELDS] },
      value: { not: null },
    },
    select: { id: true, productId: true, field: true },
    orderBy: { field: "asc" },
  });
}

/** The API view of claims, with the knowledge link and the output rule. Content reads it too. */
export async function claimViews(
  rows: readonly Row[],
  db: Db = prisma,
): Promise<ManufacturerClaimView[]> {
  const dosingProducts = [
    ...new Set(
      rows
        .filter((row) => row.claimType === "DOSING")
        .map((row) => row.productId),
    ),
  ];
  const withFact = new Set(
    dosingProducts.length
      ? (await dosingFactsOf(dosingProducts, db)).map((fact) => fact.productId)
      : [],
  );
  return rows.map((row) => {
    const link = knowledgeLinkState(
      row,
      row.knowledgeFact,
      withFact.has(row.productId),
    );
    return {
      id: row.id,
      productId: row.productId,
      productName: row.product.name,
      brand: row.product.brand,
      claimType: row.claimType,
      claimText: row.claimText,
      sourceKind: row.sourceKind,
      sourceRef: row.sourceRef,
      sourcePublishedOn: dayText(row.sourcePublishedOn),
      sourceReadOn: dayText(row.sourceReadOn)!,
      valueAmount: row.valueAmount?.toNumber() ?? null,
      valueUnit: row.valueUnit,
      note: row.note,
      recheckOn: dayText(row.recheckOn),
      knowledgeFact: row.knowledgeFact,
      knowledgeFactRevision: row.knowledgeFactRevision,
      knowledgeLink: link,
      status: row.status,
      version: row.version,
      recordedBy: row.recordedBy
        ? { id: row.recordedBy.id, name: row.recordedBy.displayName }
        : null,
      recordedAt: row.recordedAt.toISOString(),
      verifiedBy: row.verifiedBy
        ? { id: row.verifiedBy.id, name: row.verifiedBy.displayName }
        : null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      archivedBy: row.archivedBy
        ? { id: row.archivedBy.id, name: row.archivedBy.displayName }
        : null,
      output: claimOutput(row, link),
    };
  });
}

/** The views of the claims a filter selects (no limit: callers pass a bounded filter). */
export async function claimViewsWhere(
  where: Prisma.ProductManufacturerClaimWhereInput,
  /** A transaction reads with the locks it holds (the content approval, `content.service.ts`). */
  db: Db = prisma,
): Promise<ManufacturerClaimView[]> {
  return claimViews(
    await db.productManufacturerClaim.findMany({
      where,
      select: CLAIM_SELECT,
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    }),
    db,
  );
}

@Injectable()
export class ManufacturerClaimsService {
  async listForProduct(
    productId: string,
    includeArchived: boolean,
  ): Promise<{ items: ManufacturerClaimView[]; truncated: boolean }> {
    return this.list({ productId, includeArchived });
  }

  /** The review queue and the product list: dosing and safety first, then the oldest. */
  async list(query: {
    productId?: string;
    status?: ClaimStatus;
    claimType?: ClaimType;
    includeArchived?: boolean;
  }): Promise<{ items: ManufacturerClaimView[]; truncated: boolean }> {
    const where = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    // THE RANK IS APPLIED BEFORE THE LIMIT (barracuda, #2444 b): one query per rank group, in
    // rank order, so above the limit it is the old effect claims that fall off, never a newer
    // dosing claim. `truncated` says that something did.
    const rows: Row[] = [];
    for (const types of RANK_GROUPS) {
      const wanted = query.claimType
        ? types.filter((type) => type === query.claimType)
        : types;
      if (!wanted.length || rows.length > LIST_LIMIT) continue;
      rows.push(
        ...(await prisma.productManufacturerClaim.findMany({
          where: { ...where, claimType: { in: [...wanted] } },
          select: CLAIM_SELECT,
          orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
          take: LIST_LIMIT + 1 - rows.length,
        })),
      );
    }
    return {
      items: await claimViews(rows.slice(0, LIST_LIMIT)),
      truncated: rows.length > LIST_LIMIT,
    };
  }

  async create(
    productId: string,
    input: CreateManufacturerClaimDto,
    user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    requireInternalWriter(user, "Gyártói állítás rögzítése");
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException("A termék nem található.");
    const values: Values = {
      claimType: input.claimType,
      claimText: input.claimText.trim(),
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef.trim(),
      sourcePublishedOn: input.sourcePublishedOn
        ? day(input.sourcePublishedOn)
        : null,
      sourceReadOn: day(input.sourceReadOn),
      valueAmount: input.valueAmount ?? null,
      valueUnit: blankToNull(input.valueUnit),
      note: blankToNull(input.note),
      recheckOn: input.recheckOn ? day(input.recheckOn) : null,
      knowledgeFactId: null,
      knowledgeFactRevision: null,
    };
    Object.assign(
      values,
      await this.factLink(productId, values, input.knowledgeFactId ?? null),
    );
    this.assertValues(values);
    const now = new Date();
    const id = await prisma.$transaction(async (tx) => {
      const row = await tx.productManufacturerClaim.create({
        data: {
          productId,
          ...values,
          recordedById: user.id,
          recordedAt: now,
        },
      });
      await this.log(tx, row.id, "CREATED", user, row);
      return row.id;
    });
    return this.view(id);
  }

  async update(
    id: string,
    input: UpdateManufacturerClaimDto,
    user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    requireInternalWriter(user, "Gyártói állítás szerkesztése");
    const current = await this.live(id);
    if (current.version !== input.expectedVersion)
      throw new ConflictException(
        "Az állítást közben módosították. Töltsd újra, és nézd át az új értékeket.",
      );
    const next: Values = {
      claimType: input.claimType ?? current.claimType,
      claimText: input.claimText?.trim() ?? current.claimText,
      sourceKind: input.sourceKind ?? current.sourceKind,
      sourceRef: input.sourceRef?.trim() ?? current.sourceRef,
      sourcePublishedOn:
        input.sourcePublishedOn === undefined
          ? current.sourcePublishedOn
          : input.sourcePublishedOn === null
            ? null
            : day(input.sourcePublishedOn),
      sourceReadOn: input.sourceReadOn
        ? day(input.sourceReadOn)
        : current.sourceReadOn,
      valueAmount:
        input.valueAmount === undefined
          ? (current.valueAmount?.toNumber() ?? null)
          : input.valueAmount,
      valueUnit:
        input.valueUnit === undefined
          ? current.valueUnit
          : blankToNull(input.valueUnit),
      note: input.note === undefined ? current.note : blankToNull(input.note),
      recheckOn:
        input.recheckOn === undefined
          ? current.recheckOn
          : input.recheckOn === null
            ? null
            : day(input.recheckOn),
      knowledgeFactId: current.knowledgeFactId,
      knowledgeFactRevision: current.knowledgeFactRevision,
    };
    // The link is re-resolved when named (also the same fact: that re-reads its revision), and
    // checked again whenever the type changes.
    if (
      input.knowledgeFactId !== undefined ||
      next.claimType !== current.claimType
    )
      Object.assign(
        next,
        await this.factLink(
          current.productId,
          next,
          input.knowledgeFactId === undefined
            ? current.knowledgeFactId
            : input.knowledgeFactId,
        ),
      );
    this.assertValues(next);
    const differs = (field: keyof Values) =>
      comparable(current[field]) !== comparable(next[field]);
    const substance = SUBSTANCE_FIELDS.some(differs);
    if (!substance && !OTHER_FIELDS.some(differs)) return this.view(id);
    const now = new Date();
    const version = current.version + 1;
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.productManufacturerClaim.updateMany({
        where: { id, version: current.version, archivedAt: null },
        data: {
          ...next,
          version,
          ...(substance
            ? {
                recordedById: user.id,
                recordedAt: now,
                status: "UNVERIFIED",
                verifiedById: null,
                verifiedAt: null,
              }
            : {}),
        },
      });
      if (count === 0)
        throw new ConflictException(
          "Az állítást közben módosították. Töltsd újra, és nézd át az új értékeket.",
        );
      const row = await tx.productManufacturerClaim.findUniqueOrThrow({
        where: { id },
      });
      await this.log(tx, id, "EDITED", user, row);
      if (substance)
        await stepBackContentOnClaimDrop(tx, {
          claimId: id,
          actorUserId: user.id,
          why: "A gyártói állítást átírták, újra ellenőrizni kell",
        });
    });
    return this.view(id);
  }

  /**
   * A check state, for the version the checker saw. Who may set which: `statusChangeRefusal`. A
   * claim whose Product Knowledge link no longer holds is not checked against the old value: it
   * can only be disputed or left unchecked until it is re-linked.
   */
  async setStatus(
    id: string,
    input: SetManufacturerClaimStatusDto,
    user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    requireInternalWriter(user, "Gyártói állítás ellenőrzése");
    const current = await this.live(id);
    if (current.version !== input.expectedVersion)
      throw new ConflictException(
        "Az állítást közben módosították: az új változatot nézd át, és azt ellenőrizd.",
      );
    const refusal = statusChangeRefusal({
      target: input.status,
      current: current.status,
      recordedById: current.recordedById,
      actor: {
        id: user.id,
        machine: isMachineRole(user.role),
        canApprove: hasPermission(user, PERMISSIONS.CONTENT_APPROVE),
      },
    });
    if (refusal) throw new BadRequestException(refusal);
    if (input.status !== "UNVERIFIED" && input.status !== "DISPUTED") {
      const [view] = await claimViews([
        await prisma.productManufacturerClaim.findUniqueOrThrow({
          where: { id },
          select: CLAIM_SELECT,
        }),
      ]);
      if (
        view!.knowledgeLink === "CHANGED" ||
        view!.knowledgeLink === "MISSING_LINK"
      )
        throw new BadRequestException(
          "Az állítás a termék Product Knowledge adagolására épül, és az azóta változott vagy nincs hozzákötve: előbb kösd (újra) hozzá, és az új változatot ellenőrizzétek.",
        );
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.productManufacturerClaim.updateMany({
        where: {
          id,
          version: current.version,
          status: current.status,
          archivedAt: null,
        },
        data:
          input.status === "UNVERIFIED"
            ? { status: input.status, verifiedById: null, verifiedAt: null }
            : { status: input.status, verifiedById: user.id, verifiedAt: now },
      });
      if (count === 0)
        throw new ConflictException(
          "Az állítást közben módosították: az új változatot nézd át, és azt ellenőrizd.",
        );
      const row = await tx.productManufacturerClaim.findUniqueOrThrow({
        where: { id },
      });
      await this.log(tx, id, "STATUS_CHANGED", user, row);
      if (input.status === "DISPUTED" || input.status === "UNVERIFIED")
        await stepBackContentOnClaimDrop(tx, {
          claimId: id,
          actorUserId: user.id,
          why:
            input.status === "DISPUTED"
              ? "A gyártói állítás vitatott lett"
              : "A gyártói állítás ellenőrzését visszavonták",
        });
    });
    return this.view(id);
  }

  async archive(id: string, user: AuthenticatedUser): Promise<void> {
    requireInternalWriter(user, "Gyártói állítás archiválása");
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.productManufacturerClaim.updateMany({
        where: { id, archivedAt: null },
        data: { archivedAt: new Date(), archivedById: user.id },
      });
      if (count === 0)
        throw new NotFoundException("Az élő gyártói állítás nem található.");
      const row = await tx.productManufacturerClaim.findUniqueOrThrow({
        where: { id },
      });
      await this.log(tx, id, "ARCHIVED", user, row);
      await stepBackContentOnClaimDrop(tx, {
        claimId: id,
        actorUserId: user.id,
        why: "A gyártói állítást visszavonták (archiválva)",
      });
    });
  }

  /** The claim log, newest first: who, when, and the full value after the step. */
  async events(id: string) {
    const claim = await prisma.productManufacturerClaim.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!claim) throw new NotFoundException("A gyártói állítás nem található.");
    const rows = await prisma.productManufacturerClaimEvent.findMany({
      where: { claimId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        kind: true,
        version: true,
        actorId: true,
        actorName: true,
        snapshot: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      kind: row.kind,
      version: row.version,
      actorId: row.actorId,
      // the name as it was at the step, also after the account is gone
      actorName: row.actorName,
      snapshot: row.snapshot,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * POINT 3: a dosing claim and the Product Knowledge say one thing. When a fact is named, it must
   * be this product's accepted dosing fact with a value, the claim must be a dosing claim, and the
   * number stays in the fact. When none is named, a dosing claim is refused if the product has
   * such a fact.
   */
  private async factLink(
    productId: string,
    values: Pick<Values, "claimType" | "valueAmount">,
    factId: string | null,
  ): Promise<Pick<Values, "knowledgeFactId" | "knowledgeFactRevision">> {
    if (factId) {
      if (values.claimType !== "DOSING")
        throw new BadRequestException(
          "Product Knowledge tényre csak adagolás típusú állítás hivatkozhat.",
        );
      const fact = await prisma.productKnowledgeFact.findUnique({
        where: { id: factId },
        select: {
          productId: true,
          scopeKey: true,
          field: true,
          value: true,
          revision: true,
        },
      });
      // Product level only (barracuda, #2444 a): the missing-link check looks at those too.
      if (
        !fact ||
        fact.productId !== productId ||
        fact.scopeKey !== "" ||
        !isDosingFactField(fact.field) ||
        fact.value === null
      )
        throw new BadRequestException(
          "A megnevezett tény nem ennek a terméknek az elfogadott, értékkel bíró adagolás-ténye.",
        );
      if (values.valueAmount !== null)
        throw new BadRequestException(
          "Product Knowledge tényre épülő állításnak nincs saját szám-értéke: a szám a tényben van.",
        );
      return { knowledgeFactId: factId, knowledgeFactRevision: fact.revision };
    }
    if (values.claimType === "DOSING") {
      const facts = await dosingFactsOf([productId]);
      if (facts.length)
        throw new BadRequestException(
          `A termékhez van elfogadott Product Knowledge adagolás (${facts
            .map((fact) => `${fact.field}: ${fact.id}`)
            .join(
              ", ",
            )}): az adagolás-állítás erre hivatkozzon (knowledgeFactId), hogy a két hely ne térjen el.`,
        );
    }
    return { knowledgeFactId: null, knowledgeFactRevision: null };
  }

  /** What the database CHECK says too, as a sentence before the write. */
  private assertValues(values: Values): void {
    if ((values.valueAmount === null) !== (values.valueUnit === null))
      throw new BadRequestException(
        "A szám-érték és a mértékegység csak együtt adható meg.",
      );
    if (values.knowledgeFactId !== null && values.valueAmount !== null)
      throw new BadRequestException(
        "Product Knowledge tényre épülő állításnak nincs saját szám-értéke: a szám a tényben van.",
      );
  }

  private async log(
    tx: Tx,
    claimId: string,
    kind: "CREATED" | "EDITED" | "STATUS_CHANGED" | "ARCHIVED",
    user: AuthenticatedUser,
    row: Parameters<typeof snapshotOf>[0],
  ): Promise<void> {
    await tx.productManufacturerClaimEvent.create({
      data: {
        claimId,
        kind,
        version: row.version,
        actorId: user.id,
        actorName: user.displayName,
        snapshot: snapshotOf(row),
      },
    });
  }

  private async live(id: string) {
    const row = await prisma.productManufacturerClaim.findFirst({
      where: { id, archivedAt: null },
    });
    if (!row)
      throw new NotFoundException("Az élő gyártói állítás nem található.");
    return row;
  }

  /** One claim, archived ones included; 404 when there is none. */
  async get(id: string): Promise<ManufacturerClaimView> {
    const row = await prisma.productManufacturerClaim.findUnique({
      where: { id },
      select: CLAIM_SELECT,
    });
    if (!row) throw new NotFoundException("A gyártói állítás nem található.");
    return (await claimViews([row]))[0]!;
  }

  private async view(id: string): Promise<ManufacturerClaimView> {
    const row = await prisma.productManufacturerClaim.findUniqueOrThrow({
      where: { id },
      select: CLAIM_SELECT,
    });
    return (await claimViews([row]))[0]!;
  }
}

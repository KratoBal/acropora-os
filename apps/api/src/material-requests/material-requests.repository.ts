import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import {
  MATERIAL_REQUEST_ACTIVE_STATUSES,
  type MaterialRequestEventKindValue,
  type MaterialRequestPriorityValue,
  type MaterialRequestStatusValue,
  type MaterialRequestView,
} from "@acropora/types";

import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import { parseQuantityValue } from "./material-request-workflow.js";

export interface MaterialRequestItemInput {
  name: string;
  quantity: string;
  unit: string;
}

export interface MaterialRequestItemRow {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  quantityValue: Prisma.Decimal | null;
  receivedQuantity: Prisma.Decimal | null;
  receivedAt: Date | null;
}

export type MaterialRequestStatus = MaterialRequestStatusValue;

export interface MaterialRequestRow {
  id: string;
  /** one of the two is set (#1582 P5b): a worksheet's or a project's request */
  worksheetId: string | null;
  projectId: string | null;
  status: MaterialRequestStatus;
  requestedById: string | null;
  requestedByName: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  receivedAt: Date | null;
  receivedByName: string | null;
  items: MaterialRequestItemRow[];
  handlerId: string | null;
  handlerName: string | null;
  handlerAssignedAt: Date | null;
  orderedAt: Date | null;
  orderedByName: string | null;
  cancelledAt: Date | null;
  cancelledByName: string | null;
  note: string | null;
  neededBy: Date | null;
  priority: MaterialRequestPriorityValue | null;
}

/** A row with its worksheet context: the overview's summary. */
export type MaterialRequestContextRow = MaterialRequestRow & {
  worksheetNumber: string | null;
  /** the worksheet's customer and unit; null on a project's request */
  customerDisplayName: string | null;
  departmentName: string | null;
  /** the project, on a project's request (P5b) */
  projectNumber: string | null;
  projectName: string | null;
};

export interface MaterialRequestEventRow {
  id: string;
  kind: MaterialRequestEventKindValue;
  fromStatus: MaterialRequestStatus | null;
  toStatus: MaterialRequestStatus | null;
  actorName: string | null;
  createdAt: Date;
  payload: Prisma.JsonValue | null;
}

export interface MaterialRequestCommentRow {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: Date;
}

/** Ugyanaz a szuk mezo-halmaz, ami a kuldeshez kell -- lasd a hivokat. */
export interface ActiveUserContact {
  id: string;
  email: string;
  displayName: string;
}

/** One history row to write with a transition. */
export interface MaterialRequestEventInput {
  kind: MaterialRequestEventKindValue;
  fromStatus: MaterialRequestStatus | null;
  toStatus: MaterialRequestStatus | null;
  actorUserId: string;
  payload?: Prisma.InputJsonValue;
}

/** One item write inside a transition, conditional on the value the service read. */
export interface MaterialRequestItemWrite {
  id: string;
  expectedReceivedQuantity: Prisma.Decimal | null;
  expectedReceivedAt: Date | null;
  receivedQuantity: Prisma.Decimal | null;
  receivedAt: Date | null;
  receivedById: string;
}

/**
 * WHAT A CALLER MAY SEE (#1582 P5b): the worksheets of its service scope,
 * and, where it asked for them, the project requests (`project` null: none).
 */
export interface MaterialRequestScope {
  worksheet: Prisma.WorksheetWhereInput;
  project: Prisma.MaterialRequestWhereInput | null;
}

/** The scope as one filter: the worksheet branch, or either branch. */
export function scopeWhere(
  scope: MaterialRequestScope,
): Prisma.MaterialRequestWhereInput {
  return scope.project
    ? { OR: [{ worksheet: scope.worksheet }, scope.project] }
    : { worksheet: scope.worksheet };
}

/** Thrown inside a transition transaction to roll it back on a lost race. */
export class MaterialRequestRaceLost extends Error {}

const LIST_PAGE_SIZE = 50;

const rowInclude = {
  requestedBy: { select: { displayName: true } },
  receivedBy: { select: { displayName: true } },
  handler: { select: { displayName: true } },
  orderedBy: { select: { displayName: true } },
  cancelledBy: { select: { displayName: true } },
  items: { orderBy: { position: "asc" } },
} satisfies Prisma.MaterialRequestInclude;

const contextInclude = {
  ...rowInclude,
  worksheet: {
    select: {
      number: true,
      customer: { select: { displayName: true } },
      department: { select: { name: true } },
    },
  },
  project: { select: { projectNumber: true, name: true } },
} satisfies Prisma.MaterialRequestInclude;

type IncludedRow = Prisma.MaterialRequestGetPayload<{
  include: typeof rowInclude;
}>;
type IncludedContextRow = Prisma.MaterialRequestGetPayload<{
  include: typeof contextInclude;
}>;

function toRow(row: IncludedRow): MaterialRequestRow {
  return {
    id: row.id,
    worksheetId: row.worksheetId,
    projectId: row.projectId,
    status: row.status,
    requestedById: row.requestedById,
    requestedByName: row.requestedBy?.displayName ?? null,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    receivedAt: row.receivedAt,
    receivedByName: row.receivedBy?.displayName ?? null,
    items: row.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      quantityValue: item.quantityValue,
      receivedQuantity: item.receivedQuantity,
      receivedAt: item.receivedAt,
    })),
    handlerId: row.handlerId,
    handlerName: row.handler?.displayName ?? null,
    handlerAssignedAt: row.handlerAssignedAt,
    orderedAt: row.orderedAt,
    orderedByName: row.orderedBy?.displayName ?? null,
    cancelledAt: row.cancelledAt,
    cancelledByName: row.cancelledBy?.displayName ?? null,
    note: row.note,
    neededBy: row.neededBy,
    priority: row.priority,
  };
}

function toContextRow(row: IncludedContextRow): MaterialRequestContextRow {
  return {
    ...toRow(row),
    worksheetNumber: row.worksheet?.number ?? null,
    customerDisplayName: row.worksheet?.customer.displayName ?? null,
    departmentName: row.worksheet?.department.name ?? null,
    projectNumber: row.project?.projectNumber ?? null,
    projectName: row.project?.name ?? null,
  };
}

/** The statuses one overview view shows. */
export function viewStatuses(
  view: MaterialRequestView,
): MaterialRequestStatus[] {
  switch (view) {
    case "active":
    case "mine":
      return [...MATERIAL_REQUEST_ACTIVE_STATUSES];
    case "received":
      return ["RECEIVED"];
    case "cancelled":
      return ["CANCELLED"];
  }
}

/**
 * A PROJECT'S MATERIAL REQUEST, written by the quote handoff (#1582 P6) in
 * its own transaction: OPEN at once (nothing for a person to submit), with
 * the SUBMITTED history row the worksheet path writes at its submit. Each
 * line names the BOM item it is the shortage of; a product line also its OS
 * product. No notification: the worksheet ones do not fit a project, and the
 * purchasers see it in the overview.
 */
export async function createProjectMaterialRequest(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    requestedById: string;
    note: string;
    items: ReadonlyArray<{
      name: string;
      quantity: string;
      unit: string;
      variantId: string | null;
      quoteBomItemId: string;
    }>;
  },
): Promise<{ id: string }> {
  const request = await tx.materialRequest.create({
    data: {
      projectId: input.projectId,
      requestedById: input.requestedById,
      status: "OPEN",
      submittedAt: new Date(),
      note: input.note,
      items: {
        create: input.items.map((item, index) => ({
          position: index,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          quantityValue: parseQuantityValue(item.quantity),
          variantId: item.variantId,
          quoteBomItemId: item.quoteBomItemId,
        })),
      },
    },
    select: { id: true },
  });
  await tx.materialRequestEvent.create({
    data: {
      materialRequestId: request.id,
      kind: "SUBMITTED",
      toStatus: "OPEN",
      actorUserId: input.requestedById,
    },
  });
  return request;
}

@Injectable()
export class MaterialRequestsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * PISZKOZATKENT HOZZA LETRE -- a `MaterialRequestStatus.DRAFT` az
   * adatbazis-alapertelmezes, itt nincs kulon iras. A fej es a tetelek EGY
   * tranzakcioban jonnek letre (a Prisma beagyazott `create` ezt magatol
   * biztositja), tehat felig felvitt igeny nem allhat elo.
   *
   * ERTESITES NEM INNEN INDUL -- lasd `submit`.
   */
  async create(input: {
    worksheetId: string;
    requestedById: string | null;
    items: readonly MaterialRequestItemInput[];
    note?: string | null;
    neededBy?: Date | null;
    priority?: MaterialRequestPriorityValue | null;
  }): Promise<MaterialRequestRow> {
    const row = await this.database.materialRequest.create({
      data: {
        worksheetId: input.worksheetId,
        requestedById: input.requestedById,
        note: input.note ?? null,
        neededBy: input.neededBy ?? null,
        priority: input.priority ?? null,
        items: {
          create: input.items.map((item, index) => ({
            position: index,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            // V2: the number, only when the text is a plain number
            quantityValue: parseQuantityValue(item.quantity),
          })),
        },
      },
      include: rowInclude,
    });
    return toRow(row);
  }

  /**
   * ATOMI, FELTETELES ATMENET, UGYANAZ A MINTA, MINT A `markReceived`-nel:
   * csak akkor ir, ha MEG `DRAFT` ES a hivo a SAJAT piszkozatat kuldi el --
   * a masik ember piszkozatanak elkuldese nem irasi jog kerdese, hanem
   * tulajdon kerdese.
   */
  async submit(input: {
    id: string;
    requestedById: string;
  }): Promise<MaterialRequestRow | null> {
    const submitted = await this.database.$transaction(async (tx) => {
      const eredmeny = await tx.materialRequest.updateMany({
        where: {
          id: input.id,
          status: "DRAFT",
          requestedById: input.requestedById,
        },
        data: { status: "OPEN", submittedAt: new Date() },
      });
      if (eredmeny.count === 0) return false;
      // V2: the first history row, in the same transaction as the transition
      await tx.materialRequestEvent.create({
        data: {
          materialRequestId: input.id,
          kind: "SUBMITTED",
          fromStatus: "DRAFT",
          toStatus: "OPEN",
          actorUserId: input.requestedById,
        },
      });
      return true;
    });
    if (!submitted) return null;
    return this.detail(input.id);
  }

  /**
   * A PISZKOZATOK REJTETTEK, KIVEVE A SAJATJAT -- Balazs kerese: "a
   * szervizes lassa a sajat piszkozatat a munkalapon". Masok piszkozata nem
   * kesz tartalom, tehat a lista nem mutatja -- ez NEM jogosultsagi
   * kerdes (mindenki, aki a lapot latja, ide is jogosult lenne), hanem a
   * TARTALOM allapota.
   */
  async listForWorksheet(
    worksheetId: string,
    actorId: string,
  ): Promise<MaterialRequestRow[]> {
    const rows = await this.database.materialRequest.findMany({
      where: {
        worksheetId,
        OR: [{ status: { not: "DRAFT" } }, { requestedById: actorId }],
      },
      include: rowInclude,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRow);
  }

  async detail(id: string): Promise<MaterialRequestRow | null> {
    const row = await this.database.materialRequest.findUnique({
      where: { id },
      include: rowInclude,
    });
    return row ? toRow(row) : null;
  }

  /**
   * A BESZERZO SAJAT LISTAJA: a meg nyitott igenyek, a legregebbi elol -- azt
   * kell eloszor elintezni, ami legregebben var.
   *
   * A MUNKALAP-KONTEXTUS EGYUTT JON (customer, department), mert a beszerzo
   * TOBB igeny kozott tajekozodik, es egyetlen igeny onmagaban nem mondja
   * meg, MELYIK munkarol van szo.
   */
  async listPending(
    visibleWorksheet: Prisma.WorksheetWhereInput,
  ): Promise<MaterialRequestContextRow[]> {
    const rows = await this.database.materialRequest.findMany({
      // V2: scoped to the worksheets the caller can see (hidden excluded)
      where: { status: "OPEN", worksheet: visibleWorksheet },
      include: contextInclude,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toContextRow);
  }

  /**
   * AZ ELOZMENYEK -- `OPEN` ES `RECEIVED` EGYARANT, A `DRAFT` NEM. Balazs
   * kerese, 2026-09-23 20:08:57 UTC: "vissza lehessen nezni, mi volt az
   * igeny, mikor erkezett, mikor ment ra a valasz". A DRAFT nem elozmeny --
   * meg nem tortent vele semmi, amit vissza lehetne nezni (lasd a
   * `MaterialRequestStatus.DRAFT` sema-fejlecet).
   *
   * A LEGUJABB KULDES ELOL: forditott sorrend a `listPending`-hez kepest.
   * Ott a legregebben varo all elol, mert a TEENDOT mutatjuk; itt a
   * legutobb tortent esemeny erdekel, mert a MULTAT nezzuk vissza.
   */
  async listHistory(
    visibleWorksheet: Prisma.WorksheetWhereInput,
  ): Promise<MaterialRequestContextRow[]> {
    const rows = await this.database.materialRequest.findMany({
      // V2: every submitted state (all but DRAFT), scoped like the list
      where: { status: { not: "DRAFT" }, worksheet: visibleWorksheet },
      include: contextInclude,
      orderBy: { submittedAt: "desc" },
    });
    return rows.map(toContextRow);
  }

  /** Akiknel a `MATERIAL_REQUEST_CREATED` ertesulesi szerep be van jelolve. */
  async notificationRecipients(): Promise<ActiveUserContact[]> {
    const rows = await this.database.userNotificationRole.findMany({
      where: { role: "MATERIAL_REQUEST_CREATED", user: { isActive: true } },
      select: {
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    });
    return rows.map((row) => row.user);
  }

  /** Van-e bejelolve nala a beerkezes-jelolo kepesseg. */
  /** The purchaser's menu number: requests waiting to be taken over. */
  async countPending(
    visibleWorksheet: Prisma.WorksheetWhereInput,
  ): Promise<number> {
    return this.database.materialRequest.count({
      where: { status: "OPEN", worksheet: visibleWorksheet },
    });
  }

  /**
   * Anyone else's menu number: their own requests that are sent and not
   * finished. A draft is not counted (it has not been asked for yet).
   */
  async countOwnOpen(
    userId: string,
    visibleWorksheet: Prisma.WorksheetWhereInput,
  ): Promise<number> {
    return this.database.materialRequest.count({
      where: {
        requestedById: userId,
        status: {
          in: ["OPEN", "IN_PROGRESS", "ORDERED", "PARTIALLY_RECEIVED"],
        },
        worksheet: visibleWorksheet,
      },
    });
  }

  async hasMarkReceivedCapability(userId: string): Promise<boolean> {
    const row = await this.database.userServiceCapability.findUnique({
      where: {
        userId_capability: {
          userId,
          capability: "MATERIAL_REQUEST_MARK_RECEIVED",
        },
      },
    });
    return row !== null;
  }

  /**
   * VAN-E AKTIV FELHASZNALO, AKI JELOLHET BEERKEZEST -- BARKI, NEM EGY
   * KONKRET SZEMELY.
   *
   * A `hasMarkReceivedCapability`-tol KULON metodus, mert mas a kerdes: az
   * egy KONKRET felhasznalorol kerdez (a hivo maga), ez pedig arrol, hogy
   * LETEZIK-E EGYALTALAN ilyen valaki -- lasd a `submit()` hivo helyet, miert
   * kell ez a kulonbseg.
   *
   * `findFirst`, NEM `count`: a kerdesre az elso talalat is valaszol, a
   * `@@index([capability])` pedig pontosan erre a mintara all.
   */
  async anyActiveMarkReceivedCapabilityHolder(): Promise<boolean> {
    const row = await this.database.userServiceCapability.findFirst({
      where: {
        capability: "MATERIAL_REQUEST_MARK_RECEIVED",
        user: { isActive: true },
      },
      select: { userId: true },
    });
    return row !== null;
  }

  /**
   * A CIMZETTEK AKTIV, LETEZO SORAI -- A KERO ES A FELELOSOK EMAIL-CIMEHEZ.
   *
   * CSAK AKTIV FELHASZNALO, ugyanaz a szabaly, mint a `notificationRecipients`-nel:
   * egy kilepett kollega nem kap levelet.
   */
  async activeUsersByIds(
    userIds: readonly string[],
  ): Promise<ActiveUserContact[]> {
    if (userIds.length === 0) return [];
    return this.database.user.findMany({
      where: { id: { in: [...userIds] }, isActive: true },
      select: { id: true, email: true, displayName: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
  }

  // -------------------------------------------------------------------------
  // V2 (docs/material-requests/v2-discovery.md)

  /** The caller's assigned units (expanded), for `worksheetListWheres`. */
  async assignedUnitIds(userId: string): Promise<string[]> {
    return assignedUnitIdsFor(userId);
  }

  /** One request with its worksheet context, only if its worksheet is visible. */
  async findVisible(
    id: string,
    scope: MaterialRequestScope,
  ): Promise<MaterialRequestContextRow | null> {
    const row = await this.database.materialRequest.findFirst({
      where: { id, AND: [scopeWhere(scope)] },
      include: contextInclude,
    });
    return row ? toContextRow(row) : null;
  }

  async events(id: string): Promise<MaterialRequestEventRow[]> {
    const rows = await this.database.materialRequestEvent.findMany({
      where: { materialRequestId: id },
      include: { actor: { select: { displayName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorName: row.actor?.displayName ?? null,
      createdAt: row.createdAt,
      payload: row.payload,
    }));
  }

  async comments(id: string): Promise<MaterialRequestCommentRow[]> {
    const rows = await this.database.materialRequestComment.findMany({
      where: { materialRequestId: id },
      include: { author: { select: { displayName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      authorName: row.author?.displayName ?? null,
      createdAt: row.createdAt,
    }));
  }

  async addComment(input: {
    materialRequestId: string;
    authorId: string;
    body: string;
  }): Promise<void> {
    await this.database.materialRequestComment.create({
      data: {
        materialRequestId: input.materialRequestId,
        authorId: input.authorId,
        body: input.body,
      },
    });
  }

  /**
   * THE OVERVIEW LIST: one query, scoped, filtered and searched on the
   * server, paged by a (submittedAt, id) cursor. Newest submission first.
   */
  async list(input: {
    scope: MaterialRequestScope;
    view: MaterialRequestView;
    status: MaterialRequestStatus | null;
    handlerId: string | null;
    q: string | null;
    cursor: { submittedAt: Date; id: string } | null;
  }): Promise<{
    rows: MaterialRequestContextRow[];
    next: { submittedAt: Date; id: string } | null;
  }> {
    const statuses = viewStatuses(input.view);
    const search: Prisma.MaterialRequestWhereInput[] = input.q
      ? [
          {
            OR: [
              {
                worksheet: {
                  number: { contains: input.q, mode: "insensitive" },
                },
              },
              {
                worksheet: {
                  customer: {
                    displayName: { contains: input.q, mode: "insensitive" },
                  },
                },
              },
              {
                worksheet: {
                  department: {
                    name: { contains: input.q, mode: "insensitive" },
                  },
                },
              },
              {
                items: {
                  some: { name: { contains: input.q, mode: "insensitive" } },
                },
              },
              // P5b: a project's request by its project's number or name
              {
                project: {
                  OR: [
                    {
                      projectNumber: { contains: input.q, mode: "insensitive" },
                    },
                    { name: { contains: input.q, mode: "insensitive" } },
                  ],
                },
              },
              {
                requestedBy: {
                  displayName: { contains: input.q, mode: "insensitive" },
                },
              },
              {
                handler: {
                  displayName: { contains: input.q, mode: "insensitive" },
                },
              },
            ],
          },
        ]
      : [];
    const where: Prisma.MaterialRequestWhereInput = {
      AND: [
        scopeWhere(input.scope),
        {
          status: input.status
            ? statuses.includes(input.status)
              ? input.status
              : { in: [] }
            : { in: statuses },
        },
        input.handlerId ? { handlerId: input.handlerId } : {},
        ...search,
        input.cursor
          ? {
              OR: [
                { submittedAt: { lt: input.cursor.submittedAt } },
                {
                  submittedAt: input.cursor.submittedAt,
                  id: { lt: input.cursor.id },
                },
              ],
            }
          : {},
      ],
    };
    const rows = await this.database.materialRequest.findMany({
      where,
      include: contextInclude,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: LIST_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, LIST_PAGE_SIZE).map(toContextRow);
    const last = page[page.length - 1];
    return {
      rows: page,
      next:
        rows.length > LIST_PAGE_SIZE && last?.submittedAt
          ? { submittedAt: last.submittedAt, id: last.id }
          : null,
    };
  }

  /** The overview's status cards: one grouped count, plus RECEIVED since `receivedSince`. */
  async statusCounts(
    scope: MaterialRequestScope,
    receivedSince: Date,
  ): Promise<{
    byStatus: Partial<Record<MaterialRequestStatus, number>>;
    receivedRecently: number;
  }> {
    const [groups, receivedRecently] = await Promise.all([
      this.database.materialRequest.groupBy({
        by: ["status"],
        where: {
          status: { in: [...MATERIAL_REQUEST_ACTIVE_STATUSES] },
          AND: [scopeWhere(scope)],
        },
        _count: { _all: true },
      }),
      this.database.materialRequest.count({
        where: {
          status: "RECEIVED",
          receivedAt: { gte: receivedSince },
          AND: [scopeWhere(scope)],
        },
      }),
    ]);
    const byStatus: Partial<Record<MaterialRequestStatus, number>> = {};
    for (const group of groups) byStatus[group.status] = group._count._all;
    return { byStatus, receivedRecently };
  }

  /**
   * EVERY V2 TRANSITION GOES THROUGH HERE, IN ONE TRANSACTION:
   *   1. a conditional update of the request, on the status AND the handler
   *      the service read and validated (count 0 = someone was faster);
   *   2. each item write, conditional on the value the service read;
   *   3. the history rows.
   * A lost race on any step rolls everything back and returns `false`. There
   * is no read-then-write: the conditions are the check.
   */
  async transition(input: {
    id: string;
    fromStatus: MaterialRequestStatus;
    expectedHandlerId: string | null;
    data: Prisma.MaterialRequestUncheckedUpdateManyInput;
    items?: readonly MaterialRequestItemWrite[];
    events: readonly MaterialRequestEventInput[];
  }): Promise<boolean> {
    try {
      await this.database.$transaction(async (tx) => {
        const updated = await tx.materialRequest.updateMany({
          where: {
            id: input.id,
            status: input.fromStatus,
            handlerId: input.expectedHandlerId,
          },
          data: input.data,
        });
        if (updated.count === 0) throw new MaterialRequestRaceLost();
        for (const item of input.items ?? []) {
          const written = await tx.materialRequestItem.updateMany({
            where: {
              id: item.id,
              materialRequestId: input.id,
              receivedQuantity: item.expectedReceivedQuantity,
              receivedAt: item.expectedReceivedAt,
            },
            data: {
              receivedQuantity: item.receivedQuantity,
              receivedAt: item.receivedAt,
              receivedById: item.receivedById,
            },
          });
          if (written.count === 0) throw new MaterialRequestRaceLost();
        }
        for (const event of input.events)
          await tx.materialRequestEvent.create({
            data: {
              materialRequestId: input.id,
              kind: event.kind,
              fromStatus: event.fromStatus,
              toStatus: event.toStatus,
              actorUserId: event.actorUserId,
              ...(event.payload !== undefined
                ? { payload: event.payload }
                : {}),
            },
          });
      });
      return true;
    } catch (error) {
      if (error instanceof MaterialRequestRaceLost) return false;
      throw error;
    }
  }

  /** The reassignment list: active users holding the purchasing capability. */
  async handlerOptions(): Promise<{ id: string; displayName: string }[]> {
    const rows = await this.database.userServiceCapability.findMany({
      where: {
        capability: "MATERIAL_REQUEST_MARK_RECEIVED",
        user: { isActive: true },
      },
      select: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    });
    return rows.map((row) => row.user);
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import {
  MATERIAL_REQUEST_VIEWS,
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
  type MaterialRequestActions,
  type MaterialRequestDetail,
  type MaterialRequestFullDetail,
  type MaterialRequestHandlerOption,
  type MaterialRequestHistoryListResponse,
  type MaterialRequestListResponse,
  type MaterialRequestPage,
  type MaterialRequestStatusCounts,
  type MaterialRequestStatusValue,
  type MaterialRequestSummary,
  type MaterialRequestContext,
  type MaterialRequestView,
  type PendingMaterialRequestListResponse,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import { worksheetListWheres } from "../worksheets/worksheets.repository.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { TicketMailService } from "../notifications/mail/ticket-mail.service.js";
import { TICKET_MAIL_ENV } from "../notifications/mail/gmail-mail.sender.js";
import { internalWorksheetLink } from "./material-request-link.js";
import { materialRequestItemsText } from "./material-request-item-text.js";
import type {
  CreateMaterialRequestDto,
  MaterialRequestListQueryDto,
  MaterialRequestReceiveItemsDto,
} from "./dto/material-request.dto.js";
import {
  applyItemReceipts,
  availableActions,
  isLeader,
  itemArrived,
  receiveAllItems,
  statusFromItems,
  type WorkflowItem,
} from "./material-request-workflow.js";
import {
  MaterialRequestsRepository,
  type MaterialRequestContextRow,
  type MaterialRequestEventInput,
  type MaterialRequestItemWrite,
  type MaterialRequestRow,
  type MaterialRequestScope,
} from "./material-requests.repository.js";

const RECEIVED_CARD_DAYS = 7;

/**
 * THE WORKSHEET OF A WORKSHEET-ONLY STEP (#1582 P5b). Drafting, submitting
 * and the worksheet's own list belong to the service; a project's request
 * (a quote handoff's shortage) never goes through them, and is refused
 * plainly if it reaches one.
 */
function worksheetIdOf(row: { worksheetId: string | null }): string {
  if (!row.worksheetId)
    throw new ConflictException(
      "Ez az anyagigény egy projekthez tartozik, nem munkalaphoz.",
    );
  return row.worksheetId;
}

function contextOf(row: MaterialRequestContextRow): MaterialRequestContext {
  return row.projectId
    ? {
        type: "PROJECT",
        projectId: row.projectId,
        projectNumber: row.projectNumber ?? "",
        projectName: row.projectName ?? "",
      }
    : {
        type: "WORKSHEET",
        worksheetId: row.worksheetId ?? "",
        worksheetNumber: row.worksheetNumber,
      };
}

function toResponse(row: MaterialRequestRow): MaterialRequestDetail {
  return {
    id: row.id,
    worksheetId: row.worksheetId,
    projectId: row.projectId,
    status: row.status,
    requestedByName: row.requestedByName,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    receivedByName: row.receivedByName,
    items: row.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      quantityValue: item.quantityValue?.toString() ?? null,
      receivedQuantity: item.receivedQuantity?.toString() ?? null,
      receivedAt: item.receivedAt?.toISOString() ?? null,
      // a RECEIVED request from before V2 has no item-level marks: it counts
      // as fully arrived, exactly as it did (no invented per-item rows)
      arrived: row.status === "RECEIVED" || itemArrived(item),
    })),
    handlerId: row.handlerId,
    handlerName: row.handlerName,
    handlerAssignedAt: row.handlerAssignedAt?.toISOString() ?? null,
    orderedAt: row.orderedAt?.toISOString() ?? null,
    orderedByName: row.orderedByName,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByName: row.cancelledByName,
    note: row.note,
    neededBy: row.neededBy?.toISOString().slice(0, 10) ?? null,
    priority: row.priority,
  };
}

function toSummary(row: MaterialRequestContextRow): MaterialRequestSummary {
  return {
    ...toResponse(row),
    worksheetNumber: row.worksheetNumber,
    customerDisplayName: row.customerDisplayName,
    departmentName: row.departmentName,
    context: contextOf(row),
  };
}

/** The list cursor: the last row's submission time and id, opaque to clients. */
function encodeCursor(next: { submittedAt: Date; id: string }): string {
  return Buffer.from(`${next.submittedAt.toISOString()}|${next.id}`).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { submittedAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const submittedAt = new Date(at ?? "");
  if (!id || Number.isNaN(submittedAt.getTime()))
    throw new BadRequestException("Érvénytelen lapozási jel.");
  return { submittedAt, id };
}

const STATUS_VALUES: readonly MaterialRequestStatusValue[] = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

function toWorkflowItems(row: MaterialRequestRow): WorkflowItem[] {
  return row.items.map((item) => ({
    id: item.id,
    quantityValue: item.quantityValue,
    receivedQuantity: item.receivedQuantity,
    receivedAt: item.receivedAt,
  }));
}

/** The item writes from `before` to `after`, conditional on what was read. */
function itemWrites(
  before: readonly WorkflowItem[],
  after: readonly WorkflowItem[],
  changedIds: readonly string[],
  actorId: string,
): MaterialRequestItemWrite[] {
  const old = new Map(before.map((item) => [item.id, item]));
  return after
    .filter((item) => changedIds.includes(item.id))
    .map((item) => ({
      id: item.id,
      expectedReceivedQuantity: old.get(item.id)?.receivedQuantity ?? null,
      expectedReceivedAt: old.get(item.id)?.receivedAt ?? null,
      receivedQuantity: item.receivedQuantity,
      receivedAt: item.receivedAt,
      receivedById: actorId,
    }));
}

@Injectable()
export class MaterialRequestsService {
  private readonly logger = new Logger(MaterialRequestsService.name);

  constructor(
    private readonly repository: MaterialRequestsRepository,
    private readonly worksheets: WorksheetsService,
    private readonly notifications: NotificationsService,
    private readonly ticketMail: TicketMailService,
    /**
     * A `WEB_URL`-hez -- UGYANAZ A TOKEN, MINT A `TicketMailService`-nel.
     *
     * MERVE (a szeletelesi verifikacio kozben): dekoralatlan konstruktor-
     * parameter `Object` tipuskent probal DI-t kotni, es a teljes fuggosegi
     * grafot felepito `app.bootstrap.spec.ts` ezt ELVERI, mert `Object`
     * nincs regisztralva providerkent. `@Optional() @Inject(TICKET_MAIL_ENV)`
     * ugyanugy old fel egy hianyzo providert `process.env`-re, mint a
     * `TicketMailService`-nel -- csak DEKORALVA, hogy Nest tudja, MELYIK
     * tokent keresse.
     */
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async listForWorksheet(
    worksheetId: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestListResponse> {
    const scope = requireInternalWriter(actor, "Az anyagigények megtekintése");
    // A letezes- es hatokor-ellenorzes: 404, ha a lap nincs vagy nem az
    // actore -- ugyanaz a hiba mindket esetben, lasd a `WorksheetsService`
    // fejleceit.
    await this.worksheets.detail(worksheetId, scope);
    const rows = await this.repository.listForWorksheet(worksheetId, actor.id);
    return { items: rows.map(toResponse) };
  }

  /**
   * PISZKOZATKENT MENTI -- ERTESITES INNEN MEG NEM INDUL, lasd `submit`.
   *
   * JAVITVA: az elso valtozat itt egy hivasban letrehozta ES el is kuldte
   * az igenyt (acrobot javitasa elott ez tunt a Balazs-kerest legegyszerubben
   * fedo alaknak). acrobot kikotese, 2026-09-22 22:52:23 UTC: a letrehozas es
   * a kuldes KET KULON muvelet, es ezt az API-retegnek kell tudnia, nem a
   * feluletnek kitalalnia -- lasd a `MaterialRequestStatus` sema-fejlecet.
   *
   * A VALASZ AZ UJ SOR, NEM A TELJES LISTA -- ES EZ SZANDEKOSAN MAS, MINT A
   * `submit`/`receive`. Azoknal a "teljes lista" azert kell, mert egy MAR
   * LATHATO sort valtoztatnak, es a felulet listaja addigra stale lenne. Egy
   * UJ sor eseten ez a veszely nem all: semmilyen korabban renderelt lista
   * nem allithatta rola, hogy MAS allapotban van. A hivonak viszont AZONNAL
   * kell az UJ SOR AZONOSITOJA a kovetkezo lepeshez (`submit`).
   */
  async create(
    worksheetId: string,
    input: CreateMaterialRequestDto,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestDetail> {
    const scope = requireInternalWriter(actor, "Anyagigény felvitele");
    await this.worksheets.detail(worksheetId, scope);

    const row = await this.repository.create({
      worksheetId,
      requestedById: actor.id,
      items: input.items.map((item) => ({
        name: item.name.trim(),
        quantity: item.quantity.trim(),
        unit: item.unit.trim(),
      })),
      // V2, all optional
      note: input.note?.trim() || null,
      neededBy: input.neededBy
        ? new Date(`${input.neededBy}T00:00:00.000Z`)
        : null,
      priority: input.priority ?? null,
    });
    return toResponse(row);
  }

  /**
   * A KULDES -- EZ INDITJA AZ ELSO ERTESITESI KORT, ES CSAK EZ.
   *
   * SAJAT PISZKOZAT: a repository felteteles irasa (`status: DRAFT` ES
   * `requestedById: actor.id`) zarja ki, hogy valaki maskiet kuldje el --
   * ez tulajdon kerdese, nem altalanos irasi jog, ezert a
   * `requireInternalWriter` ONMAGABAN nem eleg ide (az csak a belsos
   * hatokort adja).
   *
   * === A `warning` MEZO, ES MIERT PONT ITT ALL ===
   *
   * Balazs kerese, 2026-09-22 20:28:56 UTC: a beerkezes-jelolo kepesseg
   * (MATERIAL_REQUEST_MARK_RECEIVED) KULON jelolo, es senkinel sincs
   * alapertelmezetten bejelolve. Ha a kuldes pillanataban SENKI nem viseli,
   * az elkuldott igeny orokre nyitva maradna, es errol semmi nem szolna --
   * acrobot kifejezett tiltasa: "ezt nem hallgatassal kezeljuk".
   *
   * MIERT A SUBMIT, ES NEM A `listPending` 403-AGA: a beszerzok listaja
   * MAGA IS a kepessegen all (menupont szinten is), tehat aki nem birtokolja,
   * annak MEG A MENUPONT SEM latszik -- egy ott elhelyezett figyelmeztetes
   * olyan szobaba szolna, ahova senki nem lep be. A kuldo szervizes viszont
   * BIZTOSAN ott van, epp akkor, amikor az allapot keletkezik.
   *
   * A LEKERDEZES (`anyActiveMarkReceivedCapabilityHolder`) EZERT KIZAROLAG
   * ITT fut, nem minden listazasban -- `findFirst`, nem `count`, es csak a
   * KULDES agaban, ahogy acrobot kerte.
   *
   * A FIGYELMEZTETES NEM AKADALYOZZA A KULDEST: az igeny akkor is letrejon,
   * ha senki nem tudja majd jelolni. Ez tajekoztatas, nem kapu.
   */
  async submit(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestListResponse> {
    const scope = requireInternalWriter(actor, "Anyagigény elküldése");

    const before = await this.repository.detail(id);
    if (!before) throw new ConflictException("Az anyagigény nem található.");
    if (before.status !== "DRAFT")
      throw new ConflictException(
        "Az anyagigényt már elküldték, vagy nem piszkozat.",
      );
    if (before.requestedById !== actor.id)
      throw new ForbiddenException("Csak a saját piszkozatodat küldheted el.");

    const worksheet = await this.worksheets.detail(
      worksheetIdOf(before),
      scope,
    );
    const updated = await this.repository.submit({
      id,
      requestedById: actor.id,
    });
    if (!updated)
      throw new ConflictException(
        "Az anyagigényt már elküldték, vagy nem piszkozat.",
      );

    void this.ertesitsLetrehozasrol(
      updated,
      worksheet.customer.displayName,
      // a draft worksheet has no number yet: the linked ticket's, as the
      // signature mail does (2026-09-29: "Új anyagigény:" went out empty)
      worksheet.number ?? worksheet.serviceJob?.jobNumber ?? null,
    );
    const response = await this.listForWorksheet(worksheetIdOf(before), actor);
    const vanKiJelolje =
      await this.repository.anyActiveMarkReceivedCapabilityHolder();
    if (!vanKiJelolje)
      return {
        ...response,
        warning:
          "Az anyagigény elküldve, de ma senki nem tudja elintézni: az „Anyagbeszerzés intézése” jog senkinél nincs bejelölve. Szólj valakinek, aki a felhasználókat kezeli.",
      };
    return response;
  }

  private async ertesitsLetrehozasrol(
    row: MaterialRequestRow,
    customerDisplayName: string,
    worksheetNumber: string | null,
  ): Promise<void> {
    /*
      A KET KULDES EGY HALMAZT KAP, ugyanazon okbol, mint a hibajegy-nyitas
      ertesiteseinel: a cimzetteket EGYSZER kerdezzuk le, es ugyanazt adjuk a
      push-nak es a levelnek.
    */
    // a project's request (P5b) has no worksheet to point at; its notices
    // come with the handoff (P6)
    const worksheetId = row.worksheetId;
    if (!worksheetId) return;
    try {
      const recipients = await this.repository.notificationRecipients();
      if (recipients.length === 0) return;

      this.notifications.notifyMaterialRequestCreated({
        materialRequestId: row.id,
        worksheetId,
        worksheetLabel: customerDisplayName,
        userIds: recipients.map((recipient) => recipient.id),
      });

      this.ticketMail.notifyMaterialRequestCreated({
        materialRequestId: row.id,
        worksheetNumber,
        worksheetLink: internalWorksheetLink({
          webUrl: this.environment.WEB_URL,
          worksheetId,
        }),
        requesterName: row.requestedByName ?? "Kolléga",
        itemsText: materialRequestItemsText(row.items),
        recipients,
      });
    } catch (cause) {
      // Lasd a `ServiceJobsService.ertesitsUgyfelBejelentesrol` fejleceit: a
      // mar tarolt igeny nem veszhet el egy ertesitesi hiba miatt.
      this.logger.warn(
        `Az anyagigény értesítése nem sikerült (${row.id}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    }
  }

  /**
   * A BESZERZO SAJAT LISTAJA. A jog KIFEJEZETT: a `SERVICE_MANAGE`
   * csak a belsos irast engedi, a lista lathatosaga a
   * `MATERIAL_REQUEST_MARK_RECEIVED` kepessegen all -- ket kulon jelolo,
   * ket kulon ellenorzes.
   */
  async listPending(
    actor: AuthenticatedUser,
  ): Promise<PendingMaterialRequestListResponse> {
    requireInternalWriter(actor, "A beszerzésre váró anyagigények listája");
    const allowed = await this.repository.hasMarkReceivedCapability(actor.id);
    if (!allowed)
      throw new ForbiddenException(
        'A beszerzésre váró anyagigények listája: nincs bejelölve nálad az "anyag beérkezett" jelölés joga.',
      );
    const rows = await this.repository.listPending(
      await this.visibleWorksheets(actor),
    );
    return {
      items: rows.map(toSummary),
    };
  }

  /**
   * AZ ELOZMENYEK -- UGYANAZ A JOG, MINT A "RAM VARO" LISTANAL, mert
   * ugyanazon a lapon, ugyanannak a kepessegnek a birtokosa latja (acrobot
   * kerese, 2026-09-23 20:10:49 UTC: "ugyanott, ahol a pending oldal all,
   * ne nyiss uj menupontot"). Ha ez valaha SZETVALIK a "ram varo" lap
   * jogatol, ez a jelolo-kepesseg-ellenorzes az elso hely, amit at kell
   * irni.
   */
  async listHistory(
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestHistoryListResponse> {
    requireInternalWriter(actor, "Az anyagigények előzményei");
    const allowed = await this.repository.hasMarkReceivedCapability(actor.id);
    if (!allowed)
      throw new ForbiddenException(
        'Az anyagigények előzményei: nincs bejelölve nálad az "anyag beérkezett" jelölés joga.',
      );
    const rows = await this.repository.listHistory(
      await this.visibleWorksheets(actor),
    );
    return {
      items: rows.map(toSummary),
    };
  }

  /**
   * A BEERKEZES JELOLESE -- THE V1 ROUTE, KEPT FOR THE PHONES ON THE OLD
   * BUNDLE (owner decision, 2026-10-02).
   *
   * On an OPEN request a capability holder's "Anyag beérkezett" is an
   * IMPLICIT CLAIM AND RECEIVE: both CLAIMED and RECEIVED history rows are
   * written, with the same actor, in one transaction. On a claimed request
   * it is the V2 "Beérkezett" (handler or leader). Both are conditional
   * updates: of two simultaneous clicks only one wins and notifies.
   *
   * A VALASZ A TELJES, FRISS "RAM VARO" LISTA, NEM AZ EGY SOR -- ugyanaz a
   * minta, mint a `create`/`submit`-nel: a beszerzo a listat nezi, es a
   * frissen beerkeztetett sor mar nem all rajta (`listPending` csak `OPEN`
   * allapotot ad).
   */
  async receive(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PendingMaterialRequestListResponse> {
    await this.receiveAll(id, actor);
    return this.listPending(actor);
  }

  private async ertesitsBeerkezesrol(
    row: MaterialRequestRow,
    worksheet: Awaited<ReturnType<WorksheetsService["detail"]>>,
  ): Promise<void> {
    const worksheetId = row.worksheetId;
    if (!worksheetId) return;
    try {
      /*
        A CIMZETTKOR TAGABB, MINT A LETREHOZASNAL: a kero PLUSZ a munkalap
        MINDEN felelose (`WorksheetAssignee`) -- Balazs kifejezett kerese,
        lasd a `MaterialRequestReceivedNotice` fejlecet.
      */
      const userIds = [
        ...new Set(
          [
            row.requestedById,
            ...worksheet.assignees.map((a) => a.userId),
          ].filter((id): id is string => id !== null),
        ),
      ];
      if (userIds.length === 0) return;
      const recipients = await this.repository.activeUsersByIds(userIds);
      if (recipients.length === 0) return;

      this.notifications.notifyMaterialRequestReceived({
        materialRequestId: row.id,
        worksheetId,
        worksheetLabel: worksheet.customer.displayName,
        userIds: recipients.map((recipient) => recipient.id),
      });

      this.ticketMail.notifyMaterialRequestReceived({
        materialRequestId: row.id,
        worksheetNumber:
          worksheet.number ?? worksheet.serviceJob?.jobNumber ?? null,
        worksheetLink: internalWorksheetLink({
          webUrl: this.environment.WEB_URL,
          worksheetId,
        }),
        itemsText: materialRequestItemsText(row.items),
        receiverName: row.receivedByName ?? "Kolléga",
        recipients,
      });
    } catch (cause) {
      // Lasd a `create` fejleceit: a mar rogzitett beerkezes nem veszhet el
      // egy ertesitesi hiba miatt.
      this.logger.warn(
        `Az "anyag beérkezett" értesítés nem sikerült (${row.id}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // V2 (docs/material-requests/v2-discovery.md, owner decisions 2026-10-02)

  /**
   * THE ONE VISIBILITY RULE: the worksheets the caller can see on the
   * Munkalapok list, hidden ones excluded (`worksheetListWheres`). Every V2
   * list, count and detail, and the V1 lists, are scoped by it; there is no
   * second visibility query. Internal callers only (`requireInternalWriter`
   * at every entry): partner users do not see material requests in V2.
   */
  /**
   * THE MENU NUMBER (Balázs, 2026-10-05 22:10 UTC, answer 1): a purchaser
   * (the "anyag beérkezett" capability) sees the requests waiting to be taken
   * over, anyone else their own open requests. `null` for a partner: the
   * material requests are internal (`requireInternalWriter`), and the menu
   * entry they still see answers them with a 403.
   */
  async navigationCount(actor: AuthenticatedUser): Promise<number | null> {
    if (partnerScopeOf(actor).kind !== "internal") return null;
    const visible = await this.visibleWorksheets(actor);
    return (await this.repository.hasMarkReceivedCapability(actor.id))
      ? this.repository.countPending(visible)
      : this.repository.countOwnOpen(actor.id, visible);
  }

  private async visibleWorksheets(
    actor: AuthenticatedUser,
  ): Promise<Prisma.WorksheetWhereInput> {
    const scope = requireInternalWriter(actor, "Az anyagigények megtekintése");
    return worksheetListWheres(
      scope,
      await this.repository.assignedUnitIds(actor.id),
      {},
      {},
    ).counts;
  }

  /**
   * THE TWO BRANCHES (#1582 P5b, C1): the worksheet branch as before; the
   * project branch, when asked for, to whoever may buy or receive (purchasing
   * view, or the mark-received capability) in full, and otherwise to the
   * request's requester and handler.
   */
  private async scopeFor(
    actor: AuthenticatedUser,
    includeProjects: boolean,
  ): Promise<MaterialRequestScope> {
    const worksheet = await this.visibleWorksheets(actor);
    if (!includeProjects) return { worksheet, project: null };
    const all =
      hasPermission(actor, PERMISSIONS.PURCHASING_VIEW) ||
      (await this.repository.hasMarkReceivedCapability(actor.id));
    return {
      worksheet,
      project: {
        projectId: { not: null },
        ...(all
          ? {}
          : { OR: [{ requestedById: actor.id }, { handlerId: actor.id }] }),
      },
    };
  }

  private async findVisibleOr404(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestContextRow> {
    // a request opened by its id is shown whichever branch it is on
    const row = await this.repository.findVisible(
      id,
      await this.scopeFor(actor, true),
    );
    // a DRAFT is the requester's own working state: nobody else gets it
    if (!row || (row.status === "DRAFT" && row.requestedById !== actor.id))
      throw new NotFoundException("Az anyagigény nem található.");
    return row;
  }

  private async actionsFor(
    row: MaterialRequestRow,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestActions> {
    return availableActions(row, {
      id: actor.id,
      role: actor.role,
      canHandle: await this.repository.hasMarkReceivedCapability(actor.id),
    });
  }

  async list(
    actor: AuthenticatedUser,
    query: MaterialRequestListQueryDto,
  ): Promise<MaterialRequestPage> {
    const scope = await this.scopeFor(
      actor,
      query.includeProjects !== undefined,
    );
    const view: MaterialRequestView = query.view ?? "active";
    if (!(MATERIAL_REQUEST_VIEWS as readonly string[]).includes(view))
      throw new BadRequestException("Ismeretlen nézet.");
    const status = query.status ?? null;
    if (
      status !== null &&
      !STATUS_VALUES.includes(status as MaterialRequestStatusValue)
    )
      throw new BadRequestException("Ismeretlen állapot.");
    const q = query.q?.trim() || null;
    const { rows, next } = await this.repository.list({
      scope,
      view,
      status: status as MaterialRequestStatusValue | null,
      // "Saját beszerzéseim": only what the caller handles
      handlerId: view === "mine" ? actor.id : null,
      q,
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
    });
    return {
      items: rows.map(toSummary),
      nextCursor: next ? encodeCursor(next) : null,
    };
  }

  async statusCounts(
    actor: AuthenticatedUser,
    now: Date = new Date(),
    includeProjects = false,
  ): Promise<MaterialRequestStatusCounts> {
    const { byStatus, receivedRecently } = await this.repository.statusCounts(
      await this.scopeFor(actor, includeProjects),
      new Date(now.getTime() - RECEIVED_CARD_DAYS * 24 * 60 * 60 * 1000),
    );
    return {
      open: byStatus.OPEN ?? 0,
      inProgress: byStatus.IN_PROGRESS ?? 0,
      ordered: byStatus.ORDERED ?? 0,
      partiallyReceived: byStatus.PARTIALLY_RECEIVED ?? 0,
      receivedLast7Days: receivedRecently,
    };
  }

  async detail(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const row = await this.findVisibleOr404(id, actor);
    return this.fullDetail(row, actor);
  }

  private async fullDetail(
    row: MaterialRequestContextRow,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const [events, comments, actions] = await Promise.all([
      this.repository.events(row.id),
      this.repository.comments(row.id),
      this.actionsFor(row, actor),
    ]);
    return {
      ...toSummary(row),
      worksheetHref: row.worksheetId
        ? `/szerviz/munkalapok/${row.worksheetId}`
        : null,
      events: events.map((event) => {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        return {
          id: event.id,
          kind: event.kind,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          actorName: event.actorName,
          createdAt: event.createdAt.toISOString(),
          ...(event.kind === "REASSIGNED"
            ? {
                previousHandlerName:
                  typeof payload.previousHandlerName === "string"
                    ? payload.previousHandlerName
                    : null,
                newHandlerName:
                  typeof payload.newHandlerName === "string"
                    ? payload.newHandlerName
                    : null,
              }
            : {}),
        };
      }),
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorName: comment.authorName,
        createdAt: comment.createdAt.toISOString(),
      })),
      actions,
    };
  }

  /** The authoritative current request, for a 409 after a lost race. */
  private async conflict(
    id: string,
    actor: AuthenticatedUser,
    message: string,
  ): Promise<ConflictException> {
    const row = await this.findVisibleOr404(id, actor);
    return new ConflictException({
      message,
      current: await this.fullDetail(row, actor),
    });
  }

  private async refreshed(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    return this.fullDetail(await this.findVisibleOr404(id, actor), actor);
  }

  /**
   * "ÉN INTÉZEM A BESZERZÉST". A conditional update
   * (`status = OPEN AND handlerId IS NULL`) in the transaction that writes
   * the CLAIMED row: of two people clicking at once exactly one becomes the
   * handler, and the other gets 409 with the request naming who it was.
   */
  async claim(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    const actions = await this.actionsFor(before, actor);
    if (!actions.claim) {
      if (before.status !== "OPEN" || before.handlerId !== null)
        throw await this.conflict(
          id,
          actor,
          "Az anyagigény beszerzését már valaki átvette.",
        );
      throw new ForbiddenException(
        "A beszerzés átvételéhez a beszerzési jog kell.",
      );
    }
    const now = new Date();
    const won = await this.repository.transition({
      id,
      fromStatus: "OPEN",
      expectedHandlerId: null,
      data: {
        status: "IN_PROGRESS",
        handlerId: actor.id,
        handlerAssignedAt: now,
      },
      events: [
        {
          kind: "CLAIMED",
          fromStatus: "OPEN",
          toStatus: "IN_PROGRESS",
          actorUserId: actor.id,
        },
      ],
    });
    if (!won)
      throw await this.conflict(
        id,
        actor,
        "Az anyagigény beszerzését már valaki átvette.",
      );
    const after = await this.refreshed(id, actor);
    void this.notifyStep("claimed", before, [before.requestedById], actor);
    return after;
  }

  /** The handler or a leader hands the request to another purchasing user. */
  async reassign(
    id: string,
    handlerId: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    if (!(await this.actionsFor(before, actor)).reassign)
      throw new ForbiddenException(
        "Csak a beszerzés felelőse vagy egy vezető adhatja át.",
      );
    if (handlerId === before.handlerId)
      throw new BadRequestException("Ő már a felelős.");
    const target = (await this.repository.handlerOptions()).find(
      (option) => option.id === handlerId,
    );
    if (!target)
      throw new BadRequestException(
        "Csak aktív, beszerzési joggal rendelkező kollégának adható át.",
      );
    const won = await this.repository.transition({
      id,
      fromStatus: before.status,
      expectedHandlerId: before.handlerId,
      data: { handlerId, handlerAssignedAt: new Date() },
      events: [
        {
          kind: "REASSIGNED",
          fromStatus: null,
          toStatus: null,
          actorUserId: actor.id,
          payload: {
            previousHandlerId: before.handlerId,
            previousHandlerName: before.handlerName,
            newHandlerId: target.id,
            newHandlerName: target.displayName,
          },
        },
      ],
    });
    if (!won)
      throw await this.conflict(
        id,
        actor,
        "Az anyagigény közben megváltozott.",
      );
    return this.refreshed(id, actor);
  }

  /** "Megrendeltem": a state, a user and a time. No order data, no stock. */
  async order(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    if (!(await this.actionsFor(before, actor)).order)
      throw this.refuse(
        this.handlerOrLeader(before, actor),
        "Most nem rögzíthető megrendelés.",
      );
    const won = await this.repository.transition({
      id,
      fromStatus: "IN_PROGRESS",
      expectedHandlerId: before.handlerId,
      data: { status: "ORDERED", orderedAt: new Date(), orderedById: actor.id },
      events: [
        {
          kind: "ORDERED",
          fromStatus: "IN_PROGRESS",
          toStatus: "ORDERED",
          actorUserId: actor.id,
        },
      ],
    });
    if (!won)
      throw await this.conflict(
        id,
        actor,
        "Az anyagigény közben megváltozott.",
      );
    const after = await this.refreshed(id, actor);
    void this.notifyStep("ordered", before, [before.requestedById], actor);
    return after;
  }

  /**
   * ITEM-LEVEL RECEIVING (ORDERED or PARTIALLY_RECEIVED). Numeric items take
   * a new total, text items the "megjött" mark; every item write is
   * conditional on the value read, so two people receiving at once cannot
   * overwrite each other. When every item has arrived, the request is
   * RECEIVED and the existing "anyag beérkezett" notification goes out.
   */
  async receiveItems(
    id: string,
    input: MaterialRequestReceiveItemsDto,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    if (!(await this.actionsFor(before, actor)).receiveItems)
      throw this.refuse(
        this.handlerOrLeader(before, actor),
        "Most nem rögzíthető beérkezés tételenként.",
      );
    const items = toWorkflowItems(before);
    const now = new Date();
    const step = applyItemReceipts(items, input.items, now);
    if (!step.ok) throw new BadRequestException(step.message);
    const implied = statusFromItems(step.items);
    const to: MaterialRequestStatusValue = implied ?? before.status;
    const received = to === "RECEIVED";
    const won = await this.repository.transition({
      id,
      fromStatus: before.status,
      expectedHandlerId: before.handlerId,
      data: {
        status: to,
        ...(received ? { receivedAt: now, receivedById: actor.id } : {}),
      },
      items: itemWrites(items, step.items, step.changedItemIds, actor.id),
      events: [
        {
          kind: received ? "RECEIVED" : "ITEMS_RECEIVED",
          fromStatus: before.status,
          toStatus: to === before.status ? null : to,
          actorUserId: actor.id,
          payload: { itemIds: step.changedItemIds },
        },
      ],
    });
    if (!won)
      throw await this.conflict(
        id,
        actor,
        "Az anyagigény közben megváltozott.",
      );
    if (received) void this.notifyReceived(id);
    return this.refreshed(id, actor);
  }

  /**
   * "BEÉRKEZETT": every remaining item arrives in full. From a claimed state
   * by the handler or a leader (IN_PROGRESS included: the in-stock / bought
   * locally skip, visible in the history as no ORDERED row). From OPEN only
   * through the V1 route's implicit claim, see `receive`.
   */
  async receiveAll(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    if (before.status === "RECEIVED")
      throw new ConflictException(
        "Az anyagigényt már megjelölték beérkezettként.",
      );
    if (before.status === "DRAFT")
      throw new ConflictException(
        "Az anyagigény még piszkozat, nincs elküldve -- nincs mit beérkezettnek jelölni.",
      );
    const canHandle = await this.repository.hasMarkReceivedCapability(actor.id);
    const implicitClaim = before.status === "OPEN";
    if (implicitClaim) {
      if (!canHandle)
        throw new ForbiddenException(
          "Az anyag beérkezésének jelölése: nincs bejelölve nálad ez a jog.",
        );
    } else if (
      !availableActions(before, { id: actor.id, role: actor.role, canHandle })
        .receive
    )
      throw this.refuse(
        this.handlerOrLeader(before, actor),
        "Most nem jelölhető beérkezettnek.",
      );

    const items = toWorkflowItems(before);
    const now = new Date();
    const all = receiveAllItems(items, now);
    const events: MaterialRequestEventInput[] = implicitClaim
      ? [
          {
            kind: "CLAIMED",
            fromStatus: "OPEN",
            toStatus: "IN_PROGRESS",
            actorUserId: actor.id,
          },
          {
            kind: "RECEIVED",
            fromStatus: "IN_PROGRESS",
            toStatus: "RECEIVED",
            actorUserId: actor.id,
          },
        ]
      : [
          {
            kind: "RECEIVED",
            fromStatus: before.status,
            toStatus: "RECEIVED",
            actorUserId: actor.id,
          },
        ];
    const won = await this.repository.transition({
      id,
      fromStatus: before.status,
      expectedHandlerId: before.handlerId,
      data: {
        status: "RECEIVED",
        receivedAt: now,
        receivedById: actor.id,
        ...(implicitClaim
          ? { handlerId: actor.id, handlerAssignedAt: now }
          : {}),
      },
      items: itemWrites(items, all.items, all.changedItemIds, actor.id),
      events,
    });
    if (!won)
      throw new ConflictException(
        "Az anyagigényt közben valaki más kezelte, vagy már beérkezettként jelölték.",
      );
    void this.notifyReceived(id);
    return this.refreshed(id, actor);
  }

  /**
   * VISSZAVONÁS: the requester or a leader, while OPEN or IN_PROGRESS (never
   * after ordering). If someone already handled it, they are told, so they
   * stop working on it (owner decision, 2026-10-02).
   */
  async cancel(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    if (!(await this.actionsFor(before, actor)).cancel)
      throw this.refuse(
        isLeader(actor.role) || before.requestedById === actor.id,
        "Az anyagigényt csak az igénylő vagy egy vezető vonhatja vissza, a megrendelés előtt.",
      );
    const won = await this.repository.transition({
      id,
      fromStatus: before.status,
      expectedHandlerId: before.handlerId,
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: actor.id,
      },
      events: [
        {
          kind: "CANCELLED",
          fromStatus: before.status,
          toStatus: "CANCELLED",
          actorUserId: actor.id,
        },
      ],
    });
    if (!won)
      throw await this.conflict(
        id,
        actor,
        "Az anyagigény közben megváltozott.",
      );
    const after = await this.refreshed(id, actor);
    if (before.handlerId !== null)
      void this.notifyStep("cancelled", before, [before.handlerId], actor);
    return after;
  }

  async addComment(
    id: string,
    body: string,
    actor: AuthenticatedUser,
  ): Promise<MaterialRequestFullDetail> {
    const before = await this.findVisibleOr404(id, actor);
    if (!(await this.actionsFor(before, actor)).comment)
      throw new ConflictException("A piszkozathoz nem fűzhető megjegyzés.");
    const text = body.trim();
    if (!text) throw new BadRequestException("A megjegyzés üres.");
    await this.repository.addComment({
      materialRequestId: id,
      authorId: actor.id,
      body: text,
    });
    return this.refreshed(id, actor);
  }

  /** The reassignment list: active users with the purchasing capability. */
  async handlerOptions(
    actor: AuthenticatedUser,
  ): Promise<{ items: MaterialRequestHandlerOption[] }> {
    requireInternalWriter(actor, "A beszerzők listája");
    return { items: await this.repository.handlerOptions() };
  }

  /**
   * 403 when the actor may not act on this request at all, 409 when they
   * may, but not in its current state. `mayAct` is the role / ownership half
   * of the rule, decided by the caller for the action at hand.
   */
  private refuse(
    mayAct: boolean,
    message: string,
  ): ForbiddenException | ConflictException {
    return mayAct
      ? new ConflictException(message)
      : new ForbiddenException(message);
  }

  private handlerOrLeader(
    row: MaterialRequestRow,
    actor: AuthenticatedUser,
  ): boolean {
    return isLeader(actor.role) || row.handlerId === actor.id;
  }

  private async notifyReceived(id: string): Promise<void> {
    try {
      const row = await this.repository.detail(id);
      // a project's request has no worksheet notice (P5b; P6 brings its own)
      if (!row || !row.worksheetId) return;
      const worksheet = await this.worksheets.detail(row.worksheetId, {
        kind: "internal",
      });
      await this.ertesitsBeerkezesrol(row, worksheet);
    } catch (cause) {
      this.logger.warn(
        `Az "anyag beérkezett" értesítés nem sikerült (${id}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    }
  }

  /**
   * V2 STEP NOTIFICATIONS: claim and order to the requester, withdrawal to
   * the handler. Never to the actor themself; never blocking the step.
   */
  private async notifyStep(
    step: "claimed" | "ordered" | "cancelled",
    row: MaterialRequestContextRow,
    to: readonly (string | null)[],
    actor: AuthenticatedUser,
  ): Promise<void> {
    const worksheetId = row.worksheetId;
    if (!worksheetId) return;
    try {
      const userIds = [
        ...new Set(to.filter((u): u is string => u !== null && u !== actor.id)),
      ];
      if (userIds.length === 0) return;
      const recipients = await this.repository.activeUsersByIds(userIds);
      if (recipients.length === 0) return;
      this.notifications.notifyMaterialRequestStep({
        step,
        materialRequestId: row.id,
        worksheetId,
        worksheetLabel: row.customerDisplayName ?? "",
        userIds: recipients.map((recipient) => recipient.id),
      });
      this.ticketMail.notifyMaterialRequestStep({
        step,
        materialRequestId: row.id,
        worksheetNumber: row.worksheetNumber,
        worksheetLink: internalWorksheetLink({
          webUrl: this.environment.WEB_URL,
          worksheetId,
        }),
        itemsText: materialRequestItemsText(row.items),
        actorName: actor.displayName,
        recipients,
      });
    } catch (cause) {
      this.logger.warn(
        `Az anyagigény (${step}) értesítése nem sikerült (${row.id}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    }
  }
}

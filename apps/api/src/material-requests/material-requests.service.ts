import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  MaterialRequestDetail,
  MaterialRequestHistoryListResponse,
  MaterialRequestListResponse,
  PendingMaterialRequestListResponse,
} from "@acropora/types";

import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { TicketMailService } from "../notifications/mail/ticket-mail.service.js";
import { TICKET_MAIL_ENV } from "../notifications/mail/gmail-mail.sender.js";
import { internalWorksheetLink } from "./material-request-link.js";
import { materialRequestItemsText } from "./material-request-item-text.js";
import type { CreateMaterialRequestDto } from "./dto/material-request.dto.js";
import {
  MaterialRequestsRepository,
  type MaterialRequestRow,
} from "./material-requests.repository.js";

function toResponse(row: MaterialRequestRow): MaterialRequestDetail {
  return {
    id: row.id,
    worksheetId: row.worksheetId,
    status: row.status,
    requestedByName: row.requestedByName,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    receivedByName: row.receivedByName,
    items: row.items,
  };
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

    const worksheet = await this.worksheets.detail(before.worksheetId, scope);
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
      worksheet.number,
    );
    const response = await this.listForWorksheet(before.worksheetId, actor);
    const vanKiJelolje =
      await this.repository.anyActiveMarkReceivedCapabilityHolder();
    if (!vanKiJelolje)
      return {
        ...response,
        warning:
          "Az anyagigény elküldve, de ma senki nem tudja megjelölni, ha beérkezik: az „Anyag beérkezésének jelölése” jog senkinél nincs bejelölve. Szólj valakinek, aki a felhasználókat kezeli.",
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
    try {
      const recipients = await this.repository.notificationRecipients();
      if (recipients.length === 0) return;

      this.notifications.notifyMaterialRequestCreated({
        materialRequestId: row.id,
        worksheetId: row.worksheetId,
        worksheetLabel: customerDisplayName,
        userIds: recipients.map((recipient) => recipient.id),
      });

      this.ticketMail.notifyMaterialRequestCreated({
        materialRequestId: row.id,
        worksheetNumber,
        worksheetLink: internalWorksheetLink({
          webUrl: this.environment.WEB_URL,
          worksheetId: row.worksheetId,
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
    const rows = await this.repository.listPending();
    return {
      items: rows.map((row) => ({
        ...toResponse(row),
        worksheetNumber: row.worksheetNumber,
        customerDisplayName: row.customerDisplayName,
        departmentName: row.departmentName,
      })),
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
    const rows = await this.repository.listHistory();
    return {
      items: rows.map((row) => ({
        ...toResponse(row),
        worksheetNumber: row.worksheetNumber,
        customerDisplayName: row.customerDisplayName,
        departmentName: row.departmentName,
      })),
    };
  }

  /**
   * A BEERKEZES JELOLESE. ATOMI: a repository csak akkor ir, ha az igeny MEG
   * `OPEN`, tehat ket egyidejű kattintas kozul csak az egyik ertesit.
   */
  /**
   * A VALASZ A TELJES, FRISS "RAM VARO" LISTA, NEM AZ EGY SOR -- ugyanaz a
   * minta, mint a `create`/`submit`-nel: a beszerzo a listat nezi, es a
   * frissen beerkeztetett sor mar nem all rajta (`listPending` csak `OPEN`
   * allapotot ad).
   */
  async receive(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PendingMaterialRequestListResponse> {
    const scope = requireInternalWriter(
      actor,
      "Az anyag beérkezésének jelölése",
    );
    const allowed = await this.repository.hasMarkReceivedCapability(actor.id);
    if (!allowed)
      throw new ForbiddenException(
        "Az anyag beérkezésének jelölése: nincs bejelölve nálad ez a jog.",
      );

    const before = await this.repository.detail(id);
    if (!before) throw new ConflictException("Az anyagigény nem található.");
    if (before.status === "RECEIVED")
      throw new ConflictException(
        "Az anyagigényt már megjelölték beérkezettként.",
      );
    if (before.status === "DRAFT")
      throw new ConflictException(
        "Az anyagigény még piszkozat, nincs elküldve -- nincs mit beérkezettnek jelölni.",
      );

    const updated = await this.repository.markReceived({
      id,
      receivedById: actor.id,
    });
    if (!updated)
      throw new ConflictException(
        "Az anyagigényt már megjelölték beérkezettként.",
      );

    const worksheet = await this.worksheets.detail(updated.worksheetId, scope);
    void this.ertesitsBeerkezesrol(updated, worksheet);
    return this.listPending(actor);
  }

  private async ertesitsBeerkezesrol(
    row: MaterialRequestRow,
    worksheet: Awaited<ReturnType<WorksheetsService["detail"]>>,
  ): Promise<void> {
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
        worksheetId: row.worksheetId,
        worksheetLabel: worksheet.customer.displayName,
        userIds: recipients.map((recipient) => recipient.id),
      });

      this.ticketMail.notifyMaterialRequestReceived({
        materialRequestId: row.id,
        worksheetNumber: worksheet.number,
        worksheetLink: internalWorksheetLink({
          webUrl: this.environment.WEB_URL,
          worksheetId: row.worksheetId,
        }),
        itemsText: materialRequestItemsText(row.items),
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
}

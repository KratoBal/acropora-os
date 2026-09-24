import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  aquariumMeasurementParameter,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
} from "@acropora/types";

import { aquariumMeasurementDocument } from "../../aquariums/aquarium-measurement-document.js";
import { headerSafe } from "./mail-header.js";
import { MAIL_SENDER, type MailSender } from "./mail.port.js";

/**
 * A VÍZMÉRÉS PDF-JÉNEK E-MAILBEN KÜLDÉSE -- GOMBRA, NEM AUTOMATIKUS.
 *
 * Balázs kérése (2026-09-24 14:41): "gomb... Eredmény küldése e-mailben...
 * csak ha az ügyfélnek van e-mail címe. NEM automatikus." A PDF a közös
 * arculati kereten készül (`aquarium-measurement-document.ts`), a kiküldés
 * a MEGLÉVŐ levélküldő porton megy (`MAIL_SENDER`), UGYANAZON A TERÍTŐ
 * BURKON keresztül, mint a hibajegy-csomag levelei
 * (`notifications.module.ts`: `{ provide: MAIL_SENDER, useClass:
 * RedirectingMailSender }`) -- tehát az éles kiküldés biztonsági
 * korlátozása (47630297 kártya, Balázs engedélyére vár) ITT IS érvényes,
 * anélkül hogy ez a modul tudna róla.
 *
 * A NAPLÓZÁS DOMÉN-ESEMÉNNYEL MEGY, NEM A TELJES `ticket-mail`
 * SABLON-RENDSZERREL: ennek a levélnek nincs szerkeszthető szövege
 * (a PDF hordozza a tartalmat, a kísérőszöveg rövid és fix), tehát a
 * `MailTemplateController`/`TicketMailRepository` gépezete ehhez
 * szélesebb változtatás lenne, mint amit a brief kér.
 */
@Injectable()
export class AquariumMeasurementMailService {
  constructor(
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
  ) {}

  async send(input: {
    aquariumId: string;
    aquariumName: string;
    occasion: AquariumMeasurementOccasion;
    customerEmail: string;
    customerName: string;
    actorUserId: string;
  }): Promise<void> {
    if (!this.sender)
      throw new BadRequestException(
        "Az e-mail küldés jelenleg nincs beállítva.",
      );

    const rows = input.occasion.values.map((value) => {
      const parameter = aquariumMeasurementParameter(
        value.parameterCode as AquariumMeasurementParameterCode,
      );
      return {
        label: parameter.label,
        value: value.value,
        unit: parameter.unit,
      };
    });

    const pdf = await aquariumMeasurementDocument({
      aquariumName: input.aquariumName,
      customerName: input.customerName,
      measuredAt: input.occasion.measuredAt,
      rows,
      notes: input.occasion.notes,
    });

    await this.sender.send({
      to: [input.customerEmail],
      subject: headerSafe(`Vízmérés eredménye -- ${input.aquariumName}`),
      text: [
        `Kedves ${input.customerName}!`,
        "",
        `Mellékelten küldjük a(z) ${input.aquariumName} akvárium/tó legutóbbi vízméréseinek eredményét.`,
      ].join("\n"),
      attachments: [
        {
          filename: "vizmeres.pdf",
          contentType: "application/pdf",
          bytes: pdf,
        },
      ],
    });

    await prisma.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: "aquarium-measurement.emailed",
        aggregateType: "Aquarium",
        aggregateId: input.aquariumId,
        actorUserId: input.actorUserId,
        payload: {
          occasionId: input.occasion.id,
          to: input.customerEmail,
        },
        occurredAt: new Date(),
        schemaVersion: 1,
      },
    });
  }
}

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
  renderMailTemplate,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
} from "@acropora/types";

import { aquariumMeasurementDocument } from "../../aquariums/aquarium-measurement-document.js";
import { TICKET_MAIL_ENV } from "./gmail-mail.sender.js";
import { headerSafe } from "./mail-header.js";
import { MAIL_SENDER, type MailSender } from "./mail.port.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";

/** Az esemeny neve EGYBEN a sablon kulcsa is -- lasd a `ticket-mail.service.ts` mintajat. */
export const AQUARIUM_MEASUREMENT_RESULT = "AQUARIUM_MEASUREMENT_RESULT";

/**
 * A KEZDO SZOVEG, AMIG SENKI NEM IRT SAJATOT -- a korabbi, kodba irt szoveg,
 * valtozatlanul, csak sablon-valtozokkal.
 */
export const DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE = {
  subject: "Vízmérés eredménye -- {{akvarium_neve}}",
  body: [
    "Kedves {{cimzett}}!",
    "",
    "Mellékelten küldjük a(z) {{akvarium_neve}} akvárium/tó legutóbbi vízméréseinek eredményét.",
  ].join("\n"),
} as const;

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
 * === FELADÓ ÉS SABLON, 2026-09-24-TŐL (Balázs kérése, Akváriumok szál,
 * message_id 1552727165714563153) ===
 *
 * Ez a bekezdés korábban azt állította, hogy a szerkeszthető sablon-rendszer
 * SZÁNDÉKOSAN nincs bekötve ide. Ez a mondat mostantól HAMIS, és nem
 * kiegészítve, hanem CSERÉLVE lett: a szöveg innentől a `TicketMailRepository`/
 * `MailTemplateController` gépezetéből jön, ugyanúgy, mint a hibajegy-levelek
 * (`AQUARIUM_MEASUREMENT_RESULT` a sablon-azonosító, szerkeszthető a
 * Beállítások / Levélsablonok alatt), a fenti alapértelmezéssel, amíg senki
 * nem ír sajátot.
 *
 * A FELADÓ CÍME az `AQUARIUM_MEASUREMENT_MAIL_FROM` környezeti változóból jön
 * ("send as" alias a ticket@ fiókban, Balázs állítja be). ÜRES ÉRTÉKNÉL a mai
 * viselkedés marad: a `GmailMailSender` a saját alapértelmezett feladóját
 * használja (`GMAIL_TICKET_USER`) -- lásd `mail.port.ts`. Ez NEM új token:
 * ugyanaz a küldő port, csak egy plusz mező a levélen (`OutgoingMail.from`).
 *
 * A meglévő kapu (`TICKET_MAIL_MODE` és az úthoz tartozó kapcsoló) ehhez az
 * úthoz NEM tartozik ma -- ez az út a `RedirectingMailSender` terítő kapuján
 * megy át, nem a `mailGate`/`TICKET_MAIL_MODE` gépezeten. Ez a mai állapot,
 * ezen a kör NEM változtat (Balázs kikötése).
 */
@Injectable()
export class AquariumMeasurementMailService {
  constructor(
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    private readonly templates: TicketMailRepository,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
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

    const tarolt = await this.templates.template(AQUARIUM_MEASUREMENT_RESULT);
    const sablon = tarolt ?? DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE;
    const ertekek = {
      cimzett: input.customerName,
      akvarium_neve: input.aquariumName,
    };
    const targy = renderMailTemplate(sablon.subject, ertekek);
    const torzs = renderMailTemplate(sablon.body, ertekek);
    if (!targy.ok || !torzs.ok) {
      /*
        ISMERETLEN VALTOZONAL NEM KULDUNK -- ugyanaz a szabaly, mint a
        hibajegy-leveleknel (`ticket-mail.service.ts`). Ez az ut GOMBRA fut,
        tehat a hivo (a kezelo, aki eppen kuldene) AZONNAL latja a hibat, nem
        egy naplo-sorbol kell kideritenie.
      */
      const ismeretlen = [
        ...(targy.ok ? [] : targy.unknown),
        ...(torzs.ok ? [] : torzs.unknown),
      ];
      throw new BadRequestException(
        `A levél sablonja ismeretlen változót tartalmaz: ${[...new Set(ismeretlen)].join(", ")}.`,
      );
    }

    /*
      URES KORNYEZETI ERTEKNEL `from: undefined` MEGY -- es ez SZANDEKOS: az
      `OutgoingMail.from` opcionalis, a `GmailMailSender` pedig ilyenkor a
      SAJAT alapertelmezett feladojat hasznalja. Egy ures string ide kerulve
      ugyanezt tenne (lasd `mail.port.ts` es `gmail-mail.sender.ts`), de a
      `trim() || undefined` alak nem hagy ures stringet a mezon.
    */
    const from =
      this.environment.AQUARIUM_MEASUREMENT_MAIL_FROM?.trim() || undefined;

    await this.sender.send({
      to: [input.customerEmail],
      from,
      subject: headerSafe(targy.text),
      text: torzs.text,
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

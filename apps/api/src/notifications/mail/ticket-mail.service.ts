import { renderMailTemplate } from "@acropora/types";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { TICKET_MAIL_ENV } from "./gmail-mail.sender.js";
import { MAIL_SENDER, type MailSender } from "./mail.port.js";
import { headerSafe } from "./mail-header.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";
import { ticketMailContent } from "./ticket-mail.content.js";
import {
  mailAuditNote,
  mailModeOf,
  ticketMailDecision,
  type MailSkipReason,
} from "./ticket-mail.rules.js";

/**
 * A HIBAJEGY NYITOJANAK KULDOTT ERTESITES.
 *
 * Balazs dontese, 2026-09-21 11:25:35 UTC (message_id 1551554987992289302):
 * "igen ertesitsuk, de a ticket@acropora.hu cimet hasznaljuk".
 */

/** Az esemeny neve EGYBEN a sablon kulcsa is -- lasd a sema fejlecet. */
export const WORKSHEET_SIGNED = "WORKSHEET_SIGNED";

/**
 * AZ ALAPERTELMEZETT SABLON A KODBAN ALL, ES A TABLA FELULIRJA.
 *
 * DONTES, INDOKKAL: Balazs szerkesztheto sablont kert, es azt a tabla adja.
 * De ha a tabla URES, a valasztas ket rossz kozott van:
 *
 *   nincs alapertelmezes   a telepites utani ELSO alairas nem kuld semmit,
 *                          "nincs sablon" okkal. A naplo megmondja, de a
 *                          funkcio ROMLOTTNAK latszik, es valakinek eszebe
 *                          kell jutnia, hogy sort kell felvenni.
 *   van alapertelmezes     azonnal mukodik, es Balazs akkor irja at, amikor
 *                          akarja. A szoveg attol meg SZERKESZTHETO marad.
 *
 * A masodikat valasztottam. Ez NEM mond ellent a kikotesnek ("a szoveg ne a
 * kodban alljon"): a kodban allo sor csak addig el, amig senki nem irt sajatot.
 */
export const DEFAULT_WORKSHEET_SIGNED_TEMPLATE = {
  subject: "{{jegyszam}} {{jegy_targya}}",
  body: [
    "Kedves {{cimzett}}!",
    "",
    "A(z) {{jegyszam}} számú hibajegyhez tartozó munkalapot aláírták.",
    "",
    "A bejelentés tárgya: {{jegy_targya}}",
  ].join("\n"),
} as const;

export type TicketMailOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "skipped"; readonly reason: MailSkipReason | "no-ticket" }
  | { readonly kind: "failed"; readonly unknown?: readonly string[] };

@Injectable()
export class TicketMailService {
  private readonly logger = new Logger(TicketMailService.name);

  constructor(
    private readonly repository: TicketMailRepository,
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    /* A kornyezet tokenen at jon -- lasd az indokot a `TICKET_MAIL_ENV` mellett. */
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * Fire and forget, a haz mintaja szerint: a munkalap alairasanak valasza NEM
   * fugghet attol, hogy a levelezo eppen elerheto-e.
   */
  notifyWorksheetSigned(input: {
    serviceJobId: string;
    actorUserId: string | null;
    freeText?: string | null;
  }): void {
    void this.deliverWorksheetSigned(input).catch((cause: unknown) => {
      this.logger.warn(
        `Az értesítő levél küldése nem sikerült (${input.serviceJobId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    });
  }

  /** Ugyanaz, `await`-elve, hogy a tesztek lassak a kimenetelt. */
  async deliverWorksheetSigned(input: {
    serviceJobId: string;
    actorUserId: string | null;
    freeText?: string | null;
  }): Promise<TicketMailOutcome> {
    const context = await this.repository.context(input.serviceJobId);
    if (!context) return { kind: "skipped", reason: "no-ticket" };

    const decision = ticketMailDecision({
      mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
      openedById: context.openedById,
      opener: context.opener,
    });

    if (decision.kind === "skip") {
      /*
        A KIHAGYAS NEM NEMA, ES NEM UGYANAZ AZ AG, MINT A SIKER (acrobot
        kikotese, 2026-09-21). Naplo-sort viszont CSAK akkor irunk, ha a jegyen
        egyaltalan tortent volna valami: a ZART KAPU a kornyezet allapota, nem
        a jegye -- egy "nem ment ki level" sor minden teszt-kornyezetben
        odakerulne, es a jegy naplojat toltene fel zajjal.
      */
      if (decision.reason !== "mode-off")
        await this.repository.recordNotification({
          serviceJobId: input.serviceJobId,
          note: mailAuditNote(decision),
          actorUserId: input.actorUserId,
        });
      this.logger.log(
        `Értesítő levél kihagyva (${decision.reason}), hibajegy ${input.serviceJobId}.`,
      );
      return { kind: "skipped", reason: decision.reason };
    }

    const tarolt = await this.repository.template(WORKSHEET_SIGNED);
    const sablon = tarolt ?? DEFAULT_WORKSHEET_SIGNED_TEMPLATE;
    const ertekek = {
      cimzett: decision.name,
      jegyszam: context.jobNumber,
      jegy_targya: context.title,
      jegy_leirasa: context.description ?? "",
    };

    const targy = renderMailTemplate(sablon.subject, ertekek);
    const torzs = renderMailTemplate(sablon.body, ertekek);
    if (!targy.ok || !torzs.ok) {
      /*
        ISMERETLEN VALTOZONAL NEM KULDUNK. Se ures stringgel, se nyers
        `{{ize}}`-vel: az elso a rosszabb, mert a mondat ERTELMES MARAD, csak
        mast mond. A szerkeszto igy a naplobol megtudja, MELYIK nevet gepelte el.
      */
      const ismeretlen = [
        ...(targy.ok ? [] : targy.unknown),
        ...(torzs.ok ? [] : torzs.unknown),
      ];
      this.logger.warn(
        `A levél sablonja ismeretlen változót tartalmaz: ${ismeretlen.join(", ")}.`,
      );
      return { kind: "failed", unknown: [...new Set(ismeretlen)] };
    }

    const level = ticketMailContent({
      recipientName: decision.name,
      jobNumber: context.jobNumber,
      title: context.title,
      description: context.description,
      event: torzs.text,
      freeText: input.freeText ?? null,
    });

    if (!this.sender) return { kind: "skipped", reason: "mode-off" };
    /*
      A TARGY ITT VALIK FEJLECCE, TEHAT ITT TISZTUL. A behelyettesitett ertek
      (a jegy CIME) ember altal beirt kulso adat, es a `CreateServiceJobDto`
      csak a HOSSZAT korlatozza, a sortorest nem.

      EGY TISZTITO VAN, NEM KETTO: az osszeallito szandekosan nem ad targyat,
      kulonben ugyanaz a szabaly ket helyen allna, es a valodi uton csak az
      egyik sulne el. A `buildMimeMessage` NEM tisztit, hanem DOB -- az a
      masodik reteg, es akkor is all, ha valaki egy masik hivot ir melle.
    */
    await this.sender.send({
      /*
        EGY CIMZETT, TOMBBE TEVE. A port `to` mezoje 2026-09-21 ota tomb, mert
        a lezart hibajegy TOBB cimzettnek megy. Ez az ut valtozatlanul EGY
        cimzettet ismer: a jegy nyitojat -- a `ticketMailDecision` egyetlen
        cimet ad vissza, es ezen a kor nem valtoztat.
      */
      to: [decision.to],
      subject: headerSafe(targy.text),
      text: level.text,
    });

    await this.repository.recordNotification({
      serviceJobId: input.serviceJobId,
      note: mailAuditNote(decision),
      actorUserId: input.actorUserId,
    });
    return { kind: "sent" };
  }
}

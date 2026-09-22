import { renderMailTemplate } from "@acropora/types";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { TICKET_MAIL_ENV } from "./gmail-mail.sender.js";
import { MAIL_SENDER, type MailSender } from "./mail.port.js";
import { headerSafe } from "./mail-header.js";
import { internalTicketLink } from "./ticket-link.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";
import { ticketMailContent } from "./ticket-mail.content.js";
import {
  isMailEnvironmentReason,
  mailAuditNote,
  mailRedirect,
  mailModeOf,
  serviceJobOpenedMailDecision,
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
    "",
    "Hibajegy: {{jegy_linkje}}",
  ].join("\n"),
} as const;

/**
 * A MASODIK LEVELEZESI ESEMENY: UGYFEL HIBAJEGYET ROGZIT.
 *
 * Az azonosito a `MAIL_TEMPLATE_EVENTS` listajabol jon (kozos csomag), nem egy
 * itt kitalalt sztringbol: ugyanazt a nevet a vegpont es a felulet valasztoja
 * is hasznalja, es harom masolat harom helyen csuszna szet.
 */
export const SERVICE_JOB_OPENED = "SERVICE_JOB_OPENED_BY_CUSTOMER";

/**
 * A KEZDO SZOVEG, AMIG SENKI NEM IRT SAJATOT -- ugyanaz a szerep, mint a
 * `DEFAULT_WORKSHEET_SIGNED_TEMPLATE`-nel.
 *
 * A `{{ugyfelkod}}` URES LEHET (nem minden ugyfelnek van rovidítése), ezert a
 * mondat ugy all, hogy uresen is ep marad: „A bejelentő: Nagy Anna (FANK)"
 * helyett kulon sorban all, sajat cimkevel. Egy zarojeles alak uresen
 * „Nagy Anna ()" lenne.
 */
export const DEFAULT_SERVICE_JOB_OPENED_TEMPLATE = {
  subject: "{{jegyszam}} {{jegy_targya}}",
  body: [
    "Kedves {{cimzett}}!",
    "",
    "Új hibajegyet rögzített egy ügyfél.",
    "",
    "Jegyszám: {{jegyszam}}",
    "Tárgy: {{jegy_targya}}",
    "Bejelentő: {{bejelento}}",
    "Ügyfélkód: {{ugyfelkod}}",
    "",
    "A bejelentés szövege:",
    "{{jegy_leirasa}}",
    "",
    "Hibajegy: {{jegy_linkje}}",
  ].join("\n"),
} as const;

export type TicketMailOutcome =
  | { readonly kind: "sent" }
  | {
      readonly kind: "skipped";
      /**
       * A `no-recipient` 2026-09-22-en kerult ide, es SAJAT ok, nem a meglevok
       * egyike: azt mondja, hogy a levelezes MEGY, csak a hibajegy-felelos
       * szerep egyetlen aktiv felhasznalonal sincs bejelolve. Ez a
       * beallitasokban javithato -- a ket kapu-ok nem.
       */
      readonly reason:
        MailSkipReason | "no-ticket" | "no-recipient" | "no-sender";
    }
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
      redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
      pathMode: mailModeOf(this.environment.TICKET_MAIL_WORKSHEET_SIGNED),
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
      if (!isMailEnvironmentReason(decision.reason))
        await this.repository.recordNotification({
          serviceJobId: input.serviceJobId,
          note: mailAuditNote(
            decision,
            mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
          ),
          actorUserId: input.actorUserId,
        });
      this.logger.log(
        `Értesítő levél kihagyva (${decision.reason}), hibajegy ${input.serviceJobId}.`,
      );
      return { kind: "skipped", reason: decision.reason };
    }

    const tarolt = await this.repository.template(WORKSHEET_SIGNED);
    const sablon = tarolt ?? DEFAULT_WORKSHEET_SIGNED_TEMPLATE;
    const link = internalTicketLink({
      webUrl: this.environment.WEB_URL,
      serviceJobId: input.serviceJobId,
    });
    if (!link)
      this.logger.warn(
        `A hibajegy linkje kimaradt a levélből: WEB_URL nincs beállítva (hibajegy ${input.serviceJobId}).`,
      );
    const ertekek = {
      cimzett: decision.name,
      jegyszam: context.jobNumber,
      jegy_targya: context.title,
      jegy_leirasa: context.description ?? "",
      jegy_linkje: link,
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

    if (!this.sender) return { kind: "skipped", reason: "no-sender" };
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
      note: mailAuditNote(
        decision,
        mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
      ),
      actorUserId: input.actorUserId,
    });
    return { kind: "sent" };
  }

  /**
   * UGYFEL NYITOTT HIBAJEGYET -- LEVEL A FELELOS-SZEREP BIRTOKOSAINAK.
   *
   * === A HAROM ELTERES A NYITO-ERTESITESHEZ KEPEST, MEGNEVEZVE ===
   *
   * 1. A CIMZETT A SZEREPBOL JON, nem a jegyrol. Tobb is lehet, es ha SENKINEL
   *    nincs bejelolve, az sajat kihagyasi ok (`no-recipient`) -- nem ugyanaz,
   *    mint a kikapcsolt levelezes, mert ezt a beallitasokban lehet javitani.
   * 2. A `{{cimzett}}` ITT NEM A BEJELENTO. Ezen az uton a ketto szetvalik, es
   *    epp ezert kellett a `{{bejelento}}` valtozo. Tobb cimzettnel a
   *    megszolitas nem szemelyre szol, ezert a szerep nevet teszem a helyere.
   * 3. EGY LEVEL MEGY, TOBB CIMZETTNEK, nem cimzettenkent egy. A kuldo `to`
   *    mezoje tomb, es a tartalom mindenkinek ugyanaz.
   */
  async deliverServiceJobOpened(input: {
    serviceJobId: string;
    actorUserId: string | null;
    /**
     * A CIMZETTEK KIVULROL JONNEK, ES EZ SZANDEKOS.
     *
     * Ugyanaz a halmaz kell a PUSH-hoz is, es a hivo mar lekerdezte. Ha ez a
     * metodus ujra lekerdezne, ugyanaz a szabaly KET helyen allna -- es a ket
     * lekerdezes kozott a halmaz meg is valtozhatna: a push egy embernek menne
     * ki, a level egy masiknak, ugyanarrol a jegyrol.
     */
    recipients: readonly { readonly email: string }[];
  }): Promise<TicketMailOutcome> {
    const context = await this.repository.context(input.serviceJobId);
    if (!context) return { kind: "skipped", reason: "no-ticket" };

    const decision = serviceJobOpenedMailDecision({
      mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
      redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
      pathMode: mailModeOf(this.environment.TICKET_MAIL_JOB_OPENED),
      recipients: input.recipients,
    });

    if (decision.kind === "skip") {
      /*
        A KIKAPCSOLT LEVELEZESROL NEM IRUNK NAPLOSORT, a hianyzo cimzettrol
        IGEN. Ugyanaz a szabaly, mint a masik uton: a zart kapu a KORNYEZET
        allapota, es minden teszt-kornyezetben odakerulne; a „senkinel nincs
        bejelolve" viszont a JEGYROL szolo teny, es javithato.
      */
      if (!isMailEnvironmentReason(decision.reason))
        await this.repository.recordNotification({
          serviceJobId: input.serviceJobId,
          note: "Értesítő levél kimaradt: a hibajegy-felelős szerep egyetlen aktív felhasználónál sincs bejelölve.",
          actorUserId: input.actorUserId,
        });
      this.logger.log(
        `Ügyfél-bejelentés levele kihagyva (${decision.reason}), hibajegy ${input.serviceJobId}.`,
      );
      return { kind: "skipped", reason: decision.reason };
    }

    const tarolt = await this.repository.template(SERVICE_JOB_OPENED);
    const sablon = tarolt ?? DEFAULT_SERVICE_JOB_OPENED_TEMPLATE;
    const link = internalTicketLink({
      webUrl: this.environment.WEB_URL,
      serviceJobId: input.serviceJobId,
    });
    if (!link)
      this.logger.warn(
        `A hibajegy linkje kimaradt a levélből: WEB_URL nincs beállítva (hibajegy ${input.serviceJobId}).`,
      );
    const ertekek = {
      cimzett: "Kolléga",
      jegyszam: context.jobNumber,
      jegy_targya: context.title,
      jegy_leirasa: context.description ?? "",
      bejelento: context.opener?.displayName ?? "",
      ugyfelkod: context.partnerCode ?? "",
      jegy_linkje: link,
    };

    const targy = renderMailTemplate(sablon.subject, ertekek);
    const torzs = renderMailTemplate(sablon.body, ertekek);
    if (!targy.ok || !torzs.ok) {
      const ismeretlen = [
        ...(targy.ok ? [] : targy.unknown),
        ...(torzs.ok ? [] : torzs.unknown),
      ];
      this.logger.warn(
        `A levél sablonja ismeretlen változót tartalmaz: ${ismeretlen.join(", ")}.`,
      );
      return { kind: "failed", unknown: [...new Set(ismeretlen)] };
    }

    if (!this.sender) return { kind: "skipped", reason: "no-sender" };
    await this.sender.send({
      to: [...decision.to],
      subject: headerSafe(targy.text),
      text: torzs.text,
    });

    await this.repository.recordNotification({
      serviceJobId: input.serviceJobId,
      note: `Értesítő levél kiment ${decision.to.length} címzettnek: ügyfél hibajegyet rögzített.`,
      actorUserId: input.actorUserId,
    });
    return { kind: "sent" };
  }
}

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  ServiceJobHandoverMailPreview,
  ServiceJobHandoverMailSendSkipReason,
} from "@acropora/types";

import { headerSafe } from "./mail-header.js";
import { TICKET_MAIL_ENV, TicketMailError } from "./gmail-mail.sender.js";
import { MAIL_SENDER, type MailSender } from "./mail.port.js";
import {
  isMailEnvironmentReason,
  mailModeOf,
  mailRedirect,
} from "./ticket-mail.rules.js";
import {
  handoverMailBody,
  handoverMailDefaultSubject,
} from "./handover-mail.content.js";
import {
  handoverMailAuditNote,
  handoverMailDecision,
  type HandoverMailDecision,
} from "./handover-mail-recipients.js";
import {
  handoverAttachmentVerdict,
  handoverMailMaxAttachmentBytes,
} from "./handover-mail-size.js";
import { HandoverMailRepository } from "./handover-mail.repository.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";

export type HandoverMailResult =
  | { readonly kind: "sent"; readonly recipients: number }
  | {
      readonly kind: "skipped";
      readonly reason: ServiceJobHandoverMailSendSkipReason;
    }
  | { readonly kind: "refused"; readonly message: string };

/**
 * A LEZART HIBAJEGY KIKULDESE A HELYSZINT BIRTOKLOKNAK.
 *
 * Balazs specje, 2026-09-18 11:29 UTC: "egy elkuld gomb, ami elkuldi a
 * helyszint birtokloknak emailben. a felado neve Acropora Ticketing, a cime
 * ticket@acropora.hu."
 *
 * === A CSOMAGOT KAPJA, NEM KERI LE -- ES EZ NEM IZLES ===
 *
 * A `ServiceJobPackageService` a `ServiceJobsModule`-ban all, AMI MAR
 * IMPORTALJA a `NotificationsModule`-t. Ha ez a szolgaltatas injektalna,
 * KORKOROS modul-fugges keletkezne (merve 2026-09-22: `service-jobs.module.ts`
 * `imports: [NotificationsModule]`).
 *
 * Ezert a csomag BEMENET: a hivo (a vegpont, ami mind a kettot latja) kéri le
 * es adja at. A `forwardRef` megoldana, de az egy ciklust REJT el, nem szuntet
 * meg -- es a modul-graf akkor is kor maradna.
 *
 * === A KET NAPLO-HELY KET KULONBOZO ALLITAS ===
 *
 *   a jegy naploja        TORTENT kuldes, es HANY cimzettnek. Cim NINCS benne.
 *   TicketMailDelivery    KINEK: nev es cim. A portal soha nem olvassa.
 *
 * Aki a kettot osszevonja, azzal a cimek kiszivarognak. A `handoverMailAuditNote`
 * fejlece mondja meg, miert all ez fuggetlenul attol, hogy MA mit lat a partner.
 */
@Injectable()
export class HandoverMailService {
  private readonly logger = new Logger(HandoverMailService.name);

  constructor(
    private readonly repository: HandoverMailRepository,
    private readonly ticketMail: TicketMailRepository,
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    /*
      A KORNYEZET TOKENEN AT JON, ugyanazon (`TICKET_MAIL_ENV`), amit a szomszed
      `TicketMailService` es a `GmailMailSender` hasznal.

      NEM UJ TOKENT VETTEM FEL: a harom hely UGYANARRA a kornyezetre nez, es egy
      masodik token azt jelentene, hogy egy teszt az egyiket felulirja, a masik
      kettot nem -- a ket szolgaltatas pedig ugyanarra a kapcsolora (
      `TICKET_MAIL_MODE`) MAST latna.

      ES AZ ALAPERTELMEZETT ERTEK ONMAGABAN NEM ELEG: az elso valtozatom
      `private readonly environment: NodeJS.ProcessEnv = process.env` volt,
      dekorator nelkul. A typecheck zold maradt, a Nest viszont INJEKTALANDONAK
      latta, es az alkalmazas INDULASKOR hasalt volna el.
    */
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * A JEGY ES A CIMZETT-DONTES -- EGY HELYEN, MERT KET HIVOJA VAN.
   *
   * A kuldes es az elonezet UGYANAZT a dontest kell hogy lassa. Ha a ket ut
   * kulon epitene fel (ugyanazzal a harom lepessel), az a "egy szabaly ket
   * helyen" alak lenne: a ket hely elcsuszhat, es a kezelo olyan cimzett-listat
   * latna, ami nem az, ami vegul kimegy.
   *
   * `null`, ha a jegy nem letezik. A KET HIVO MASKENT kezeli, es ez szandekos:
   * a kuldes `skipped` okot ad vissza (a hivas mar elindult, es nyoma kell
   * legyen), az elonezet 404-et dob (a felulet meg nem kezdett semmit).
   */
  private async resolve(serviceJobId: string) {
    const job = await this.repository.jobForMail(serviceJobId);
    if (!job) return null;

    const customerId = job.department?.customerId ?? null;
    const recipients = customerId
      ? await this.repository.recipients(customerId)
      : [];

    return {
      job,
      decision: handoverMailDecision({
        mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
        redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
        pathMode: mailModeOf(this.environment.TICKET_MAIL_HANDOVER),
        departmentId: job.departmentId,
        customerId,
        recipients,
      }),
    };
  }

  /**
   * KI KAPNA MEG A LEVELET -- ES SEMMI NEM TORTENIK.
   *
   * === EZ OLVASAS, ES SEMMI NYOMOT NEM HAGY ===
   *
   * Nincs naplo-sor es nincs `TicketMailDelivery` bejegyzes. A kuldesnek MIND
   * A KETTO jar, mert ott TORTENT valami; itt a kezelo csak megnezi, kinek
   * irna. Egy elonezet, ami nyomot hagy, a "kiment-e?" kerdest teszi
   * megvalaszolhatatlanna.
   *
   * === ES A CSOMAGOT SEM ALLITJA ELO ===
   *
   * A kuldes utjan a csomag a VEGPONTON keszul (`download()`), es az PDF-eket
   * general. Az elonezet a dialogus MEGNYITASAKOR fut le, tehat ott ez percek
   * alatt ertelmetlen terhelest jelentene -- es a csomag semmit nem mond arrol,
   * kinek megy a level.
   *
   * AMIT EZ NEM ELLENORIZ, ES KI VAN MONDVA: hogy a csomag eloallithato-e (a
   * jegy elkeszult-e, van-e lezaro esemenye). Azt a kuldes vegpontja meri, es
   * a sorrend ott szandekos. Az elonezet `send` valasza tehat NEM igeri, hogy
   * a kuldes sikerulni fog.
   */
  async preview(
    serviceJobId: string,
  ): Promise<ServiceJobHandoverMailPreview | null> {
    const feloldas = await this.resolve(serviceJobId);
    if (feloldas === null) return null;
    const { job, decision } = feloldas;

    if (decision.kind === "skip")
      return { kind: "skip", reason: decision.reason };

    return {
      kind: "send",
      recipients: decision.to.map((cimzett) => ({
        name: cimzett.name,
        email: cimzett.email,
      })),
      subject: handoverMailDefaultSubject(job.jobNumber),
    };
  }

  async send(input: {
    serviceJobId: string;
    subject?: string;
    message: string;
    actorUserId: string | null;
    package: { fileName: string; bytes: Buffer };
  }): Promise<HandoverMailResult> {
    const feloldas = await this.resolve(input.serviceJobId);
    if (feloldas === null) return { kind: "skipped", reason: "no-job" };
    const { job, decision } = feloldas;

    if (decision.kind === "skip") return this.skip(job, decision, input);

    /*
      A MERET-KAPU A KULDES ELOTT ALL, es a csomag BAJTJAIN mer -- a base64
      utani hosszra. A `handoverAttachmentVerdict` fejlece mondja meg, miert a
      kodolt hossz szamit.
    */
    const verdict = handoverAttachmentVerdict({
      bytes: input.package.bytes.length,
      limit: handoverMailMaxAttachmentBytes(this.environment),
    });

    /*
      HATAR FELETT MEGALLUNK, ES A KEZELONEK SZOLUNK.

      NYITOTT DONTES (acrobot kerdese, 2026-09-22 00:21, es a valaszom 00:57):
      a link-visszaeses MA NEM JARHATO UT -- a letoltes hitelesitett vegpont,
      es a partner-portal nem hivja. Egy "toltsd le" mondat a vevonek igeret
      lenne ut nelkul.

      EZERT A KEZELO KAPJA A HIBAT, nem a vevo a fel mondatot. Az indok meres:
      a mai legnagyobb csomag 58 553 bajt, a hatar 4 MB -- ez az ag ma nem fut
      le. Ha acrobot a masik utat valasztja, EZ AZ EGY AG valtozik.
    */
    if (verdict.kind === "link") {
      await this.repository.recordDelivery({
        serviceJobId: job.id,
        jobNumber: job.jobNumber,
        initiatedByUserId: input.actorUserId,
        subject: input.subject ?? handoverMailDefaultSubject(job.jobNumber),
        recipients: decision.to,
        attachmentBytes: verdict.bytes,
        outcome: "REFUSED_TOO_LARGE",
      });
      return { kind: "refused", message: verdict.sentence };
    }

    const subject = headerSafe(
      input.subject?.trim() || handoverMailDefaultSubject(job.jobNumber),
    );
    const text = handoverMailBody({ message: input.message });

    if (!this.sender) return this.skip(job, decision, input, "no-sender");

    try {
      await this.sender.send({
        to: decision.to.map((cimzett) => cimzett.email),
        subject,
        text,
        attachments: [
          {
            filename: input.package.fileName,
            contentType: "application/zip",
            bytes: input.package.bytes,
          },
        ],
      });
    } catch (cause) {
      /*
        A HIBA IS NYOM. Egy kimeno kuldes, ami elhasalt, ugyanugy tortent
        esemeny -- es enelkul csak annyit tudnank, hogy a vevo nem kapott
        levelet, azt nem, hogy megprobaltuk.
      */

      /*
        ES A NYOM NEM MONDHAT TOBBET, MINT AMIT TUDUNK (79649b43).

        A `FAILED` szo azt allitja, hogy a level NEM ment ki. Ez a kuldo OT
        dobasi pontjabol NEGYRE igaz (a keres el sem indult, vagy valaszt
        kaptunk es az nem-ok volt) -- az OTODIKRE viszont NEM: ha a keres
        elindult es valasz nem jott, a Gmail MAR atvehette a levelet.

        A ket eset TEENDOJE ELLENTETES, es epp ezert nem szabad egy szoval
        jelolni oket:

          FAILED          a level nem ment ki  -> UJRA lehet kuldeni
          INDETERMINATE   nem tudjuk           -> ELOBB a cimzettnel kell
                                                  megnezni, es CSAK azutan

        Egy `FAILED`, ami valojaban bizonytalan, epp az ujrakuldes fele tereli
        a kezelot -- es idempotencia hijan (ea3f787c, Balazs dontese) abbol ket
        egyforma level lesz a vevonel.

        AZ `outcome` OSZLOP SZOVEG, NEM ENUM, es a sema kommentje szo szerint
        ezert hagyta annak: "egy új kimenetel felvétele ne igényeljen migrációt
        egy append-only naplóban". Tehat ez a harmadik ertek migracio NELKUL
        fer be. A szo maga sem uj a hazban: az `UnasVerificationStatus` es a
        `SzamlazzVerificationStatus` is visel `INDETERMINATE` erteket.
      */
      const bizonytalan =
        cause instanceof TicketMailError &&
        cause.code === "TICKET_MAIL_SEND_INDETERMINATE";

      await this.repository.recordDelivery({
        serviceJobId: job.id,
        jobNumber: job.jobNumber,
        initiatedByUserId: input.actorUserId,
        subject,
        recipients: decision.to,
        attachmentBytes: input.package.bytes.length,
        outcome: bizonytalan ? "INDETERMINATE" : "FAILED",
        error: cause instanceof Error ? cause.message : "ismeretlen hiba",
      });

      /*
        A KEZELO KET KULONBOZO MONDATOT KAP, ES A BIZONYTALAN AGON NEM
        HIVJUK UJRAKULDESRE.

        A biztos bukas tovabbdobodik ugy, ahogy eddig. A bizonytalan ag 503-at
        ad, mert az az egyetlen allitas, ami igaz: a kimenetelt nem tudjuk.
      */
      if (bizonytalan)
        throw new ServiceUnavailableException(
          "A levél kiküldésének kimenetele bizonytalan: nem kaptunk választ, " +
            "ezért nem tudjuk, megérkezett-e. NE küldd újra azonnal — előbb " +
            "nézd meg a címzettnél, hogy megkapta-e. Az újraküldés így két " +
            "egyforma levelet adhat neki.",
        );
      throw cause;
    }

    await this.repository.recordDelivery({
      serviceJobId: job.id,
      jobNumber: job.jobNumber,
      initiatedByUserId: input.actorUserId,
      subject,
      recipients: decision.to,
      attachmentBytes: input.package.bytes.length,
      outcome: "SENT",
    });
    await this.ticketMail.recordNotification({
      serviceJobId: job.id,
      note: handoverMailAuditNote(
        decision,
        mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
      ),
      actorUserId: input.actorUserId,
    });
    return { kind: "sent", recipients: decision.to.length };
  }

  /**
   * A KIHAGYAS NEM NEMA -- DE A ZART KAPU NEM A JEGYROL SZOL.
   *
   * Ugyanaz a bontas, mint a szomszed `TicketMailService`-ben: naplo-sort CSAK
   * akkor irunk a jegyre, ha a jegyen tortent volna valami. A HAROM
   * KORNYEZETI OK (`mail-off`, `path-off`, `no-sender`) a KORNYEZET allapota -- egy "nem ment ki level"
   * sor minden teszt-kornyezetben odakerulne, es a jegy naplojat toltene fel
   * zajjal.
   *
   * 2026-09-22 ota ez `isMailEnvironmentReason`-nel dol el, nem egyetlen szo
   * osszehasonlitasaval: igy egy ujabb kornyezeti ok bevezetese nem tudja
   * csendben ide engedni a naplo-irast.
   *
   * ES EZ MEG AZNAP HASZNALT IS: a `no-sender` ugyanabban a korben kerult be,
   * es a halmazhoz eleg volt hozzaadni -- a naplo-dontest nem kellett
   * hozzanyulni, mert nem szoban all, hanem halmazban.
   */
  private async skip(
    job: { id: string },
    decision: HandoverMailDecision,
    input: { actorUserId: string | null },
    /*
      A FELULIRAS EGYETLEN ERTEKET VEHET FEL, ES EZ SZANDEKOS.

      Eddig `string` volt, es a lazasag INNEN terjedt tovabb: a visszateresi
      tipus, a kozos tipus es a felulet is `string`-et latott. A `no-sender` az
      EGYETLEN ok, ami nem a cimzett-dontesbol jon, hanem a kornyezetbol -- egy
      masodik felulirasi ok tehat DONTEST igenyel, nem egy uj sztringet.
    */
    felulir?: "no-sender",
  ): Promise<HandoverMailResult> {
    const reason =
      felulir ?? (decision.kind === "skip" ? decision.reason : "mail-off");
    if (!isMailEnvironmentReason(reason))
      await this.ticketMail.recordNotification({
        serviceJobId: job.id,
        note: handoverMailAuditNote(
          decision,
          mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
        ),
        actorUserId: input.actorUserId,
      });
    this.logger.log(`A lezárt hibajegy nem ment ki e-mailben (${reason}).`);
    return { kind: "skipped", reason };
  }
}

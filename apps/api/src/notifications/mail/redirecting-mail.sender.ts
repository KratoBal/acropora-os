import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { GmailMailSender, TICKET_MAIL_ENV } from "./gmail-mail.sender.js";
import type { MailSender, OutgoingMail } from "./mail.port.js";
import { mailRedirect } from "./ticket-mail.rules.js";

/**
 * MINDEN KIMENO LEVELET EGY PROBACIMRE TERIT, HA A KAPCSOLO ALL.
 *
 * === MIERT A KULDO BURKA, ES MIERT NEM A HAROM SZOLGALTATASBAN ===
 *
 * Ez acrobot sajat kalibracios kerdesere valasz (2026-09-22): "milyen HIBAS
 * megvalositas menne at az allitasodon? Ha az atiranyitas csak az EGYIK uton
 * hat, a masik kettonel a level kimegy -- es egy allitas, ami egy utat mer,
 * erre zold marad."
 *
 * Harom kuldesi ut van (munkalap-alairas, ugyfel-bejelentes, atadasi level), es
 * MINDHAROM ugyanazon a DI-jelzon at kapja a kuldot (`MAIL_SENDER`), amit a
 * modul EGY helyen kot. Ha a teritest ide tesszuk, egyik ut sem tudja
 * megkerulni -- nem azert, mert mindharman betartjak, hanem mert nem a hivoban
 * dol el.
 *
 * Ugyanaz az alak, mint a kozos konstansnal: nem ket helyen allo azonos
 * szabaly, hanem EGY hely, amin mindenki atmegy.
 *
 * === A VALODI CIMZETT NEM VESZIK EL, HANEM LATHATOVA VALIK ===
 *
 * acrobot elso kikotese: "a valodi cimzettet NE dobd el, hanem vidd at lathato
 * modon a levelbe -- kulonben a probalevelbol nem derul ki, hogy jo helyre ment
 * VOLNA". Ezert kerul a torzs ELEJERE, nem a vegere: egy hosszu levelnel a
 * vegen allo blokkot senki nem gorgeti le.
 *
 * === AMIT SZANDEKOSAN NEM CSINAL: NEM ELLENORZI A CIMET ===
 *
 * A fejlec-injekciot a `buildMimeMessage` fogja meg, es az ezen az uton is
 * lefut, mert a burok a VALODI kuldot hivja. Egy masodik ellenorzes itt ugyanazt
 * a szabalyt tenne ket helyre -- es a lapunk szerint akkor a valodi uton csak az
 * egyik sul el.
 */
@Injectable()
export class RedirectingMailSender implements MailSender {
  private readonly logger = new Logger(RedirectingMailSender.name);

  constructor(
    /*
      A JELZO AZ OSZTALY, A TIPUS AZ INTERFESZ -- ES A KETTO SZETVALASZTASA
      SZANDEKOS. A Nest-nek osztaly kell, hogy fel tudja oldani; a TESZTNEK
      viszont nem szabad a Gmailt felepitenie ahhoz, hogy a teritest merje.
      Ha a tipus is az osztaly lenne, minden allitas a valodi kuldot igenyelne.
    */
    @Inject(GmailMailSender)
    private readonly inner: MailSender,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const redirect = mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO);
    if (redirect.kind === "off") return this.inner.send(mail);

    this.logger.warn(
      `A level ATIRANYITVA megy ki: ${mail.to.length} valodi cimzett helyett egy probacimre.`,
    );
    return this.inner.send({
      ...mail,
      to: [redirect.to],
      subject: `[ÁTIRÁNYÍTVA] ${mail.subject}`,
      text: `${redirectHeader(mail.to)}\n\n${mail.text}`,
    });
  }
}

/**
 * A BLOKK, AMI MEGMONDJA, KINEK MENT VOLNA. Kulon fuggveny, mert igy ALLITHATO
 * rola valami anelkul, hogy a kuldot fel kellene epiteni.
 */
export function redirectHeader(to: readonly string[]): string {
  const sorok = to.map((cim) => `  - ${cim}`).join("\n");
  return [
    "=== ÁTIRÁNYÍTOTT PRÓBALEVÉL ===",
    "",
    `Ez a levél NEM a valódi címzettnek ment. Címzettek (${to.length}), akiknek ment volna:`,
    sorok,
    "",
    "=== AZ EREDETI LEVÉL SZÖVEGE KÖVETKEZIK ===",
  ].join("\n");
}

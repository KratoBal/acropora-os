import { Inject, Injectable, Logger } from "@nestjs/common";

import { serviceJobOpenedPushTitle } from "./service-job-opened-title.js";
import { APNS_SENDING, type ApnsSending } from "./apns.sender.js";
import {
  DeviceTokenRepository,
  type DevicePlatformName,
  type DeviceTokenRecipient,
} from "./device-token.repository.js";
import { FCM_SENDING, type FcmSending } from "./fcm.sender.js";
import {
  NotificationLogRepository,
  type NotificationAttempt,
} from "./notification-log.repository.js";

/** Hany ertesites ment ki, hany eszkoz-token evult el, es hany bukott el. */
/**
 * AMIT EGY KULDO UT VALASZOL, PLATFORMTOL FUGGETLENUL.
 *
 * Az `ApnsResult` es az `FcmResult` ALAKJA MA AZONOS, es ez nem veletlen: a
 * kozos torzsnek harom dologra van szuksege (sikerult-e, el kell-e dobni a
 * tokent, es mi az oka), es a ket protokoll kulonbsegei ez alatt maradnak.
 *
 * KULON NEVET KAPOTT, hogy a torzs NE az egyik protokoll tipusan alljon: ha az
 * Apple valasza egyszer bovul, az nem szabad, hogy a Google-ag forditasat
 * torje el -- es forditva.
 */
export type PushOutcome =
  { ok: true } | { ok: false; retired: boolean; reason: string };

export interface AssignmentSummary {
  sent: number;
  retired: number;
  failed: number;
}

export interface WorksheetAssignmentNotice {
  worksheetId: string;
  /** What the sheet is about, as the technician will read it on the lock screen. */
  subject: string;
  /** The colleagues now responsible for the sheet. */
  userIds: readonly string[];
}

/**
 * A HIBAJEGY DELEGALASANAK ERTESITESE.
 *
 * Balazs kerese (2026-09-14 18:10): a jegyre delegalt szervizesek ertesitest
 * kapjanak. Ugyanaz a ut, mint a munkalapnal -- nincs masodik kuldo, nincs
 * masodik sor -- csak masik CELPONT es masik cim.
 */
/**
 * UGYFEL NYITOTT HIBAJEGYET -- A FELELOS-SZEREP BIRTOKOSAINAK.
 *
 * KULON TIPUS A HOZZARENDELES MELLETT, es nem ugyanaz ket nevvel: a
 * hozzarendelesnel valaki A CIMZETTHEZ RENDELTE a jegyet, itt viszont senki --
 * a cimzett a SZEREPE miatt kap ertesitest. A ket mondat ezert kulonbozik, es
 * a regi ("Új hibajegy került hozzád") itt HAMISAT allitana.
 */
export interface ServiceJobOpenedNotice {
  serviceJobId: string;
  /** A jegy targya -- ez all a zarolt kepernyon, a cim alatt. */
  subject: string;
  /**
   * Az ugyfel rovidítése (`FANK`), ha van. NULLAZHATO, es ez nem elovigyazat:
   * a `Customer.worksheetPartnerCode` a semaban is az.
   */
  partnerCode: string | null;
  /** Akiknel a hibajegy-felelos szerep be van jelolve. */
  userIds: readonly string[];
}

export interface ServiceJobAssignmentNotice {
  serviceJobId: string;
  /** What the ticket is about, as the technician will read it on the lock screen. */
  subject: string;
  /** The colleagues now delegated to the ticket. */
  userIds: readonly string[];
}

/**
 * Sends the notifications the worksheet assignment triggers.
 *
 * Two rules hold this together, and both come from the system as it is today.
 *
 * There is no queue in this API - no BullMQ, no scheduler, nothing that picks
 * work up later. So the send happens inline, AFTER the assignment is stored,
 * and a failure never reaches the caller: an office colleague pressing "save"
 * must not be left waiting on Apple, and must never see the assignment fail
 * because a phone could not be reached. What is lost in that trade is a retry,
 * and that is the honest cost of having no queue.
 *
 * Missing configuration is not a failure either. A development machine has no
 * signing key; the sender says so once and stays quiet.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly deviceTokens: DeviceTokenRepository,
    @Inject(APNS_SENDING) private readonly sender: ApnsSending,
    private readonly log: NotificationLogRepository,
    @Inject(FCM_SENDING) private readonly fcm: FcmSending,
  ) {}

  /**
   * Fire and forget, on purpose: the caller has already stored the assignment
   * and its answer must not depend on this.
   */
  notifyWorksheetAssignment(notice: WorksheetAssignmentNotice): void {
    void this.deliverWorksheetAssignment(notice).catch((cause: unknown) => {
      this.logger.warn(
        `A munkalap-értesítés küldése nem sikerült (${notice.worksheetId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    });
  }

  /** Ugyanaz, hibajegyre: a hívó válasza nem függhet a telefontól. */
  notifyServiceJobAssignment(notice: ServiceJobAssignmentNotice): void {
    void this.deliverServiceJobAssignment(notice).catch((cause: unknown) => {
      this.logger.warn(
        `A hibajegy-értesítés küldése nem sikerült (${notice.serviceJobId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    });
  }

  /**
   * The same work as `notifyWorksheetAssignment`, awaited, so the tests can
   * observe the outcome.
   *
   * A method of its own rather than a block inside `setAssignees`: the send is
   * a separate step after the write - it must not be able to fail the
   * assignment - and it is worth testing without a worksheet service around
   * it. It is not a general-purpose sender: the assignment is the only moment
   * that sends, and inventing a wider one would be building for an ask that
   * was explicitly not made.
   */
  async deliverWorksheetAssignment(
    notice: WorksheetAssignmentNotice,
  ): Promise<AssignmentSummary> {
    return this.deliver({
      userIds: notice.userIds,
      title: "Új munkalap került hozzád",
      body: notice.subject,
      /**
       * A CELPONT TIPUSSAL EGYUTT MEGY, ES EZ MA EGY ELAGAZAS KET AGGAL.
       *
       * Balazs kerese (2026-09-03 20:20): hibajegy-keperno akkor meg nem volt a
       * telefonon, tehat oda nem lehetett vinni senkit -- de az ALAK legyen
       * olyan, hogy a masodik tipus ne kivanjon atirast. Ez a masodik tipus,
       * es az alak tartotta: a kuldes kozos, csak a `data` ter el.
       *
       * A REGI `worksheetId` MEZO IS MEGY, es ez nem masolas: az ertesitesi
       * kozpontban MA is allhat bontatlan ertesites, ami csak azt hordozza.
       * Egy koppintas rajta a frissites UTAN tortenne, es tipus nelkul sehova
       * nem vinne. A telefon ezert visszaesik ra -- de CSAK ha tipus nincs,
       * ismeretlen tipusnal nem (lasd `push-target.ts`).
       *
       * MIKOR HAGYHATO EL: ha egyszer biztosak vagyunk benne, hogy egyetlen
       * keszuleken sem all bontatlan, tipus nelkuli ertesites. Addig a ket mezo
       * egyutt megy, es a masodik nem kerul semmibe.
       */
      data: {
        targetType: "worksheet",
        targetId: notice.worksheetId,
        worksheetId: notice.worksheetId,
      },
      record: (attempts) =>
        this.log.recordWorksheetAssignment({
          worksheetId: notice.worksheetId,
          attempts,
        }),
      failureLine: (summary) =>
        `Munkalap-értesítés: ${summary.sent} kiment, ${summary.failed} nem sikerült, ${summary.retired} eszköz-token elévült (${notice.worksheetId}).`,
    });
  }

  /**
   * UGYANEZ, HIBAJEGYRE.
   *
   * === A `worksheetId` VISSZAESES ITT NEM MEGY, ES EZ A LENYEG ===
   *
   * A munkalap-ertesites a regi mezot is viszi, hogy egy tipus nelkuli, regi
   * ertesitesbol meg lehessen nyitni a lapot. Egy JEGY ertesitesebe ugyanaz a
   * mezo HAZUGSAG lenne: a telefon munkalap-azonositokent olvasna, es egy
   * letezo lap helyett egy jegy azonositojaval nyitna meg egy kepernyot -- vagy
   * ami rosszabb, egy VELETLENUL letezo masik lapot.
   *
   * === AMIT EZ MA NEM TUD, ES KIMONDOM ===
   *
   * A telefon `PUSH_TARGET_TYPES` listaja ma CSAK a `worksheet` erteket ismeri
   * (`apps/mobile/src/lib/notifications/push-target.ts`, merve 2026-09-14).
   * Egy `serviceJob` tipusu ertesites tehat MEGJELENIK a zarolt kepernyon, de a
   * koppintas SEHOVA nem visz -- a telefon szandekosan inkabb nem navigal, mint
   * rosszul.
   *
   * EZ NEM HIANYZO RESZ EBBOL A MUNKABOL, hanem a mobil oldal kulon tetele: a
   * tipus felvetele ott csak akkor helyes, amikor a hibajegy-keperno LETEZIK.
   * Addig felvenni annyit tenne, hogy a koppintas egy ures utvonalra visz, es
   * az rosszabb a mai allapotnal.
   */
  async deliverServiceJobAssignment(
    notice: ServiceJobAssignmentNotice,
  ): Promise<AssignmentSummary> {
    return this.deliver({
      userIds: notice.userIds,
      title: "Új hibajegy került hozzád",
      body: notice.subject,
      data: {
        targetType: "serviceJob",
        targetId: notice.serviceJobId,
      },
      record: (attempts) =>
        this.log.recordServiceJobAssignment({
          serviceJobId: notice.serviceJobId,
          attempts,
        }),
      failureLine: (summary) =>
        `Hibajegy-értesítés: ${summary.sent} kiment, ${summary.failed} nem sikerült, ${summary.retired} eszköz-token elévült (${notice.serviceJobId}).`,
    });
  }

  /**
   * UGYFEL NYITOTT JEGYET -- a felelos-szerep birtokosainak.
   *
   * UGYANAZ A TORZS, MAS CIM. A `deliver` harom szabalya (sor nelkuli kuldes,
   * elavult token nyugdijazasa, naplozas bukas eseten is) itt valtozatlan.
   *
   * A CIM KULON FUGGVENYBOL JON (`serviceJobOpenedPushTitle`), mert KET AGA
   * van, es a tiltott harmadik alak ("Új hibajegyet nyitott a ") csak ott
   * zarhato ki egyetlen helyen.
   *
   * A NAPLO UGYANAZ A BEJEGYZES, mint a hozzarendelesnel: a `record` a
   * KULDESROL szol (kinek ment, kinek nem), nem arrol, MIERT kuldtunk.
   */
  async deliverServiceJobOpened(
    notice: ServiceJobOpenedNotice,
  ): Promise<AssignmentSummary> {
    return this.deliver({
      userIds: notice.userIds,
      title: serviceJobOpenedPushTitle(notice.partnerCode),
      body: notice.subject,
      data: {
        targetType: "serviceJob",
        targetId: notice.serviceJobId,
      },
      record: (attempts) =>
        this.log.recordServiceJobAssignment({
          serviceJobId: notice.serviceJobId,
          attempts,
        }),
      failureLine: (summary) =>
        `Ügyfél-bejelentés értesítése: ${summary.sent} kiment, ${summary.failed} nem sikerült, ${summary.retired} eszköz-token elévült (${notice.serviceJobId}).`,
    });
  }

  /** A nem-varo alak, ugyanugy, mint a hozzarendelesnel. */
  notifyServiceJobOpened(notice: ServiceJobOpenedNotice): void {
    void this.deliverServiceJobOpened(notice).catch((cause: unknown) => {
      this.logger.warn(
        `Az ügyfél-bejelentés értesítése nem sikerült (${notice.serviceJobId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    });
  }

  /**
   * A KOZOS TORZS: kinek kuldunk, mi tortenik a lejart eszkozzel, mi kerul a
   * naploba.
   *
   * KIEMELVE, NEM MASOLVA. A ket kiosztas ugyanazt a harom szabalyt hordozza (a
   * sor nelkuli kuldes, az elavult token nyugdijazasa, es hogy a naplo akkor is
   * ir, ha nem sikerult), es ezek NEM a munkalaprol vagy a jegyrol szolnak,
   * hanem a kuldesrol. Ket masolatban a harom szabaly harom helyen csuszna szet
   * -- es a kulonbseg nem hibazna, csak maskepp viselkedne.
   *
   * AMI ELTER, AZ A PARAMETEREKBEN ALL, es pontosan negy dolog: a cim, a
   * torzs, a `data` celpont, es hogy melyik naplo-bejegyzes keszul.
   */
  private async deliver(input: {
    userIds: readonly string[];
    title: string;
    body: string;
    data: Record<string, string>;
    record: (attempts: NotificationAttempt[]) => Promise<void>;
    failureLine: (summary: AssignmentSummary) => string;
  }): Promise<AssignmentSummary> {
    const empty: AssignmentSummary = { sent: 0, retired: 0, failed: 0 };
    if (input.userIds.length === 0) return empty;

    /**
     * A KET KULDO UT, MEGNEVEZVE -- ES A PLATFORM ITT ALL, NEM A TAROLOBAN.
     *
     * A `recipients` kerdese nem az, hogy „kit lehet elerni", hanem hogy „kit
     * lehet elerni EZEN AZ UTON". Egy androidos token az Apple valaszaban azt
     * jelentene, hogy egy Google-tokent kuldunk az Apple-nek: az elutasitana, a
     * lenti `retired` ag pedig TOROLNE a sort -- a telefon csendben lekerulne az
     * ertesitesekrol, anelkul hogy valaha kaphatott volna egyet. Ezert kap minden
     * ut sajat platformot ES sajat kuldot.
     *
     * A NEM BEALLITOTT UT KIMARAD, nem hibazik: egy fejlesztoi gepen egyik kulcs
     * sincs meg, es ket eles telepites kozul az egyik eloszor csak az egyiket
     * kapja meg. Ha EGYIK ut sincs beallitva, a korabbi viselkedes all: nem
     * tortenik semmi.
     */
    const routes: {
      platform: DevicePlatformName;
      send: (recipient: DeviceTokenRecipient) => Promise<PushOutcome>;
    }[] = [];
    if (this.sender.configured())
      routes.push({
        platform: "IOS",
        send: (recipient) =>
          this.sender.send({
            deviceToken: recipient.token,
            // AZ APNS-TOPIC AZ APPLE-UT SAJATJA: a Google oldalan a cimzettet
            // maga a token azonositja, csomagnev nelkul.
            bundleId: recipient.bundleId,
            title: input.title,
            body: input.body,
            data: input.data,
          }),
      });
    if (this.fcm.configured())
      routes.push({
        platform: "ANDROID",
        send: (recipient) =>
          this.fcm.send({
            deviceToken: recipient.token,
            title: input.title,
            body: input.body,
            data: input.data,
          }),
      });
    if (routes.length === 0) return empty;

    /**
     * A KET UT EREDMENYE EGY LISTABA FUT OSSZE, ES EZ SZANDEKOS: a naplo EGY
     * bejegyzest kap ertesitesenkent, nem utankent egyet. Aki holnap megkerdezi,
     * hogy szoltunk-e a kollegának, egy sort akar olvasni, nem kettot, amik
     * kulon-kulon feligazak.
     */
    const results = (
      await Promise.all(
        routes.map(async (route) => {
          const recipients = await this.deviceTokens.recipients(
            input.userIds,
            route.platform,
          );
          return Promise.all(
            recipients.map(async (recipient) => {
              const result = await route.send(recipient);
              if (!result.ok && result.retired)
                await this.deviceTokens.retire(recipient.token);
              return { recipient, result };
            }),
          );
        }),
      )
    ).flat();
    if (results.length === 0) return empty;

    const summary = results.reduce<AssignmentSummary>(
      (totals, { result }) => ({
        sent: totals.sent + (result.ok ? 1 : 0),
        retired: totals.retired + (!result.ok && result.retired ? 1 : 0),
        failed: totals.failed + (!result.ok && !result.retired ? 1 : 0),
      }),
      empty,
    );

    // Written down whether it went well or not. A log line answers the
    // question while somebody is watching; this answers it tomorrow, when
    // somebody asks whether the technician was told at all.
    await input.record(
      results.map(({ recipient, result }) => ({
        userId: recipient.userId,
        delivered: result.ok,
        ...(result.ok
          ? {}
          : { reason: result.reason, retired: result.retired }),
      })),
    );

    if (summary.failed > 0) this.logger.warn(input.failureLine(summary));

    return summary;
  }
}

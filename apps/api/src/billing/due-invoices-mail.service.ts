import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { DueInvoicesResponse } from "@acropora/types";

import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import {
  MAIL_SENDER,
  type MailSender,
} from "../notifications/mail/mail.port.js";
import { formatMailFrom } from "../notifications/mail/mime.js";
import { budapestDay } from "./billing-document-list.js";
import { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import { loadDueInvoices } from "./due-invoices.loader.js";
import {
  buildDueInvoicesPdf,
  DUE_INVOICES_PDF_FILENAME,
  DUE_INVOICES_PDF_TITLE,
  pdfAmount,
} from "./due-invoices-pdf.js";

/**
 * A LEJÁRÓ SZÁMLÁK HETI LEVELE: a levél tartalma és a küldés (Balázs, 2026-11-20; acrobot 58228, 58230). A 2. szelet: a PDF és a levél,
 * a MEGLÉVŐ OS levélküldővel (`MAIL_SENDER`). Ez a szolgáltatás NEM ütemez és NEM dönt arról, mikor megy a levél: a döntés
 * (`decideDueInvoicesMail`) és az ütemezés a beállításokkal együtt a 3. szelet, ezért ez a szelet önmagában nem küld semmit.
 */

const dayText = (day: string) =>
  day.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1. $2. $3.");

const TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * A FELADÓ ALAPÉRTELMEZÉSE (acrobot 58274): NEM a `ticket@`, mert a `ticket@`-ra jövő válaszokból jegy-vázlat lehet. A cím a környezetből jön
 * (`DUE_INVOICES_MAIL_FROM`; ha az nincs, a vízmérés-levél feladója, `AQUARIUM_MEASUREMENT_MAIL_FROM`: ugyanaz az `info@` cím, ugyanaz a Gmail
 * „send as” álnév); cégadat nincs a kódban. Egyik sincs: `null`, és a levélküldő a SAJÁT alapértelmezett feladóját adja (a `ticket@`-ot), amit a
 * beállítás oldala kimond.
 */
export function dueInvoicesDefaultFrom(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    env.DUE_INVOICES_MAIL_FROM?.trim() ||
    env.AQUARIUM_MEASUREMENT_MAIL_FROM?.trim() ||
    null
  );
}

/** A `From:` fejléc a beállításból és a környezetből; `undefined`: a küldő alapértelmezett feladója. */
export function dueInvoicesFromHeader(
  fromAddress: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const address = fromAddress ?? dueInvoicesDefaultFrom(env);
  if (!address) return undefined;
  return formatMailFrom(
    env.DUE_INVOICES_MAIL_FROM_NAME?.trim() ||
      env.AQUARIUM_MEASUREMENT_MAIL_FROM_NAME?.trim() ||
      "Acropora",
    address,
  );
}

/** A levél tárgya és szövege a listából. */
export function dueInvoicesMailContent(input: {
  list: DueInvoicesResponse;
  lastBankData: Date | null;
  lateNotice: boolean;
}): { subject: string; text: string } {
  const { list } = input;
  const lines = [
    `Mellékelve a(z) ${DUE_INVOICES_PDF_TITLE} (${dayText(list.asOf)}).`,
    "",
    `${list.summary.count} számla${list.summary.overdue > 0 ? `, ebből ${list.summary.overdue} lejárt` : ""}. Hátralék: ${
      list.summary.totals
        .map((total) => pdfAmount(total.outstanding, total.currency))
        .join(" + ") || "0"
    }.`,
    input.lastBankData
      ? `Utolsó banki adat: ${TIME.format(input.lastBankData)}.`
      : "Utolsó banki adat: nincs betöltött bankadat.",
  ];
  if (input.lateNotice)
    lines.push(
      "Ma még nem érkezett új banki adat: a kifizetettség a legutóbbi betöltésen alapul.",
    );
  if (list.summary.withMissingData > 0)
    lines.push(
      `${list.summary.withMissingData} sorból hiányzik adat (bankszámlaszám, fizetési mód vagy határidő): a jegyzékben „nincs adat” áll.`,
    );
  if (list.summary.probablyNotTransfer.count > 0)
    lines.push(
      `Külön szakaszban, a fenti hátralékon kívül: ${list.summary.probablyNotTransfer.count} „valószínűleg nem utalandó” számla (${
        list.summary.probablyNotTransfer.totals
          .map((total) => pdfAmount(total.outstanding, total.currency))
          .join(" + ") || "0"
      }). A számlán nincs fizetési mód, és a szállító másik számláit kártyával fizettük, vagy a bank a saját díját levonta.`,
    );
  lines.push("", "Acropora OS");
  return {
    subject: `${DUE_INVOICES_PDF_TITLE}, ${dayText(list.asOf)}`,
    text: lines.join("\n"),
  };
}

export type DueInvoicesMailResult =
  | {
      readonly kind: "sent";
      readonly recipients: number;
      readonly count: number;
    }
  | { readonly kind: "no-recipients" };

@Injectable()
export class DueInvoicesMailService {
  /** a teszt cseréli: a lista, ahogy a lap mutatja */
  loadList: (now: Date) => Promise<DueInvoicesResponse>;
  /** a teszt cseréli: az utolsó banki betöltés ideje */
  readLastBankData: () => Promise<Date | null> = lastBankData;

  constructor(
    missing: MissingInvoicesService,
    reviews: IncomingReviewService,
    @Inject(MAIL_SENDER) private readonly sender: MailSender,
  ) {
    this.loadList = (now) => loadDueInvoices({ missing, reviews }, now);
  }

  /**
   * ELKÜLDI A LEVELET a megadott címzetteknek. Címzett nélkül nem küld (`no-recipients`), nem dob. A küldő hibája NEM nyelődik el: a hívó
   * (az ütemező) látja, hogy nem ment ki, és nem jelöli elküldöttnek.
   */
  async send(input: {
    recipients: readonly string[];
    lateNotice: boolean;
    now?: Date;
    /** a `From:` fejléc (`dueInvoicesFromHeader`); nélküle a levélküldő alapértelmezett feladója */
    from?: string;
  }): Promise<DueInvoicesMailResult> {
    const recipients = [
      ...new Set(input.recipients.map((r) => r.trim()).filter(Boolean)),
    ];
    if (recipients.length === 0) return { kind: "no-recipients" };
    const now = input.now ?? new Date();
    const [list, last] = await Promise.all([
      this.loadList(now),
      this.readLastBankData(),
    ]);
    const pdf = await buildDueInvoicesPdf({
      list,
      lastBankData: last,
      generatedAt: now,
      lateNotice: input.lateNotice,
    });
    const content = dueInvoicesMailContent({
      list,
      lastBankData: last,
      lateNotice: input.lateNotice,
    });
    await this.sender.send({
      to: recipients,
      ...(input.from ? { from: input.from } : {}),
      subject: content.subject,
      text: content.text,
      attachments: [
        {
          filename: DUE_INVOICES_PDF_FILENAME,
          contentType: "application/pdf",
          bytes: pdf,
        },
      ],
    });
    return {
      kind: "sent",
      recipients: recipients.length,
      count: list.summary.count,
    };
  }
}

/** Az utolsó banki betöltés ideje: a legnagyobb `BankTransaction.createdAt`; `null`, ha nincs bankadat. */
export async function lastBankData(): Promise<Date | null> {
  return (await prisma.bankTransaction.aggregate({ _max: { createdAt: true } }))
    ._max.createdAt;
}

/**
 * A MAI NAP ELSŐ ÚJ BANKI BETÖLTÉSE (a küldési szabály bemenete, `decideDueInvoicesMail`): a legkorábbi `BankTransaction.createdAt`, ami
 * a megadott budapesti napra esik; `null`, ha aznap nem jött banki sor. Csak a megkülönböztető időbélyegeket olvassa (egy betöltés sorai
 * egy időbélyegen állnak), és a budapesti napot a szolgáltató számolja, nem egy fix UTC-eltolás.
 */
export async function firstBankLoadOn(
  day: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const rows = await prisma.bankTransaction.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 48 * 3_600_000) } },
    select: { createdAt: true },
    distinct: ["createdAt"],
    orderBy: { createdAt: "asc" },
  });
  return firstLoadOnDay(
    rows.map((r) => r.createdAt),
    day,
  );
}

/** A megadott budapesti napra eső legkorábbi időpont (a lista nem kell rendezett legyen); `null`, ha egy sem esik rá. */
export function firstLoadOnDay(
  times: readonly Date[],
  day: string,
): Date | null {
  return (
    [...times]
      .filter((at) => budapestDay(at) === day)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  );
}

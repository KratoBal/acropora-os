import { Injectable } from "@nestjs/common";

import { prisma } from "@acropora/database";

import type { HandoverRecipient } from "./handover-mail-recipients.js";

/**
 * A LEZART HIBAJEGY KIKULDESENEK ADATAI.
 *
 * === MIERT KULON TAROLO, ES NEM A `WorksheetsRepository.customerContacts` ===
 *
 * Az a lekerdezes UGYANEZT a kort adja (a vevo aktiv fiokjai), de `id` es
 * `displayName` mezovel -- CIM NELKUL, mert az alairo-valasztot szolgalja ki.
 * A cim felvetele oda azt jelentene, hogy egy VALASZTO-LISTA vegpontja e-mail
 * cimeket kezd szallitani a portalra. A ket felulet szandekosan mas adatot lat.
 */
@Injectable()
export class HandoverMailRepository {
  /*
    A `prisma` KOZVETLENUL, NEM KONSTRUKTOR-PARAMETERKENT -- ugyanugy, mint a
    szomszed `TicketMailRepository`-ban.

    Az elso valtozatom `constructor(private readonly database = prisma) {}`
    alakot hasznalt. Az alapertelmezett ertek TypeScript-oldalon rendben van, a
    Nest viszont a konstruktor-parametert INJEKTALANDONAK latja, es nem talal
    hozza szolgaltatast: `Nest can't resolve dependencies of the
    HandoverMailRepository (?)`.

    ES EZ NEM FORDITASI HIBA VOLT: a typecheck zold maradt, es az alkalmazas
    INDULASKOR hasalt volna el. Az `app.bootstrap.spec` fogta meg, ami a teljes
    fuggosegi grafot forditja -- ezert er az a spec tobbet, mint amennyinek
    latszik.
  */

  /**
   * A JEGY, A HELYSZINE ES A HELYSZIN GAZDAJA.
   *
   * A "helyszint birtoklok" lanca: `ServiceJob.departmentId` ->
   * `WorksheetDepartment.customerId` -> `Customer`. A jegyen ALL sajat
   * `customerId` is, de a kerdes a HELYSZINROL szol (Balazs specje), es a
   * ketto elterhet -- ezert az alegysegen at megyunk, nem a jegy sajat mezojen.
   */
  async jobForMail(serviceJobId: string) {
    return prisma.serviceJob.findUnique({
      where: { id: serviceJobId },
      select: {
        id: true,
        jobNumber: true,
        title: true,
        status: true,
        departmentId: true,
        department: { select: { customerId: true } },
      },
    });
  }

  /**
   * A HELYSZINT BIRTOKLO VEVO AKTIV PORTAL-FIOKJAI, CIMMEL.
   *
   * AZ `isActive` SZURES ITT IS FUT, HOLOTT A SZABALY IS SZURI. Nem masolat:
   * ez a lekerdezes HATAROLAS (ne hozzunk be feleslegesen inaktiv sorokat), a
   * szabalye pedig a DONTES -- es az adatbazis nelkul is merheto. Ha csak itt
   * allna, a viselkedesre csak eles adaton lehetne allitast tenni.
   */
  async recipients(customerId: string): Promise<HandoverRecipient[]> {
    const rows = await prisma.user.findMany({
      where: { customerId, isActive: true },
      select: { email: true, displayName: true, isActive: true },
      orderBy: { displayName: "asc" },
    });
    return rows.map((row) => ({
      email: row.email,
      displayName: row.displayName,
      isActive: row.isActive,
    }));
  }

  /**
   * A KULDES NYOMA -- CSAK BELSOS.
   *
   * A jegy naploja a TENYT es a DARABSZAMOT mondja (cim nelkul); ez a sor azt,
   * hogy KINEK. A ket hely ket kulonbozo allitas, es aki egyszer osszevonja
   * oket, azzal a cimek kiszivarognak a portalra.
   */
  async recordDelivery(input: {
    serviceJobId: string;
    jobNumber: string;
    initiatedByUserId: string | null;
    subject: string;
    recipients: readonly { email: string; name: string }[];
    attachmentBytes: number;
    outcome: string;
    error?: string | null;
  }) {
    await prisma.ticketMailDelivery.create({
      data: {
        serviceJobId: input.serviceJobId,
        jobNumber: input.jobNumber,
        initiatedByUserId: input.initiatedByUserId,
        subject: input.subject,
        recipients: input.recipients as unknown as object,
        attachmentBytes: input.attachmentBytes,
        outcome: input.outcome,
        error: input.error ?? null,
      },
    });
  }
}

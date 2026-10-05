import { Injectable, Logger } from "@nestjs/common";

import {
  type MedusaAdminClient,
  type MedusaOrderRow,
} from "../../integrations/medusa/medusa-admin.client.js";

/**
 * A MEDUSA-BOLT RENDELESEINEK ATVETELE AZ ACROPORA OS-BE.
 *
 * A MODSZER a `unas-order-sync` precedensebol jon (ot perces lehivas, webhook
 * NELKUL, idempotencia a kulso azonositon), a NEVEK es a szerzodes viszont a
 * Medusa oldalarol -- a precedens a dontest adja, nem a mezoneveket.
 *
 * A KESZLET FOGY, ES EZ DONTES, NEM MASOLAS.
 *
 * Balazs 2026-09-09 17:16-kor (Eldontendo szal) kimondta, hogy a termekadat
 * gazdaja a UNAS, de EGYETLEN kivetellel: "Egyetlen egy dologban nem az unas a
 * fonok a keszletben. Ezt az OS csinalja." Es hozzatette: "A keszlet mindket
 * helyen frissuljon es konzisztens legyen." Ha az OS a gazda, akkor egy nala
 * beerkezo eladas nala fogy.
 *
 * ES A "KETSZERES FOGYAS" NEM AZ: egy Medusa-rendeles es egy UNAS-rendeles KET
 * KULON eladas, ket kulon vevo. A ketto egyutt osszegzes, nem duplazas.
 * Duplazas csak akkor lenne, ha UGYANAZ a rendeles jonne be ket uton -- arra a
 * `MEDUSA-<order.id>` kulcs es a keszletmozgas sajat idempotencia-kulcsa a
 * valasz.
 *
 * AMI VISZONT MA IS KEZI, ES EZT ITT KELL KIMONDANI: az OS -> bolt
 * keszlet-vetitesnek nincs utemezoje az elesen. Tehat egy eladas utan a bolt
 * keszlete NEM frissul magatol. Ez nem ennek az atvetelnek a hianya -- a
 * UNAS-eladasoknal is igy van --, de aki eloszor nezi meg a boltot egy eladas
 * utan, ismert hianyra fog hibat jelenteni.
 */
export interface MedusaOrderSyncRepository {
  /**
   * Megnyit egy kort, ha nincs masik futo. A visszaadott `null` NEM hiba:
   * azt jelenti, hogy egy masik peldany epp dolgozik.
   */
  claimRun(params: {
    activeKey: string;
    windowStart: Date | null;
    windowEnd: Date;
  }): Promise<{ id: string } | null>;

  /** A legutobb ATVETT rendeles letrehozasi ideje, vagy null az elso koron. */
  lastIngestedAt(): Promise<Date | null>;

  /**
   * Letrehozza a rendelest, ha meg nincs. A visszateres azt mondja meg, hogy
   * UJ sor keletkezett-e -- ebbol all ossze a kor `createdCount` erteke.
   */
  createIfAbsent(order: MedusaOrderRow): Promise<boolean>;

  closeRun(params: {
    runId: string;
    ordersSeen: number;
    createdCount: number;
    truncated: boolean;
    errorCode: string | null;
  }): Promise<void>;
}

export interface MedusaOrderSyncOutcome {
  /** Hamis, ha egy masik kor epp futott: ilyenkor semmi nem tortent. */
  ran: boolean;
  ordersSeen: number;
  createdCount: number;
  truncated: boolean;
}

@Injectable()
export class MedusaOrderSyncService {
  private readonly logger = new Logger(MedusaOrderSyncService.name);

  constructor(
    private readonly client: MedusaAdminClient,
    private readonly repository: MedusaOrderSyncRepository,
  ) {}

  async runOnce(now: Date = new Date()): Promise<MedusaOrderSyncOutcome> {
    const windowStart = await this.repository.lastIngestedAt();
    const run = await this.repository.claimRun({
      activeKey: "medusa-order-sync",
      windowStart,
      windowEnd: now,
    });

    /**
     * A ZAR NEM KIVETEL. Ha egy masik peldany dolgozik, ez a kor egyszeruen
     * nem csinal semmit -- a kovetkezo ot perc mulva ujra probal. Kivetelt
     * dobni azert lenne rossz, mert a napló tele lenne olyan hibaval, ami a
     * rendszer HELYES mukodese.
     */
    if (!run)
      return { ran: false, ordersSeen: 0, createdCount: 0, truncated: false };

    let ordersSeen = 0;
    let createdCount = 0;
    let truncated = false;
    let errorCode: string | null = null;

    try {
      const eredmeny = await this.client.listOrders(
        windowStart ? windowStart.toISOString() : null,
      );
      ordersSeen = eredmeny.rows.length;
      truncated = eredmeny.truncated;

      for (const order of eredmeny.rows)
        if (await this.repository.createIfAbsent(order)) createdCount += 1;

      if (truncated)
        this.logger.warn(
          `A lehivas elerte a felso hatart (${ordersSeen} rendeles). Lehet tobb: a kovetkezo kor ugyanonnan folytatja.`,
        );
    } catch (error) {
      /**
       * A HIBAKOD A NAPLOBA KERUL, ES A KOR `FAILED` LESZ -- de a zar akkor is
       * felszabadul. Egy bent ragadt zar ugyanazt csinalna, mint egy vegtelen
       * futas: a kovetkezo kor sosem indulna el, es semmi nem szolna rola.
       */
      errorCode = error instanceof Error ? error.name : "UNKNOWN";
      await this.repository.closeRun({
        runId: run.id,
        ordersSeen,
        createdCount,
        truncated,
        errorCode,
      });
      throw error;
    }

    await this.repository.closeRun({
      runId: run.id,
      ordersSeen,
      createdCount,
      truncated,
      errorCode: null,
    });

    return { ran: true, ordersSeen, createdCount, truncated };
  }
}

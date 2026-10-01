import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  planBankRows,
  type BankSource,
  type ExistingBankTransaction,
  type IncomingBankRow,
} from "./bank-transaction-sources.js";
import type { OtpStatementRow } from "./otp-statement.parser.js";
import { normalizeAccount } from "./missing-invoices.repository.js";

/** Egy beírandó sor bármelyik forrásból: a lefoglaláshoz kellő mezők és a tárolandók. */
export interface IngestRow extends IncomingBankRow {
  readonly bookingDate: Date;
  /** A forrás értéknapja, ha adott; a lefoglalás nélküle a könyvelési napot nézi. */
  readonly sourceValueDate: Date | null;
  readonly counterpartyName: string | null;
  readonly narrative: string;
  readonly transactionType: string | null;
}

export interface IngestResult {
  importId: string;
  /** Új tranzakció. */
  createdCount: number;
  /** Egy másik forrásból már bent lévő tranzakció, amit ez a forrás most lefoglalt. */
  claimedCount: number;
}

/**
 * A KIVONAT ÉS A TOVÁBBÍTÁS BEÍRÁSA, EGY TRANZAKCIÓBAN: a feltöltés nyoma, a
 * hiányzó bankszámlák (csak a CSV hozhat újat) és a sorok.
 *
 * MINDEN FORRÁS UGYANAZON AZ ÚTON: a forrás saját kulcsa egyszer foglal le egy
 * tranzakciót (`BankTransactionSourceKey`). Ugyanaz a kulcs másodszor semmit nem
 * ír; egy másik forrásból már bent lévő, ugyanolyan fizetést lefoglal, nem
 * duplikál (`planBankRows`). A beírások egymás után futnak (tanácsadó zár): két
 * egyidejű feltöltés vagy továbbítás nem hozhatja létre kétszer ugyanazt.
 */
@Injectable()
export class BankStatementImportRepository {
  private readonly database = prisma;

  /** A CSV-kivonat: a mai kulcs a sor kulcsa, tehát egy újrafeltöltés semmit nem ír. */
  async importRows(input: {
    fileName: string;
    sha256: string;
    rows: readonly OtpStatementRow[];
    rejectedCount: number;
    userId: string;
  }): Promise<{ importId: string; createdCount: number }> {
    const result = await this.ingest({
      fileName: input.fileName,
      sha256: input.sha256,
      rejectedCount: input.rejectedCount,
      userId: input.userId,
      createAccounts: true,
      rows: input.rows.map((row) => ({
        source: "CSV",
        sourceKey: row.transactionKey,
        accountNumber: row.accountNumber,
        direction: row.direction,
        amount: row.amount,
        currency: row.currency,
        valueDate: row.valueDate ?? row.bookingDate,
        counterpartyAccount: row.counterpartyAccount,
        bookingDate: row.bookingDate,
        sourceValueDate: row.valueDate,
        counterpartyName: row.counterpartyName,
        narrative: row.narrative,
        transactionType: row.transactionType,
      })),
    });
    return { importId: result.importId, createdCount: result.createdCount };
  }

  /** A saját bankszámláink, normalizált számmal: a továbbítás csak ezekre írhat. */
  async ownAccounts(): Promise<Map<string, string>> {
    const rows = await this.database.bankAccount.findMany({
      select: { accountNumber: true },
    });
    return new Map(
      rows.map((r) => [normalizeAccount(r.accountNumber), r.accountNumber]),
    );
  }

  async ingest(input: {
    fileName: string;
    sha256: string;
    rows: readonly IngestRow[];
    rejectedCount: number;
    userId: string | null;
    /** Csak a CSV hozhat létre bankszámlát; a továbbítás csak meglévőre ír. */
    createAccounts: boolean;
  }): Promise<IngestResult> {
    return this.database.$transaction(async (transaction) => {
      // egymás után: két forrás egyszerre se hozza létre kétszer ugyanazt
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bank-transaction-ingest'))`;
      const accountIds = new Map<string, string>();
      for (const row of input.rows) {
        if (accountIds.has(row.accountNumber)) continue;
        const account = input.createAccounts
          ? await transaction.bankAccount.upsert({
              where: { accountNumber: row.accountNumber },
              create: {
                accountNumber: row.accountNumber,
                currency: row.currency,
              },
              update: {},
              select: { id: true },
            })
          : await transaction.bankAccount.findUnique({
              where: { accountNumber: row.accountNumber },
              select: { id: true },
            });
        if (!account)
          throw new Error(`ismeretlen bankszámla: ${row.accountNumber}`);
        accountIds.set(row.accountNumber, account.id);
      }
      const record = await transaction.bankStatementImport.create({
        data: {
          fileName: input.fileName,
          sha256: input.sha256,
          rowCount: input.rows.length,
          createdCount: 0,
          skippedCount: 0,
          rejectedCount: input.rejectedCount,
          importedByUserId: input.userId,
        },
        select: { id: true },
      });

      const known = await transaction.bankTransactionSourceKey.findMany({
        where: { key: { in: input.rows.map((r) => r.sourceKey) } },
        select: { key: true },
      });
      const days = [
        ...new Set(
          input.rows.map((r) => r.valueDate.toISOString().slice(0, 10)),
        ),
      ].map((d) => new Date(`${d}T00:00:00Z`));
      const candidates = await transaction.bankTransaction.findMany({
        where: {
          bankAccountId: { in: [...accountIds.values()] },
          OR: [
            { valueDate: { in: days } },
            { valueDate: null, bookingDate: { in: days } },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          bankAccount: { select: { accountNumber: true } },
          direction: true,
          amount: true,
          currency: true,
          valueDate: true,
          bookingDate: true,
          counterpartyAccount: true,
          sourceKeys: { select: { source: true } },
        },
      });
      const existing: ExistingBankTransaction[] = candidates.map((c) => ({
        id: c.id,
        accountNumber: c.bankAccount.accountNumber,
        direction: c.direction,
        amount: c.amount,
        currency: c.currency,
        valueDate: c.valueDate ?? c.bookingDate,
        counterpartyAccount: c.counterpartyAccount,
        sources: c.sourceKeys.map((k) => k.source as BankSource),
      }));

      const plan = planBankRows(
        input.rows,
        new Set(known.map((k) => k.key)),
        existing,
      );
      let createdCount = 0;
      let claimedCount = 0;
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const action = plan[i]!;
        if (action.kind === "SKIP") continue;
        let transactionId: string;
        if (action.kind === "CLAIM") {
          transactionId = action.transactionId;
          claimedCount++;
        } else {
          const created = await transaction.bankTransaction.create({
            data: {
              bankAccountId: accountIds.get(row.accountNumber)!,
              importId: record.id,
              direction: row.direction,
              amount: row.amount,
              currency: row.currency,
              bookingDate: row.bookingDate,
              valueDate: row.sourceValueDate,
              counterpartyAccount: row.counterpartyAccount,
              counterpartyName: row.counterpartyName,
              narrative: row.narrative,
              transactionType: row.transactionType,
              transactionKey: row.sourceKey,
            },
            select: { id: true },
          });
          transactionId = created.id;
          createdCount++;
        }
        await transaction.bankTransactionSourceKey.create({
          data: {
            key: row.sourceKey,
            source: row.source,
            bankTransactionId: transactionId,
          },
        });
      }
      await transaction.bankStatementImport.update({
        where: { id: record.id },
        data: { createdCount, skippedCount: input.rows.length - createdCount },
      });
      return { importId: record.id, createdCount, claimedCount };
    });
  }
}

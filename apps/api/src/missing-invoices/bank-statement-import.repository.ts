import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { OtpStatementRow } from "./otp-statement.parser.js";

/**
 * A KIVONAT BEÍRÁSA, EGY TRANZAKCIÓBAN: a feltöltés nyoma, a hiányzó
 * bankszámlák és az új sorok. A már meglévő sort (ugyanaz a kulcs egy korábbi
 * feltöltésből) az adatbázis egyedi kulcsa hagyja ki, tehát két egyidejű
 * feltöltés sem ír kétszer.
 */
@Injectable()
export class BankStatementImportRepository {
  private readonly database = prisma;

  async importRows(input: {
    fileName: string;
    sha256: string;
    rows: readonly OtpStatementRow[];
    rejectedCount: number;
    userId: string;
  }): Promise<{ importId: string; createdCount: number }> {
    return this.database.$transaction(async (transaction) => {
      const accounts = new Map<string, string>();
      for (const row of input.rows)
        if (!accounts.has(row.accountNumber))
          accounts.set(row.accountNumber, row.currency);
      const accountIds = new Map<string, string>();
      for (const [accountNumber, currency] of accounts) {
        const account = await transaction.bankAccount.upsert({
          where: { accountNumber },
          create: { accountNumber, currency },
          update: {},
          select: { id: true },
        });
        accountIds.set(accountNumber, account.id);
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
      const created = await transaction.bankTransaction.createMany({
        data: input.rows.map((row) => ({
          bankAccountId: accountIds.get(row.accountNumber)!,
          importId: record.id,
          direction: row.direction,
          amount: row.amount,
          currency: row.currency,
          bookingDate: row.bookingDate,
          valueDate: row.valueDate,
          counterpartyAccount: row.counterpartyAccount,
          counterpartyName: row.counterpartyName,
          narrative: row.narrative,
          transactionType: row.transactionType,
          transactionKey: row.transactionKey,
        })),
        skipDuplicates: true,
      });
      await transaction.bankStatementImport.update({
        where: { id: record.id },
        data: {
          createdCount: created.count,
          skippedCount: input.rows.length - created.count,
        },
      });
      return { importId: record.id, createdCount: created.count };
    });
  }
}

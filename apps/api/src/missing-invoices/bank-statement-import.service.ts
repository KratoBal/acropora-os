import { createHash } from "node:crypto";

import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  AuthenticatedUser,
  BankStatementImportResult,
} from "@acropora/types";

import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { parseOtpStatement } from "./otp-statement.parser.js";

/**
 * A HAVI KIVONAT KÉZI FELTÖLTÉSE (acrobot 25262, 1. szelet): az OTP CSV-export
 * a Hiányzó számlák oldalon. Idempotens: ugyanaz a fájl, vagy egy átfedő másik
 * export, csak az új sorokat írja be.
 */
@Injectable()
export class BankStatementImportService {
  constructor(private readonly repository: BankStatementImportRepository) {}

  async import(
    file: { originalname: string; buffer: Buffer },
    user: AuthenticatedUser,
  ): Promise<BankStatementImportResult> {
    let parsed;
    try {
      parsed = parseOtpStatement(file.buffer);
    } catch {
      throw new BadRequestException(
        "A fájl nem UTF-8 szöveg. Az OTP havi CSV-exportját töltsd fel.",
      );
    }
    if (parsed.rows.length === 0)
      throw new BadRequestException(
        parsed.rejected.length > 0
          ? `A fájlban nincs olvasható kivonat-sor (az első hiba a ${parsed.rejected[0]!.line}. sorban: ${parsed.rejected[0]!.reason}).`
          : "A fájl üres.",
      );
    const { importId, createdCount } = await this.repository.importRows({
      fileName: file.originalname,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      rows: parsed.rows,
      rejectedCount: parsed.rejected.length,
      userId: user.id,
    });
    const accounts = new Map<string, string>();
    for (const row of parsed.rows)
      if (!accounts.has(row.accountNumber))
        accounts.set(row.accountNumber, row.currency);
    return {
      importId,
      fileName: file.originalname,
      rowCount: parsed.rows.length,
      createdCount,
      skippedCount: parsed.rows.length - createdCount,
      rejected: parsed.rejected.slice(0, 10),
      rejectedCount: parsed.rejected.length,
      accounts: [...accounts].map(([accountNumber, currency]) => ({
        accountNumber,
        currency,
      })),
      months: [
        ...new Set(
          parsed.rows.map((row) => row.bookingDate.toISOString().slice(0, 7)),
        ),
      ].sort(),
    };
  }
}

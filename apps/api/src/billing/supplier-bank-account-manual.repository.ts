import type { Prisma, PrismaClient } from "@acropora/database";

import {
  decideManualAccount,
  type ManualContext,
  type ManualOutcome,
} from "./supplier-bank-account-manual.js";
import { supplierAccountKey } from "./supplier-bank-account-key.js";
import {
  accountFromBankText,
  normalizeSupplierAccount,
} from "./supplier-bank-account-text.js";

/**
 * A KÉZI MEGADÁS TÁROLÁSA ÉS NAPLÓZÁSA (acrobot 58655; döntés: `supplier-bank-account-manual.ts`). Egy tranzakcióban: a sor és a szállító környezetének beolvasása, a döntés, az írás (a
 * `SupplierBankAccountFill` egy sora, szállítónként EGY) és az AuditLog-sor (ki, mikor, a csere a korábbi számlaszámmal). Meglévő számlaszámot csendben soha nem ír: csere csak megerősítéssel.
 */
export type ManualDatabase = Pick<PrismaClient, "$transaction">;

export class ManualRowNotFoundError extends Error {
  constructor() {
    super("A számla sora nem található.");
  }
}

export interface ManualInput {
  readonly rowId: string;
  /** a beírt szöveg, ahogy érkezett */
  readonly accountText: string;
  readonly confirmReplace: boolean;
  readonly userId: string;
  readonly now?: Date;
}

export interface ManualResult {
  readonly outcome: ManualOutcome;
  /** igaz, ha a tábla változott */
  readonly changed: boolean;
  /** a normalizált számlaszám, amit a sor most hordoz (létrehozásnál, cserénél, változatlannál) */
  readonly account: string | null;
}

const last4 = (account: string) => account.slice(-4);

const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

export async function setManualSupplierAccount(
  database: ManualDatabase,
  input: ManualInput,
): Promise<ManualResult> {
  return database.$transaction(async (tx) => {
    const row = await tx.incomingBillingDocument.findUnique({
      where: { id: input.rowId },
    });
    if (!row) throw new ManualRowNotFoundError();
    const key = supplierAccountKey(
      row.supplierTaxNumber,
      row.supplierEuTaxNumber,
      row.supplierName,
    );
    const account = accountFromBankText(input.accountText);
    const context = await contextOf(tx, row, key);
    const outcome = decideManualAccount({
      context,
      account,
      confirmReplace: input.confirmReplace,
    });
    const now = input.now ?? new Date();

    if (outcome.kind === "CREATE") {
      const created = await tx.supplierBankAccountFill.create({
        data: {
          supplierKey: key!,
          supplierName: row.supplierName,
          supplierTaxNumber: row.supplierTaxNumber,
          supplierEuTaxNumber: row.supplierEuTaxNumber,
          account: account!,
          source: "MANUAL",
          evidenceIds: [],
          enteredByUserId: input.userId,
          enteredAt: now,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "billing.supplier-account.manual-entered",
          entityType: "SupplierBankAccountFill",
          entityId: created.id,
          metadata: {
            supplierKey: key,
            supplierName: row.supplierName,
            rowId: row.id,
            documentNumber: row.documentNumber,
            accountLast4: last4(account!),
          },
        },
      });
      return { outcome, changed: true, account };
    }

    if (outcome.kind === "REPLACE") {
      const existing = await tx.supplierBankAccountFill.findUniqueOrThrow({
        where: { supplierKey: key! },
        select: { id: true },
      });
      await tx.supplierBankAccountFill.update({
        where: { id: existing.id },
        data: {
          account: account!,
          source: "MANUAL",
          evidenceIds: [],
          enteredByUserId: input.userId,
          enteredAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "billing.supplier-account.manual-replaced",
          entityType: "SupplierBankAccountFill",
          entityId: existing.id,
          metadata: {
            supplierKey: key,
            supplierName: row.supplierName,
            rowId: row.id,
            documentNumber: row.documentNumber,
            accountLast4: last4(account!),
            // a korábbi értéket teljesen őrizzük: egy téves csere visszaállítható
            previousAccount: outcome.previous.account,
            previousSource: outcome.previous.source,
          },
        },
      });
      return { outcome, changed: true, account };
    }

    return {
      outcome,
      changed: false,
      account: outcome.kind === "UNCHANGED" ? account : null,
    };
  });
}

type Transaction = Prisma.TransactionClient;

/** A sor és a szállító környezete: saját számlaszám, a kitöltésnél előbbre való források, a meglévő kitöltés. */
async function contextOf(
  tx: Transaction,
  row: {
    id: string;
    supplierBankAccount: string | null;
    supplierTaxNumber: string | null;
    supplierEuTaxNumber: string | null;
  },
  key: string | null,
): Promise<ManualContext> {
  const rowHasOwnAccount = !blank(row.supplierBankAccount);
  if (key === null || !(key.startsWith("hu:") || key.startsWith("eu:")))
    return { key, rowHasOwnAccount, shadowedBy: null, fill: null };
  const needle = key.slice(3);
  const [siblings, masters, fill] = await Promise.all([
    tx.incomingBillingDocument.findMany({
      where: {
        id: { not: row.id },
        OR: [
          { supplierTaxNumber: { contains: needle } },
          { supplierEuTaxNumber: { contains: needle } },
        ],
      },
      select: {
        supplierName: true,
        supplierTaxNumber: true,
        supplierEuTaxNumber: true,
        supplierBankAccount: true,
      },
    }),
    tx.supplier.findMany({
      where: { taxNumber: { contains: needle } },
      select: {
        name: true,
        taxNumber: true,
        bankAccountNumber: true,
        iban: true,
      },
    }),
    tx.supplierBankAccountFill.findUnique({
      where: { supplierKey: key },
      select: { account: true, source: true },
    }),
  ]);
  const otherInvoice = siblings.some(
    (s) =>
      !blank(s.supplierBankAccount) &&
      normalizeSupplierAccount(s.supplierBankAccount!) !== "" &&
      supplierAccountKey(
        s.supplierTaxNumber,
        s.supplierEuTaxNumber,
        s.supplierName,
      ) === key,
  );
  const master = masters.some(
    (m) =>
      supplierAccountKey(m.taxNumber, m.taxNumber, m.name) === key &&
      [m.bankAccountNumber, m.iban].some(
        (value) => !blank(value) && normalizeSupplierAccount(value!) !== "",
      ),
  );
  return {
    key,
    rowHasOwnAccount,
    shadowedBy: otherInvoice ? "OTHER_INVOICE" : master ? "MASTER" : null,
    fill: fill
      ? {
          account: fill.account,
          source: fill.source,
        }
      : null,
  };
}

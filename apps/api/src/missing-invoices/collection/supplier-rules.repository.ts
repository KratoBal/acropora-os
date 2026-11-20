import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import { UNASSIGNED } from "./invoice-collection.repository.js";
import {
  raisedCeilings,
  type SupplierRule,
  type SupplierRuleKind,
} from "./supplier-rule.js";

/** A szabály, ahogy a lap látja: a kulcs, a feladó, ki hozta létre, hányat fogadott el. */
export interface SupplierRuleRow extends SupplierRule {
  label: string;
  acceptedCount: number;
  createdAt: Date;
  createdByUserId: string | null;
  disabledAt: Date | null;
}

export interface NewSupplierRule {
  kind: SupplierRuleKind;
  taxKey: string | null;
  nameKey: string | null;
  senderDomain: string | null;
  label: string;
  grossCeilings: Record<string, number>;
  sourceDocumentId: string;
  userId: string;
}

/** Az automatikusan elfogadott dokumentum a visszavonás listájához. */
export interface AutoAcceptedRow {
  id: string;
  fileName: string;
  sender: string | null;
  receivedAt: Date | null;
  acceptedAt: Date;
  ruleId: string;
  textReading: Prisma.JsonValue;
}

export const AUTO_ACCEPT_ACTION = "invoice-collection.supplier-rule-accepted";
export const RULE_CREATED_ACTION = "invoice-collection.supplier-rule-created";
export const RULE_DISABLED_ACTION = "invoice-collection.supplier-rule-disabled";
export const AUTO_UNDO_ACTION = "invoice-collection.supplier-rule-undone";

const ceilingsOf = (value: Prisma.JsonValue): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([currency, cents]) =>
      typeof cents === "number" && Number.isFinite(cents)
        ? [[currency, cents]]
        : [],
    ),
  );
};

const toRule = (row: {
  id: string;
  kind: string;
  taxKey: string | null;
  nameKey: string | null;
  senderDomain: string | null;
  grossCeilings: Prisma.JsonValue;
}): SupplierRule => ({
  id: row.id,
  kind: row.kind === "NAME" ? "NAME" : "TAX",
  taxKey: row.taxKey,
  nameKey: row.nameKey,
  senderDomain: row.senderDomain,
  grossCeilings: ceilingsOf(row.grossCeilings),
});

/**
 * AZ ISMERT SZÁLLÍTÓ SZABÁLYAI ÉS AZ ELFOGADÁSOK NAPLÓJA (`supplier-rule.ts`). Minden írás feltételes: egy közben meghozott
 * emberi döntést nem ír felül, és kétszer sem fut le.
 */
@Injectable()
export class SupplierRulesRepository {
  private readonly database = prisma;

  async activeRules(): Promise<SupplierRule[]> {
    const rows = await this.database.incomingSupplierRule.findMany({
      where: { disabledAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRule);
  }

  async list(): Promise<SupplierRuleRow[]> {
    const rows = await this.database.incomingSupplierRule.findMany({
      orderBy: [
        { disabledAt: { sort: "asc", nulls: "first" } },
        { createdAt: "desc" },
      ],
    });
    return rows.map((row) => ({
      ...toRule(row),
      label: row.label,
      acceptedCount: row.acceptedCount,
      createdAt: row.createdAt,
      createdByUserId: row.createdByUserId,
      disabledAt: row.disabledAt,
    }));
  }

  /** Új szabály, vagy a már aktív ugyanilyen kulcsú (a részleges egyedi index): az azonosítóját adja, és hogy új volt-e. */
  async create(
    input: NewSupplierRule,
  ): Promise<{ id: string; created: boolean }> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const rule = await transaction.incomingSupplierRule.create({
          data: {
            kind: input.kind,
            taxKey: input.taxKey,
            nameKey: input.nameKey,
            senderDomain: input.senderDomain,
            label: input.label,
            grossCeilings: input.grossCeilings,
            sourceDocumentId: input.sourceDocumentId,
            createdByUserId: input.userId,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: RULE_CREATED_ACTION,
            entityType: "IncomingSupplierRule",
            entityId: rule.id,
            metadata: {
              kind: input.kind,
              taxKey: input.taxKey,
              nameKey: input.nameKey,
              senderDomain: input.senderDomain,
              label: input.label,
              sourceDocumentId: input.sourceDocumentId,
            },
          },
        });
        return { id: rule.id, created: true };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.database.incomingSupplierRule.findFirst({
          where: {
            disabledAt: null,
            kind: input.kind,
            taxKey: input.taxKey,
            nameKey: input.nameKey,
            senderDomain: input.senderDomain,
          },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
      }
      throw error;
    }
  }

  /**
   * AZ ELFOGADÁS NAPLÓJA: a dokumentum a szabály nevén elfogadott (ki: a szabály, `reviewedByUserId` üres, vagy az ember, ha ő
   * erősítette meg a kötegben), a szabály legnagyobb összege nő, a darabszám nő, az auditnaplóba a jelekkel. A dokumentum
   * UNASSIGNED vagy SUGGESTED állapotú legyen még: különben (közben döntöttek) nem ír semmit, és `false`.
   */
  async recordAccepted(input: {
    ruleId: string;
    documentId: string;
    grossCents: number | null;
    currency: string | null;
    /** ember, ha a köteg elfogadását ő erősítette meg; null: a begyűjtés maga */
    userId: string | null;
    signals: Record<string, unknown>;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const rule = await transaction.incomingSupplierRule.findFirst({
        where: { id: input.ruleId },
        select: { grossCeilings: true },
      });
      if (!rule) return false;
      await transaction.incomingSupplierDocument.update({
        where: { id: input.documentId },
        data: {
          acceptedByRuleId: input.ruleId,
          reviewedAt: new Date(),
          reviewedByUserId: input.userId,
        },
      });
      await transaction.incomingSupplierRule.update({
        where: { id: input.ruleId },
        data: {
          acceptedCount: { increment: 1 },
          grossCeilings: raisedCeilings(
            ceilingsOf(rule.grossCeilings),
            input.currency,
            input.grossCents,
          ),
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: AUTO_ACCEPT_ACTION,
          entityType: "IncomingSupplierDocument",
          entityId: input.documentId,
          metadata: {
            ruleId: input.ruleId,
            grossCents: input.grossCents,
            currency: input.currency,
            amountless: input.grossCents === null,
            ...input.signals,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }

  async disable(id: string, userId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const { count } = await transaction.incomingSupplierRule.updateMany({
        where: { id, disabledAt: null },
        data: { disabledAt: new Date(), disabledByUserId: userId },
      });
      if (count === 0) return false;
      await transaction.auditLog.create({
        data: {
          userId,
          action: RULE_DISABLED_ACTION,
          entityType: "IncomingSupplierRule",
          entityId: id,
        },
      });
      return true;
    });
  }

  /** A szabály nevén elfogadott dokumentumok az utolsó napokból (a lap listája és a visszavonás). */
  async autoAcceptedSince(since: Date): Promise<AutoAcceptedRow[]> {
    const rows = await this.database.incomingSupplierDocument.findMany({
      where: { acceptedByRuleId: { not: null }, reviewedAt: { gte: since } },
      orderBy: { reviewedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        sender: true,
        receivedAt: true,
        reviewedAt: true,
        acceptedByRuleId: true,
        textReading: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      sender: row.sender,
      receivedAt: row.receivedAt,
      acceptedAt: row.reviewedAt!,
      ruleId: row.acceptedByRuleId!,
      textReading: row.textReading,
    }));
  }

  /**
   * A SZABÁLY NEVÉN ELFOGADOTT DOKUMENTUM VISSZAVONÁSA: UNASSIGNED lesz újra, a begyűjtés sora UNMATCHED. Elutasítja (a
   * dokumentum nem változik), ha közben egy banki sorhoz kötötték, beszerzéshez csatolták vagy várható beérkezéshez
   * rendelték: ott a kötést kell előbb visszavonni.
   */
  async undoAccepted(
    id: string,
    userId: string,
  ): Promise<"UNDONE" | "NOT_FOUND" | "IN_USE"> {
    return this.database.$transaction(async (transaction) => {
      const document = await transaction.incomingSupplierDocument.findFirst({
        where: { id, acceptedByRuleId: { not: null }, reviewState: null },
        select: {
          fileName: true,
          acceptedByRuleId: true,
          purchaseInvoiceId: true,
          expectedArrivalId: true,
        },
      });
      if (!document) return "NOT_FOUND";
      const matched = await transaction.bankTransactionMatch.count({
        where: { documentId: id },
      });
      if (
        matched > 0 ||
        document.purchaseInvoiceId ||
        document.expectedArrivalId
      )
        return "IN_USE";
      const { count } = await transaction.incomingSupplierDocument.updateMany({
        where: { id, acceptedByRuleId: { not: null }, reviewState: null },
        data: {
          reviewState: UNASSIGNED,
          acceptedByRuleId: null,
          reviewedAt: null,
          reviewedByUserId: null,
        },
      });
      if (count === 0) return "NOT_FOUND";
      await transaction.invoiceCollectionItem.updateMany({
        where: { documentId: id, verdict: "STORED" },
        data: { verdict: "UNMATCHED" },
      });
      await transaction.auditLog.create({
        data: {
          userId,
          action: AUTO_UNDO_ACTION,
          entityType: "IncomingSupplierDocument",
          entityId: id,
          metadata: {
            ruleId: document.acceptedByRuleId,
            fileName: document.fileName,
          },
        },
      });
      return "UNDONE";
    });
  }

  /** A döntésre váró (UNASSIGNED vagy SUGGESTED) dokumentumok olvasata a szabály-egyeztetéshez; a tartalom nélkül. */
  async pendingForRules(): Promise<
    {
      id: string;
      fileName: string;
      sender: string | null;
      payeeCheck: string | null;
      textReading: Prisma.JsonValue;
    }[]
  > {
    return this.database.incomingSupplierDocument.findMany({
      where: { reviewState: { in: [UNASSIGNED, "SUGGESTED"] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fileName: true,
        sender: true,
        payeeCheck: true,
        textReading: true,
      },
    });
  }

  /** Egy döntésre váró dokumentum olvasata, vagy null, ha nem vár döntésre (a tartalom nélkül). */
  async pendingRow(id: string): Promise<{
    id: string;
    fileName: string;
    sender: string | null;
    payeeCheck: string | null;
    textReading: Prisma.JsonValue;
  } | null> {
    return this.database.incomingSupplierDocument.findFirst({
      where: { id, reviewState: { in: [UNASSIGNED, "SUGGESTED"] } },
      select: {
        id: true,
        fileName: true,
        sender: true,
        payeeCheck: true,
        textReading: true,
      },
    });
  }

  /** Egy dokumentum PDF-je a szöveg olvasásához (a név-kulcs és az egyeztetés). */
  async content(id: string): Promise<Uint8Array | null> {
    const row = await this.database.incomingSupplierDocument.findFirst({
      where: { id },
      select: { content: true },
    });
    return row?.content ?? null;
  }
}

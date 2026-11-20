import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type {
  AcceptWithRuleInput,
  AcceptWithRuleResult,
  AuthenticatedUser,
  AutoAcceptUndoResult,
  AutoAcceptedView,
  SupplierRuleKind,
  SupplierRulePreview,
  SupplierRuleView,
} from "@acropora/types";

import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { normalizeName } from "../missing-invoice-matching.js";
import { payeeFromText } from "../payee-check.js";
import { invoiceCollectionSources } from "./invoice-collection.config.js";
import { INVOICE_COLLECTION_ENV } from "./invoice-collection.service.js";
import { InvoiceCollectionSuggestionsRepository } from "./invoice-collection-suggestions.repository.js";
import {
  decideSupplierRule,
  grossCentsOf,
  nameKeyOf,
  supplierRulesLive,
  raisedCeilings,
  strictSenderDomain,
  taxMatchKey,
  textHasNameKey,
  trustedForwarderDomains,
  type SupplierRule,
} from "./supplier-rule.js";
import {
  SupplierRulesRepository,
  type SupplierRuleRow,
} from "./supplier-rules.repository.js";

/** A szabály-létrehozás és az automatikus elfogadás visszavonásának napja a lapon. */
export const AUTO_ACCEPTED_DAYS = 14;

const reading = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Egy döntésre váró dokumentum a szabály-egyeztetéshez: a kiolvasott mezők és a PDF szövege. */
interface PendingDocument {
  id: string;
  taxNumber: string | null;
  senderDomain: string | null;
  text: string;
  gross: string | null;
  currency: string | null;
  payee: string;
}

const toView = (row: SupplierRuleRow): SupplierRuleView => ({
  id: row.id,
  kind: row.kind,
  label: row.label,
  key: row.taxKey ?? row.nameKey ?? "",
  senderDomain: row.senderDomain,
  grossCeilings: { ...row.grossCeilings },
  acceptedCount: row.acceptedCount,
  createdAt: row.createdAt.toISOString(),
  disabledAt: row.disabledAt?.toISOString() ?? null,
});

/**
 * AZ ISMERT SZÁLLÍTÓ SZABÁLYAINAK KEZELÉSE A LAPRÓL (PDF-javaslatok 2. útja; `supplier-rule.ts`): egy döntésre váró PDF elfogadása
 * szabály-létrehozással, a szabályok listája és kikapcsolása, az automatikusan elfogadottak listája és visszavonása.
 */
@Injectable()
export class SupplierRulesService {
  constructor(
    private readonly rules: SupplierRulesRepository,
    private readonly suggestions: InvoiceCollectionSuggestionsRepository,
    @Optional()
    @Inject(INVOICE_COLLECTION_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private trustedDomains(): string[] {
    return trustedForwarderDomains(
      invoiceCollectionSources(this.environment).flatMap((source) =>
        "user" in source ? [source.user] : [],
      ),
      this.environment,
    );
  }

  /** A döntésre váró dokumentumok olvasata és szövege. A tartalom egyenként töltődik (a lista tartalom nélkül jön). */
  private async pending(): Promise<PendingDocument[]> {
    const rows = await this.rules.pendingForRules();
    const out: PendingDocument[] = [];
    for (const row of rows) {
      const content = await this.rules.content(row.id);
      let text = "";
      if (content) {
        try {
          text = (await pdfTextLines(content)).join("\n");
        } catch {
          // olvashatatlan PDF: szöveg nélkül marad, a név-kulcs nem illeszkedik rá
        }
      }
      const r = reading(row.textReading);
      out.push({
        id: row.id,
        taxNumber: str(r.supplierTaxNumber),
        senderDomain: strictSenderDomain(row.sender),
        text,
        gross:
          str(r.gross) ??
          (typeof r.gross === "number" ? String(r.gross) : null),
        currency: str(r.currency),
        payee: row.payeeCheck ?? payeeFromText(text),
      });
    }
    return out;
  }

  private decide(rule: SupplierRule, document: PendingDocument) {
    return decideSupplierRule({
      rules: [rule],
      document,
      trustedDomains: this.trustedDomains(),
      normalizeName,
      // a már függő PDF-ek köteges elfogadásánál (ember erősíti meg) csak az olvasható összegű dönthető el; az összeg nélküliek
      // emberre maradnak akkor is, ha a futásban az összeg nélküli elfogadás engedélyezett
      amountless: false,
    });
  }

  /** A szabály ELŐNÉZETE egy döntésre váró PDF-re: mi a kulcs, ki a feladó, hány másik PDF fogadódna el. */
  async preview(id: string, vendorName?: string): Promise<SupplierRulePreview> {
    const documents = await this.pending();
    const own = documents.find((d) => d.id === id);
    if (!own)
      throw new NotFoundException("Nincs ilyen döntésre váró javaslat.");
    const trusted = this.trustedDomains();
    const external =
      own.senderDomain !== null && !trusted.includes(own.senderDomain);
    const taxKey = taxMatchKey(own.taxNumber);
    const sameSender = documents.filter(
      (d) => d.senderDomain !== null && d.senderDomain === own.senderDomain,
    );
    const taxKeys = new Set(
      sameSender.flatMap((d) => {
        const key = taxMatchKey(d.taxNumber);
        return key ? [key] : [];
      }),
    );
    const ceilings = raisedCeilings(
      {},
      own.currency,
      Math.abs(grossCentsOf(own.gross) ?? 0) || null,
    );
    const count = (kind: SupplierRuleKind): number => {
      const rule = this.hypotheticalRule(
        kind,
        own,
        taxKey,
        vendorName,
        ceilings,
        external,
      );
      if (!rule) return 0;
      return documents.filter((d) => d.id !== id && this.decide(rule, d).accept)
        .length;
    };
    return {
      documentId: id,
      taxKey,
      externalSender: external,
      senderDomain: own.senderDomain,
      taxLooksUnstable: external && taxKeys.size >= 2,
      pendingCount: { TAX: count("TAX"), NAME: count("NAME") },
      canCreate: {
        TAX: taxKey !== null && own.senderDomain !== null,
        NAME: external,
      },
    };
  }

  private hypotheticalRule(
    kind: SupplierRuleKind,
    own: PendingDocument,
    taxKey: string | null,
    vendorName: string | undefined,
    ceilings: Record<string, number>,
    external: boolean,
  ): SupplierRule | null {
    if (kind === "TAX") {
      if (!taxKey) return null;
      return {
        id: "preview",
        kind,
        taxKey,
        nameKey: null,
        senderDomain: external ? own.senderDomain : null,
        grossCeilings: ceilings,
      };
    }
    const nameKey = vendorName ? nameKeyOf(vendorName, normalizeName) : null;
    if (
      !nameKey ||
      !external ||
      !textHasNameKey(own.text, nameKey, normalizeName)
    )
      return null;
    return {
      id: "preview",
      kind,
      taxKey: null,
      nameKey,
      senderDomain: own.senderDomain,
      grossCeilings: ceilings,
    };
  }

  /**
   * ELFOGADÁS ÉS SZABÁLY: a PDF-et az ember elfogadja (mint eddig), és a szállítóból szabály lesz; ha kéri, a többi, a szabály alá
   * eső függő PDF-et is elfogadja (az ember megerősítésével, a naplóban az ő neve áll). A szabály érvényességét az elfogadás ELŐTT
   * ellenőrzi: egy hibás kérés nem fogad el semmit.
   */
  async acceptWithRule(
    id: string,
    input: AcceptWithRuleInput,
    user: AuthenticatedUser,
  ): Promise<AcceptWithRuleResult> {
    // a kikapcsolt szolgáltatás ugyanazt mondja, amit a rejtett felület (nautilus 58009): szabály nem vehető fel
    if (!supplierRulesLive(this.environment))
      throw new ConflictException("A szállítói szabályok ki vannak kapcsolva.");
    const documents = await this.pending();
    const own = documents.find((d) => d.id === id);
    if (!own)
      throw new NotFoundException("Nincs ilyen döntésre váró javaslat.");
    const external =
      own.senderDomain !== null &&
      !this.trustedDomains().includes(own.senderDomain);
    const cents = grossCentsOf(own.gross);
    const ceilings = raisedCeilings(
      {},
      own.currency,
      cents === null ? null : Math.abs(cents),
    );
    const taxKey = taxMatchKey(own.taxNumber);
    const vendorName = input.vendorName?.trim() || undefined;
    let draft: SupplierRule & { label: string };
    if (input.kind === "TAX") {
      if (!taxKey)
        throw new BadRequestException(
          "Ebben a PDF-ben nincs olvasható adószám: név alapú szabályt adj meg.",
        );
      if (own.senderDomain === null)
        throw new BadRequestException(
          "A feladó ismeretlen: a szabályhoz feladó kell (a levél feladójának tartománya).",
        );
      draft = {
        id: "",
        kind: "TAX",
        taxKey,
        nameKey: null,
        // a saját továbbítónk megbízott csatorna: a szabály ilyenkor nem köti a feladóhoz
        senderDomain: external ? own.senderDomain : null,
        grossCeilings: ceilings,
        label: vendorName ?? own.taxNumber ?? taxKey,
      };
    } else {
      if (!vendorName)
        throw new BadRequestException(
          "A név alapú szabályhoz a szállító neve kell.",
        );
      const nameKey = nameKeyOf(vendorName, normalizeName);
      if (!nameKey)
        throw new BadRequestException(
          "A névből nem képezhető azonosító szó (legalább három betűs, nem általános szó kell).",
        );
      if (!textHasNameKey(own.text, nameKey, normalizeName))
        throw new BadRequestException(
          "A megadott név nem szerepel a PDF szövegében: a szabályhoz a PDF-en álló nevet írd be.",
        );
      if (!external)
        throw new BadRequestException(
          "Név alapú szabály csak külső feladóval él: a saját továbbítónktól érkező PDF-hez adószám kell.",
        );
      draft = {
        id: "",
        kind: "NAME",
        taxKey: null,
        nameKey,
        senderDomain: own.senderDomain,
        grossCeilings: ceilings,
        label: vendorName,
      };
    }
    if (!(await this.suggestions.accept(id, user.id)))
      throw new ConflictException(
        "Erről a javaslatról már döntöttek, vagy nem létezik.",
      );
    const created = await this.rules.create({
      kind: draft.kind,
      taxKey: draft.taxKey,
      nameKey: draft.nameKey,
      senderDomain: draft.senderDomain,
      label: draft.label,
      grossCeilings: draft.grossCeilings,
      sourceDocumentId: id,
      userId: user.id,
    });
    let alsoAccepted = 0;
    if (input.alsoPending) {
      const rule: SupplierRule = { ...draft, id: created.id };
      for (const other of documents) {
        if (other.id === id) continue;
        const decision = this.decide(rule, other);
        if (!decision.accept) continue;
        if (!(await this.suggestions.accept(other.id, user.id))) continue;
        await this.rules.recordAccepted({
          ruleId: created.id,
          documentId: other.id,
          grossCents: decision.grossCents,
          currency: decision.currency,
          userId: user.id,
          signals: { via: "rule-created", sourceDocumentId: id },
        });
        alsoAccepted += 1;
      }
    }
    return { ruleId: created.id, created: created.created, alsoAccepted };
  }

  async list(): Promise<SupplierRuleView[]> {
    return (await this.rules.list()).map(toView);
  }

  async disable(ruleId: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.rules.disable(ruleId, user.id)))
      throw new ConflictException(
        "A szabály már ki van kapcsolva, vagy nem létezik.",
      );
  }

  async autoAccepted(now: Date = new Date()): Promise<AutoAcceptedView[]> {
    const since = new Date(
      now.getTime() - AUTO_ACCEPTED_DAYS * 24 * 60 * 60 * 1000,
    );
    return (await this.rules.autoAcceptedSince(since)).map((row) => {
      const r = reading(row.textReading);
      return {
        documentId: row.id,
        fileName: row.fileName,
        sender: row.sender,
        receivedAt: row.receivedAt?.toISOString() ?? null,
        acceptedAt: row.acceptedAt.toISOString(),
        ruleId: row.ruleId,
        invoiceNumber: str(r.invoiceNumber),
        gross: str(r.gross),
        currency: str(r.currency),
      };
    });
  }

  async undo(
    id: string,
    user: AuthenticatedUser,
  ): Promise<AutoAcceptUndoResult> {
    const result = await this.rules.undoAccepted(id, user.id);
    if (result === "NOT_FOUND")
      throw new NotFoundException(
        "Nincs ilyen automatikusan elfogadott dokumentum (vagy már visszavonták).",
      );
    return result === "IN_USE" ? "IN_USE" : "UNDONE";
  }
}

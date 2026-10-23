import type {
  AuthenticatedUser,
  InvoiceCollectionSuggestion,
  InvoiceCollectionSuggestionsResponse,
} from "@acropora/types";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  InvoiceCollectionSuggestionsRepository,
  type SuggestionRow,
} from "./invoice-collection-suggestions.repository.js";

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * A DÖNTÉS NÉLKÜL MARADT `UNASSIGNED` FÁJL FIGYELMEZTETÉSI HATÁRA (acrobot 35565,
 * 2026-10-23): ennyi nap után a lista jelzi, és a napi számla-ellenőrzés a darabszámot
 * kapja. AUTOMATIKUS TÖRLÉS NINCS: egy hozzárendeletlen szállítói számla törlése
 * könyvelési adatot vinne el. Csak az elvetés töröl (azonnal, a tartalmat).
 */
export const UNASSIGNED_STALE_AFTER_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Egy javasolt dokumentum a lista sorává: az olvasó mezői, ha voltak. */
export function toSuggestion(
  row: SuggestionRow,
  now: Date = new Date(),
): InvoiceCollectionSuggestion {
  const reading =
    row.textReading && typeof row.textReading === "object"
      ? (row.textReading as Record<string, unknown>)
      : {};
  const gross = reading.gross;
  return {
    documentId: row.id,
    state: row.reviewState === "UNASSIGNED" ? "UNASSIGNED" : "SUGGESTED",
    stale:
      row.reviewState === "UNASSIGNED" &&
      now.getTime() - row.createdAt.getTime() >
        UNASSIGNED_STALE_AFTER_DAYS * DAY_MS,
    fileName: row.fileName,
    sender: row.sender,
    subject: row.subject,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    confidence:
      row.suggestionConfidence === null
        ? null
        : Math.round(Number(row.suggestionConfidence) * 100) / 100,
    decisionRunId: row.suggestionDecisionRunId,
    invoiceNumber: text(reading.invoiceNumber),
    supplierName: text(reading.supplierName),
    gross:
      typeof gross === "string" || typeof gross === "number"
        ? String(gross)
        : null,
    currency: text(reading.currency),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A JEV JAVASLATAINAK JÓVÁHAGYÁSA (levél-válogatás terv, 4. szelet; acrobot
 * 25803). Balázs keretdöntése: a Jev csak javasol, ember hagyja jóvá. Egy
 * javaslat addig nem jelölt a Hiányzó számlák között; elfogadva jelölt lesz,
 * elvetve a dokumentum törlődik.
 */
@Injectable()
export class InvoiceCollectionSuggestionsService {
  constructor(
    private readonly repository: InvoiceCollectionSuggestionsRepository,
  ) {}

  async list(
    now: Date = new Date(),
  ): Promise<InvoiceCollectionSuggestionsResponse> {
    const items = (await this.repository.list()).map((row) =>
      toSuggestion(row, now),
    );
    return {
      items,
      staleAfterDays: UNASSIGNED_STALE_AFTER_DAYS,
      staleCount: items.filter((item) => item.stale).length,
    };
  }

  async file(id: string): Promise<{ fileName: string; content: Uint8Array }> {
    const file = await this.repository.file(id);
    if (!file)
      throw new NotFoundException("Nincs ilyen döntésre váró javaslat.");
    return file;
  }

  async accept(id: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.repository.accept(id, user.id)))
      throw new ConflictException(
        "Erről a javaslatról már döntöttek, vagy nem létezik.",
      );
  }

  async reject(id: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.repository.reject(id, user.id)))
      throw new ConflictException(
        "Erről a javaslatról már döntöttek, vagy nem létezik.",
      );
  }
}

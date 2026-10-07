import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
  type CreateQuoteFromTemplateInput,
  type UpdateQuoteInput,
  type QuoteListResponse,
} from "@acropora/types";
import { quoteDto, quoteListItemDto } from "./quote-dto.mapper.js";
import { templateInput } from "./quote-editor-input.js";
import { QuotesRepository, QuoteWriteConflict } from "./quotes.repository.js";
function permission(user: AuthenticatedUser, manage = false) {
  if (
    !hasPermission(
      user,
      manage ? PERMISSIONS.QUOTES_MANAGE : PERMISSIONS.QUOTES_VIEW,
    )
  )
    throw new ForbiddenException("Nincs jogosultságod az ajánlatokhoz.");
}
function header(input: UpdateQuoteInput): UpdateQuoteInput {
  const output: UpdateQuoteInput = {};
  if (input.title !== undefined) {
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.trim().length > 200
    )
      throw new BadRequestException("Érvénytelen megnevezés.");
    output.title = input.title.trim();
  }
  for (const key of ["customerId", "ownerUserId"] as const)
    if (input[key] !== undefined) {
      const v = input[key];
      if (v !== null && (typeof v !== "string" || !v.trim() || v.length > 100))
        throw new BadRequestException("Érvénytelen hivatkozás.");
      output[key] = v;
    }
  return output;
}
function writeError(e: unknown): never {
  if (e instanceof QuoteWriteConflict)
    throw new ConflictException(
      "P0-ban csak publikálás előtti DRAFT ajánlat fej-adatai módosíthatók.",
    );
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")
    throw new BadRequestException(
      "A megadott ügyfél vagy felelős nem létezik.",
    );
  throw e;
}
@Injectable()
export class QuotesService {
  constructor(private readonly repository: QuotesRepository) {}
  async list(
    user: AuthenticatedUser,
    page: number,
    pageSize: number,
    q?: string,
  ): Promise<QuoteListResponse> {
    permission(user);
    const result = await this.repository.list(page, pageSize, q);
    const totals = await this.repository.netTotals(
      result.items.flatMap((row) => row.versions.map((v) => v.id)),
    );
    return {
      ...result,
      items: result.items.map((row) => quoteListItemDto(row, totals)),
      page,
      pageSize,
    };
  }
  async get(id: string, user: AuthenticatedUser) {
    permission(user);
    const row = await this.repository.find(id);
    if (!row) throw new NotFoundException("Az ajánlat nem található.");
    return quoteDto(row, user);
  }
  async create(input: CreateQuoteFromTemplateInput, user: AuthenticatedUser) {
    permission(user, true);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil) ||
      !Number.isFinite(new Date(`${input.validUntil}T00:00:00Z`).getTime()) ||
      new Date(`${input.validUntil}T00:00:00Z`).toISOString().slice(0, 10) !==
        input.validUntil
    )
      throw new BadRequestException("Érvénytelen érvényességi dátum.");
    const clean = header(input);
    if (!clean.title) throw new BadRequestException("A megnevezés kötelező.");
    // P1 decision 1: "new quote from a template" is a picker, not a template editor
    let template:
      | ({ id: string; priceDisplay: string } & ReturnType<
          typeof templateInput
        >)
      | undefined;
    if (input.templateId) {
      const row = await this.repository.template(input.templateId);
      if (!row || row.archivedAt)
        throw new BadRequestException("A sablon nem található vagy archivált.");
      if (!["NET", "GROSS", "BOTH"].includes(row.priceDisplay))
        throw new BadRequestException("A sablon ár-megjelenítése hibás.");
      template = {
        id: row.id,
        priceDisplay: row.priceDisplay,
        ...templateInput(row),
      };
    }
    try {
      return quoteListItemDto(
        await this.repository.create(
          {
            ...clean,
            title: clean.title,
            validUntil: input.validUntil,
            currency: input.currency,
            priceDisplay:
              input.priceDisplay ??
              (template?.priceDisplay as CreateQuoteFromTemplateInput["priceDisplay"]),
          },
          user.id,
          template,
        ),
      );
    } catch (e) {
      writeError(e);
    }
  }
  async update(id: string, input: UpdateQuoteInput, user: AuthenticatedUser) {
    permission(user, true);
    const clean = header(input);
    if (!Object.keys(clean).length)
      throw new BadRequestException("Legalább egy fej-adat szükséges.");
    try {
      const row = await this.repository.update(id, clean, user.id);
      if (!row) throw new NotFoundException("Az ajánlat nem található.");
      return quoteListItemDto(
        row,
        await this.repository.netTotals(row.versions.map((v) => v.id)),
      );
    } catch (e) {
      writeError(e);
    }
  }
}

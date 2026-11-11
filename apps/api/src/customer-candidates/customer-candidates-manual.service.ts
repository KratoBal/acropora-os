import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  analyzeManualList,
  applyManualList,
  type ManualListAnalysis,
} from "./customer-candidates-manual.import.js";
import { PrismaManualListStore } from "./customer-candidates-manual.repository.js";
import { ManualListError } from "./customer-candidates-manual.rules.js";
import type { ManualPlan } from "./customer-candidates-manual.rules.js";

/** A hand-made list is short: refused before anything is read from the catalogue (the default 100 kB body limit holds about this many rows anyway). */
export const MANUAL_LIST_MAX_ROWS = 250;
const APPROVED_BY_MAX = 200;

export interface ManualListReport {
  rows: number;
  rejected: { row: number; sku: string | null; reason: string }[];
  warnings: string[];
  plan: ManualPlan;
  pending: number;
  shopText: number;
  /** What the apply must carry back: it covers the file, the SKU resolution AND the table's current rows. */
  fingerprint: string;
  /** False while any row is rejected: the apply will not start. */
  canApply: boolean;
}

export interface ManualListApplyResult {
  stored: number;
  removed: number;
  fingerprint: string;
}

/**
 * THE MANUAL PRODUCT LIST OVER HTTP (V3.4 S2c-3; acrobot 47348: the test machine's gate lets no container command through, so the import
 * gets an admin endpoint with the same two steps as the command). BOTH WAYS CALL THE SAME FUNCTIONS (`analyzeManualList`,
 * `applyManualList`): the checks are not written twice.
 *
 *  1. DRY RUN: reads the catalogue and the table, writes NOTHING, returns the report and the fingerprint.
 *  2. APPLY: needs the fingerprint of the dry run on the SAME rows, a named approver, and refuses on any rejected row. It writes the
 *     whole list in one transaction with an audit row (who, the approver's text, the fingerprint, the plan).
 */
@Injectable()
export class ManualListService {
  constructor(private readonly store: PrismaManualListStore) {}

  async dryRun(body: unknown): Promise<ManualListReport> {
    return toReport(await this.analyze(body));
  }

  async apply(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ManualListApplyResult> {
    const input = (
      body !== null && typeof body === "object" ? body : {}
    ) as Record<string, unknown>;
    if (typeof input.approvedBy !== "string" || input.approvedBy.trim() === "")
      throw new BadRequestException(
        "Az alkalmazáshoz jóváhagyó szöveg kell (ki hagyta jóvá, és hol).",
      );
    if (input.approvedBy.length > APPROVED_BY_MAX)
      throw new BadRequestException(
        `A jóváhagyó szöveg legfeljebb ${APPROVED_BY_MAX} karakter.`,
      );
    if (typeof input.fingerprint !== "string" || input.fingerprint === "")
      throw new BadRequestException(
        "Az alkalmazáshoz a próbafutás lenyomata kell.",
      );
    const analysis = await this.analyze(body);
    const result = await applyManualList(
      analysis,
      {
        approvedBy: input.approvedBy,
        fingerprint: input.fingerprint,
        allowEmpty: input.allowEmpty === true,
        auditUserId: user.id,
        source: "http",
      },
      this.store,
      new Date(),
    );
    if (!result.ok) {
      if (result.refusal === "FINGERPRINT_MISMATCH")
        throw new ConflictException(
          "A lenyomat nem egyezik a mostani listával, katalógussal és táblával: futtass új próbát, és annak a lenyomatával küldd az alkalmazást.",
        );
      if (result.refusal === "REJECTED_ROWS")
        throw new BadRequestException(
          "Van elutasított sor: az alkalmazás nem indul. A próbafutás jelentése megnevezi a sorokat.",
        );
      if (result.refusal === "EMPTY_NEEDS_ALLOW_EMPTY")
        throw new BadRequestException(
          "A lista üres: az alkalmazás a TELJES listát törölné. Ha ez a szándék, küldd el az allowEmpty: true mezőt is.",
        );
      throw new BadRequestException("Az alkalmazás nem indítható.");
    }
    return {
      stored: result.stored,
      removed: result.removed,
      fingerprint: analysis.fingerprint,
    };
  }

  private async analyze(body: unknown): Promise<ManualListAnalysis> {
    const rows =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>).rows
        : undefined;
    if (!Array.isArray(rows))
      throw new BadRequestException("A rows mező a sorok tömbje.");
    if (rows.length > MANUAL_LIST_MAX_ROWS)
      throw new BadRequestException(
        `A lista legfeljebb ${MANUAL_LIST_MAX_ROWS} sor.`,
      );
    try {
      return await analyzeManualList(rows, this.store);
    } catch (error) {
      if (error instanceof ManualListError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

function toReport(analysis: ManualListAnalysis): ManualListReport {
  return {
    rows: analysis.rows.length,
    rejected: [...analysis.problems]
      .sort((a, b) => a.row - b.row)
      .map((problem) => ({
        row: problem.row,
        sku: problem.sku,
        reason: problem.reason,
      })),
    warnings: analysis.warnings,
    plan: analysis.plan,
    pending: analysis.pending,
    shopText: analysis.shopText,
    fingerprint: analysis.fingerprint,
    canApply: analysis.problems.length === 0,
  };
}

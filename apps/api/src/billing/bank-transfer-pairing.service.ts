import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import {
  BANK_TRANSFER_REFUSAL_TEXT,
  type AuthenticatedUser,
  type BankTransferCreditView,
  type BankTransferDecisionView,
  type BankTransferPairResult,
} from "@acropora/types";

import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import {
  applyPaidMarks,
  prismaPaymentMarkStore,
  type PaymentMarkStore,
} from "../integrations/szamlazz/outgoing-payment-marks.js";
import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPaymentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { StubSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";
import {
  decideBankTransfer,
  loadBankCredit,
  loadBankTransfers,
  loadFeedInvoicesFor,
  type BankTransferDecision,
} from "./bank-transfer-paid-marks.js";
import { billingIssueMode } from "./billing-issue.config.js";

export const BANK_TRANSFER_STORE = Symbol("BANK_TRANSFER_STORE");
export const BANK_TRANSFER_CLIENT = Symbol("BANK_TRANSFER_CLIENT");
export const BANK_TRANSFER_ENV = Symbol("BANK_TRANSFER_ENV");

/** The page's view of a decision: the marks, or the refusal in a sentence. */
export function decisionView(
  decision: BankTransferDecision,
): BankTransferDecisionView {
  return decision.markable
    ? {
        markable: true,
        marks: decision.marks.map((m) => ({
          invoiceNumber: m.invoiceNumber,
          amount: m.amount,
        })),
        paidBefore: decision.paidBefore,
      }
    : {
        markable: false,
        refusal: decision.refusal,
        reason: BANK_TRANSFER_REFUSAL_TEXT[decision.refusal],
        detail: decision.detail,
      };
}

/** The credits' written BANK_TRANSFER marks, and the pairing's audit row. */
@Injectable()
export class BankTransferPairingRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async writtenFor(
    creditIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    if (creditIds.length === 0) return new Map();
    const rows = await this.database.outgoingPaymentMark.findMany({
      where: {
        source: "BANK_TRANSFER",
        state: "WRITTEN",
        sourceRef: { in: [...creditIds] },
      },
      orderBy: [{ invoiceNumber: "asc" }],
      select: { sourceRef: true, invoiceNumber: true },
    });
    const out = new Map<string, string[]>();
    for (const row of rows)
      out.set(row.sourceRef, [
        ...(out.get(row.sourceRef) ?? []),
        row.invoiceNumber,
      ]);
    return out;
  }

  /** The pairing's audit row, before the write, in the credit lock's transaction; its id. */
  async record(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      creditId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<string> {
    const row = await transaction.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.bank-transfer.paired",
        entityType: "BankTransaction",
        entityId: input.creditId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** The writer's outcomes onto the same row. */
  async complete(
    transaction: Prisma.TransactionClient,
    auditId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await transaction.auditLog.update({
      where: { id: auditId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
  }
}

/**
 * THE BANKI ÁTUTALÁSOK PAGE (card aeddb2c3, slice 3; acrobot 42868, 42879): the credits that name, or could name, our
 * invoices; a person types the invoice numbers for one that did not pair by itself, checks, and closes it. The write
 * is decided again here, by the same rule as the daily run (one customer, the exact amount), and goes the shared way.
 */
@Injectable()
export class BankTransferPairingService {
  constructor(
    private readonly credentials: SzamlazzCredentialProvider,
    private readonly repository: BankTransferPairingRepository,
    @Optional()
    @Inject(BANK_TRANSFER_STORE)
    private readonly store: PaymentMarkStore = prismaPaymentMarkStore,
    @Optional()
    @Inject(BANK_TRANSFER_CLIENT)
    private readonly client: SzamlazzAgentPaymentClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(BANK_TRANSFER_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /** The credits since `from`; without `all`, only those whose text names one of ours or that wrote a mark. */
  async list(from: string, all = false): Promise<BankTransferCreditView[]> {
    const { credits, invoices } = await loadBankTransfers(from);
    const written = await this.repository.writtenFor(credits.map((c) => c.id));
    return credits
      .map((credit) => ({
        credit,
        decision: decideBankTransfer(credit, invoices),
        written: written.get(credit.id) ?? [],
      }))
      .filter(
        ({ decision, written: marks }) =>
          all ||
          marks.length > 0 ||
          decision.markable ||
          decision.refusal !== "NO_REFERENCE",
      )
      .reverse()
      .map(({ credit, decision, written: marks }) => ({
        id: credit.id,
        day: credit.valueDate ?? credit.bookingDate,
        amount: credit.amount,
        currency: credit.currency,
        narrative: credit.narrative,
        counterpartyName: credit.counterpartyName,
        decision: decisionView(decision),
        written: marks,
      }));
  }

  /** What the typed invoice numbers decide against the credit; nothing is written. */
  async check(
    creditId: string,
    text: string,
  ): Promise<BankTransferDecisionView> {
    return decisionView(await this.decide(creditId, text));
  }

  async pair(
    creditId: string,
    text: string,
    user: AuthenticatedUser,
  ): Promise<BankTransferPairResult> {
    const mode = billingIssueMode(this.environment);
    if (mode === "off" || mode === "conflict")
      throw new ServiceUnavailableException(
        mode === "off"
          ? "A Számlázz.hu-ba írás ezen a szerveren ki van kapcsolva."
          : "A Számlázz.hu-ba írás beállítása ellentmondásos ezen a szerveren.",
      );
    let agentKey = "stub";
    if (mode === "live")
      try {
        agentKey = (await this.credentials.resolve()).agentKey;
      } catch {
        throw new ServiceUnavailableException(
          "Nincs Számlázz.hu-kulcs beállítva, a kifizetés nem rögzíthető.",
        );
      }
    /*
      ONE PAIRING OF A CREDIT AT A TIME (barracuda, #2192): the decision reads the credit's standing marks, so two
      people pairing the same credit to two invoice sets at once must not both pass it. The credit's lock is held
      from the decision to the end of the writes; the audit row is written BEFORE the write, so no write is left
      without its row (#2192 b).
    */
    return prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bank-credit:${creditId}`}))`;
        const decision = await this.decide(creditId, text);
        if (!decision.markable)
          throw new ConflictException(
            `${BANK_TRANSFER_REFUSAL_TEXT[decision.refusal]}${decision.detail ? ` (${decision.detail})` : ""}`,
          );
        const auditId = await this.repository.record(transaction, {
          userId: user.id,
          creditId,
          metadata: {
            text,
            mode,
            decided: decision.marks.map((m) => [m.invoiceNumber, m.amount]),
          },
        });
        const lines = await applyPaidMarks({
          source: "BANK_TRANSFER",
          marks: decision.marks,
          approved: new Set(decision.marks.map((m) => m.invoiceNumber)),
          agentKey,
          client: mode === "stub" ? new StubSzamlazzAgentClient() : this.client,
          store: this.store,
        });
        const result = {
          lines: lines.map((line) => ({
            invoiceNumber: line.invoiceNumber,
            outcome: line.outcome.kind,
          })),
        };
        await this.repository.complete(transaction, auditId, {
          text,
          mode,
          lines: result.lines,
        });
        return result;
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
  }

  private async decide(
    creditId: string,
    text: string,
  ): Promise<BankTransferDecision> {
    const credit = await loadBankCredit(creditId);
    if (!credit) throw new NotFoundException("Nincs ilyen banki jóváírás.");
    return decideBankTransfer(
      { ...credit, narrative: text },
      await loadFeedInvoicesFor([text]),
    );
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  BadGatewayException,
} from "@nestjs/common";
import { Repository, prisma, Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import {
  applyPaidMarks,
  prismaPaymentMarkStore,
  type PaymentMarkOutcome,
  type PaymentMarkStore,
} from "../integrations/szamlazz/outgoing-payment-marks.js";
import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPaymentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { StubSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { budapestDayKey } from "../dashboard/budapest-day.js";
import { billingIssueMode } from "./billing-issue.config.js";

/**
 * KÉZI KIFIZETÉS-RÖGZÍTÉS EGY KIMENŐ SZÁMLÁRA (kártya 2026/00083-86; Balázs, 2026-11-04
 * 16:40 UTC: „a saját felületünkön nem tudom kifizetettre állítani”; acrobot 42564: B
 * változat).
 *
 * A kimenő számla kifizetettségének EGY igazsága a Számlázz.hu: az OS onnan olvassa
 * (a feed). Ezért a kézi rögzítés nem az OS-ben jelöl, hanem a meglévő közös úton
 * (`applyPaidMarks`) a Számlázz.hu-ba írja a kifizetést (`action-szamla_agent_kifiz`),
 * a saját forrásával (`MANUAL`), naplózva (`OutgoingPaymentMark` és auditnapló), és csak
 * bizonyíthatóan nyitott vagy részben fizetett számlára, legfeljebb a nyitott összegig.
 * A kérés azonosítója (`requestId`) a napló kulcsa: egy dupla kattintás vagy egy
 * újraküldés nem lesz két kifizetés.
 *
 * VISSZAVONÁS: a Számlázz.hu API-n egy kifizetés nem vonható vissza egyenként (csak az
 * összes kifizetés felülírásával), ezért a hibás rögzítést a Számlázz.hu felületén kell
 * törölni. Ezt a felület a gomb mellett kimondja.
 *
 * A KAPCSOLÓ a kiállításé (`billingIssueMode`): élesen a valódi Számlázz.hu, a teszt-
 * szerveren az álszámlázó (nem ír sehova), kikapcsolva elutasít hívás nélkül.
 */
export const MANUAL_PAYMENT_STORE = Symbol("MANUAL_PAYMENT_STORE");
export const MANUAL_PAYMENT_CLIENT = Symbol("MANUAL_PAYMENT_CLIENT");
export const MANUAL_PAYMENT_ENV = Symbol("MANUAL_PAYMENT_ENV");

export interface ManualPaymentInput {
  invoiceNumber: string;
  /** ÉÉÉÉ-HH-NN */
  date: string;
  /** decimális szöveg, legfeljebb két tizedes */
  amount: string;
  note?: string;
  /** a kérés azonosítója (UUID), a felület egy űrlap-megnyitásra egyet ad */
  requestId: string;
}

export interface ManualPaymentResult {
  state: "WRITTEN" | "ALREADY_RECORDED";
  /** a Számlázz.hu szerinti kintlévőség a rögzítés után, ha megadta */
  outstanding: number | null;
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,12}(?:[.,]\d{1,2})?$/;

/** A bemenet ellenőrzése; az első hiba szövege, vagy `null`. */
export function manualPaymentProblem(
  input: ManualPaymentInput,
  now: Date,
): string | null {
  if (!input.invoiceNumber.trim()) return "A számlaszám kötelező.";
  if (
    !DATE.test(input.date) ||
    Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))
  )
    return "A kifizetés dátuma ÉÉÉÉ-HH-NN alakú legyen.";
  if (input.date > budapestDayKey(now))
    return "A kifizetés dátuma nem lehet a mai napnál későbbi.";
  if (!AMOUNT.test(input.amount.trim()))
    return "Az összeg pozitív szám legyen, legfeljebb két tizedessel.";
  if (!new Prisma.Decimal(input.amount.trim().replace(",", ".")).greaterThan(0))
    return "Az összeg pozitív szám legyen, legfeljebb két tizedessel.";
  if ((input.note ?? "").length > 200)
    return "A megjegyzés legfeljebb 200 karakter.";
  return null;
}

/** Az auditnapló sora; a teszt kicseréli. */
@Injectable()
export class ManualPaymentAuditRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async record(input: {
    userId: string;
    invoiceNumber: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.database.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.outgoing-payment.recorded",
        entityType: "OutgoingInvoice",
        entityId: input.invoiceNumber,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
}

/** egy függő (PLANNED vagy UNKNOWN) saját jelölés, ahogy a felület mutatja */
export interface PendingPaymentMark {
  id: string;
  source: string;
  state: "PLANNED" | "UNKNOWN";
  /** ÉÉÉÉ-HH-NN */
  date: string;
  amount: string;
  createdAt: string;
  responseMessage: string | null;
}

/**
 * A FÜGGŐ JELÖLÉSEK ÉS A LEZÁRÁSUK (barracuda, #2168 review): egy folyamat-leállás után ott maradt PLANNED
 * vagy UNKNOWN jelölés a számla kézi rögzítését „bizonytalan”-ra állítja (helyesen: inkább álljon meg, mint
 * kétszer írjon). A kezelő a Számlázz.hu-n megnézi, és lezárja: bekerült (WRITTEN) vagy nem került be
 * (FAILED, újra rögzíthető). A lezárás auditnaplózott.
 */
@Injectable()
export class PendingPaymentMarkRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async pending(invoiceNumber: string): Promise<PendingPaymentMark[]> {
    const rows = await this.database.outgoingPaymentMark.findMany({
      where: { invoiceNumber, state: { in: ["PLANNED", "UNKNOWN"] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        source: true,
        state: true,
        markDate: true,
        amount: true,
        createdAt: true,
        responseMessage: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      state: row.state as "PLANNED" | "UNKNOWN",
      date: row.markDate.toISOString().slice(0, 10),
      amount: row.amount.toFixed(2),
      createdAt: row.createdAt.toISOString(),
      responseMessage: row.responseMessage,
    }));
  }

  /** `false`: a jelölés közben már nem függő (vagy nincs ilyen); csak függőt zár le. */
  async resolve(input: {
    id: string;
    outcome: "WRITTEN" | "FAILED";
    userId: string;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const row = await transaction.outgoingPaymentMark.findUnique({
        where: { id: input.id },
        select: { invoiceNumber: true, state: true, source: true },
      });
      const changed = await transaction.outgoingPaymentMark.updateMany({
        where: { id: input.id, state: { in: ["PLANNED", "UNKNOWN"] } },
        data: {
          state: input.outcome,
          responseMessage:
            input.outcome === "WRITTEN"
              ? "kézzel lezárva: a Számlázz.hu-n bekerült"
              : "kézzel lezárva: a Számlázz.hu-n nem került be",
        },
      });
      if (changed.count === 0 || !row) return false;
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: "billing.outgoing-payment.mark-resolved",
          entityType: "OutgoingInvoice",
          entityId: row.invoiceNumber,
          metadata: {
            markId: input.id,
            source: row.source,
            from: row.state,
            to: input.outcome,
          },
        },
      });
      return true;
    });
  }
}

function refusal(outcome: PaymentMarkOutcome): Error {
  switch (outcome.kind) {
    case "ALREADY_PAID":
      return new ConflictException(
        "A számla a Számlázz.hu szerint már ki van fizetve, nem rögzítettem újabb kifizetést.",
      );
    case "NOT_UNPAID":
      return outcome.state === "NOT_FOUND"
        ? new NotFoundException(
            "Ezt a számlaszámot a Számlázz.hu adatai között nem találom; csak a Számlázz.hu-ban kiállított számlára rögzíthető kifizetés.",
          )
        : new ConflictException(
            `A számla fizetési állapota (${outcome.state}) nem nyitott; ha a Számlázz.hu adata még nem érkezett meg, próbáld később.`,
          );
    case "OVER_OPEN":
      return new BadRequestException(
        `Az összeg több, mint a számla nyitott összege (${outcome.open}).`,
      );
    case "FAILED":
      return new BadGatewayException(
        `A Számlázz.hu elutasította a kifizetést${outcome.code ? ` (${outcome.code})` : ""}: ${outcome.message ?? "nincs részlet"}`,
      );
    case "UNKNOWN":
    case "UNCERTAIN_BEFORE":
      return new BadGatewayException(
        outcome.kind === "UNCERTAIN_BEFORE" &&
          outcome.state === "PENDING_ON_INVOICE"
          ? "Ezen a számlán egy korábbi kifizetés-írás bizonytalan állapotban áll. Nézd meg a számlát a Számlázz.hu felületén, és zárd le a függő jelölést a Kifizetés panelen; utána rögzíthető."
          : "A Számlázz.hu válasza bizonytalan: lehet, hogy a kifizetés rögzült. Mielőtt újra próbálod, nézd meg a számlát a Számlázz.hu felületén.",
      );
    default:
      return new BadGatewayException("Váratlan válasz a Számlázz.hu-tól.");
  }
}

@Injectable()
export class ManualOutgoingPaymentService {
  constructor(
    private readonly credentials: SzamlazzCredentialProvider,
    private readonly audit: ManualPaymentAuditRepository,
    @Optional()
    @Inject(MANUAL_PAYMENT_STORE)
    private readonly store: PaymentMarkStore = prismaPaymentMarkStore,
    @Optional()
    @Inject(MANUAL_PAYMENT_CLIENT)
    private readonly client: SzamlazzAgentPaymentClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(MANUAL_PAYMENT_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async record(
    input: ManualPaymentInput,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<ManualPaymentResult> {
    const problem = manualPaymentProblem(input, now);
    if (problem) throw new BadRequestException(problem);
    const mode = billingIssueMode(this.environment);
    if (mode === "off" || mode === "conflict")
      throw new ServiceUnavailableException(
        mode === "off"
          ? "A Számlázz.hu-ba írás ezen a szerveren ki van kapcsolva, a kifizetés nem rögzíthető."
          : "A Számlázz.hu-ba írás beállítása ellentmondásos ezen a szerveren, a kifizetés nem rögzíthető.",
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
    const invoiceNumber = input.invoiceNumber.trim();
    const amount = new Prisma.Decimal(
      input.amount.trim().replace(",", "."),
    ).toFixed(2);
    const [line] = await applyPaidMarks({
      source: "MANUAL",
      marks: [
        {
          invoiceNumber,
          date: input.date,
          amount,
          title: "átutalás",
          note:
            input.note?.trim() ||
            `Kézi rögzítés az OS-ben (${user.displayName})`,
          sourceRef: input.requestId,
        },
      ],
      approved: new Set([invoiceNumber]),
      agentKey,
      client: mode === "stub" ? new StubSzamlazzAgentClient() : this.client,
      store: this.store,
      allowPartial: true,
    });
    const outcome = line!.outcome;
    await this.audit.record({
      userId: user.id,
      invoiceNumber,
      metadata: {
        requestId: input.requestId,
        date: input.date,
        amount,
        mode,
        outcome: outcome.kind,
      },
    });
    if (outcome.kind === "WRITTEN")
      return {
        state: "WRITTEN",
        outstanding: outcome.outstanding,
        message:
          mode === "stub"
            ? "Teszt-szerver: a kifizetés nem ment a Számlázz.hu-ba (álszámlázó)."
            : "A kifizetés a Számlázz.hu-ban rögzítve; az OS a következő Számlázz.hu-adattal mutatja.",
      };
    if (outcome.kind === "LOGGED_BEFORE")
      return {
        state: "ALREADY_RECORDED",
        outstanding: null,
        message:
          "Ezt a kifizetést már rögzítettük (ugyanaz a kérés), újra nem írtam.",
      };
    throw refusal(outcome);
  }
}

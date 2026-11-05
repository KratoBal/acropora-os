import { createHash, randomBytes } from "node:crypto";

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  isGameAnswerCorrect,
  normalizeGameEmail,
  type GameOption,
  type GameQuestionType,
} from "@acropora/types";

import {
  MAIL_SENDER,
  type MailSender,
} from "../notifications/mail/mail.port.js";
import {
  mailGate,
  mailModeOf,
  mailRedirect,
} from "../notifications/mail/ticket-mail.rules.js";

/** The error shape of the public game endpoints (exchange/jatek/jatek-api-szerzodes.md). */
export function gameError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export interface PublicGameQuestion {
  id: string;
  week: string;
  type: GameQuestionType;
  prompt: string;
  options: GameOption[];
  opensAt: string;
  closesAt: string;
}

/** The database the service reads and writes; the test hands in a fake. */
export type GameDatabase = Pick<typeof prisma, "gameQuestion" | "gameEntry">;

export const GAME_ENV = Symbol("GAME_ENV");

/**
 * THE GIVEAWAY'S PUBLIC SIDE (card 31445d0f; brief exchange/jatek/brief-2026-11-05.md; the contract with the page:
 * exchange/jatek/jatek-api-szerzodes.md). The open question without its accepted answers, an entry, and its
 * confirmation from the mailed link.
 *
 * WHAT IT DOES NOT TELL A CALLER: whether an address has played this week, or whether an answer is right. Every
 * accepted entry answers the same (`CHECK_EMAIL`): a new one, a repeat, and the bot trap alike. An unconfirmed repeat
 * takes the new answer and gets a new link (a lost mail can be asked again); a confirmed one is left alone.
 *
 * THE MAIL goes through the OS's own sender and its gate: TICKET_MAIL_MODE, the path switch TICKET_MAIL_GAME, and the
 * redirect (on stage every mail goes to TICKET_MAIL_REDIRECT_TO). A closed gate keeps the entry and says so in the log;
 * the caller hears the same answer, so it learns nothing from it either.
 */
@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  /** the test replaces it */
  database: GameDatabase = prisma;
  now: () => Date = () => new Date();

  constructor(
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    @Optional()
    @Inject(GAME_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private async openQuestion() {
    const now = this.now();
    return this.database.gameQuestion.findFirst({
      where: { opensAt: { lte: now }, closesAt: { gt: now } },
      orderBy: { opensAt: "desc" },
    });
  }

  private publicView(question: {
    id: string;
    week: string;
    type: string;
    prompt: string;
    options: unknown;
    opensAt: Date;
    closesAt: Date;
  }): PublicGameQuestion {
    return {
      id: question.id,
      week: question.week,
      type: question.type as GameQuestionType,
      prompt: question.prompt,
      options:
        question.type === "CHOICE" ? (question.options as GameOption[]) : [],
      opensAt: question.opensAt.toISOString(),
      closesAt: question.closesAt.toISOString(),
    };
  }

  async current(): Promise<{ question: PublicGameQuestion | null }> {
    const question = await this.openQuestion();
    return { question: question ? this.publicView(question) : null };
  }

  async submit(input: {
    questionId?: unknown;
    email?: unknown;
    answer?: unknown;
    website?: unknown;
  }): Promise<{ status: "CHECK_EMAIL" }> {
    const answered = { status: "CHECK_EMAIL" } as const;
    // the bot trap: a filled hidden field gets the same answer and nothing is kept
    if (typeof input.website === "string" && input.website.trim() !== "")
      return answered;
    const email =
      typeof input.email === "string" ? normalizeGameEmail(input.email) : null;
    if (!email)
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_EMAIL",
        "Kérjük, adj meg egy érvényes e-mail címet.",
      );
    if (typeof input.questionId !== "string" || input.questionId === "")
      throw gameError(
        HttpStatus.NOT_FOUND,
        "NO_QUESTION",
        "Nincs ilyen kérdés.",
      );
    const question = await this.database.gameQuestion.findUnique({
      where: { id: input.questionId },
    });
    if (!question)
      throw gameError(
        HttpStatus.NOT_FOUND,
        "NO_QUESTION",
        "Nincs ilyen kérdés.",
      );
    const now = this.now();
    if (now < question.opensAt || now >= question.closesAt)
      throw gameError(
        HttpStatus.CONFLICT,
        "CLOSED",
        "Erre a kérdésre most nem lehet válaszolni.",
      );
    const answer = typeof input.answer === "string" ? input.answer.trim() : "";
    const options = (question.options as unknown as GameOption[]) ?? [];
    if (
      answer.length === 0 ||
      answer.length > 200 ||
      (question.type === "CHOICE" && !options.some((o) => o.id === answer))
    )
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_ANSWER",
        "Kérjük, adj meg egy választ.",
      );

    const autoCorrect = isGameAnswerCorrect(
      question.type as GameQuestionType,
      answer,
      (question.acceptedAnswers as unknown as string[]) ?? [],
    );
    const token = randomBytes(32).toString("base64url");
    const existing = await this.database.gameEntry.findUnique({
      where: { questionId_email: { questionId: question.id, email } },
    });
    if (existing?.confirmedAt) return answered;
    if (existing)
      await this.database.gameEntry.update({
        where: { id: existing.id },
        data: {
          answer,
          autoCorrect,
          confirmTokenHash: sha256(token),
        },
      });
    else
      await this.database.gameEntry.create({
        data: {
          questionId: question.id,
          email,
          answer,
          autoCorrect,
          confirmTokenHash: sha256(token),
        },
      });
    await this.mailConfirmation(email, token, question.week);
    return answered;
  }

  private async mailConfirmation(
    email: string,
    token: string,
    week: string,
  ): Promise<void> {
    const gate = mailGate({
      mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
      pathMode: mailModeOf(this.environment.TICKET_MAIL_GAME),
      redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
    });
    const base = this.environment.JATEK_PUBLIC_URL?.trim().replace(/\/+$/, "");
    if (gate.kind === "closed" || !this.sender || !base) {
      this.logger.warn(
        `Nyereményjáték ${week}: a megerősítő levél nem ment ki (${gate.kind === "closed" ? gate.reason : !this.sender ? "no-sender" : "no-JATEK_PUBLIC_URL"}); a beküldés megvan, megerősítetlenül`,
      );
      return;
    }
    const link = `${base}/megerosites?token=${encodeURIComponent(token)}`;
    try {
      await this.sender.send({
        to: [email],
        subject: "Erősítsd meg a játékodat: Acropora karácsonyi nyereményjáték",
        text: [
          "Szia!",
          "",
          "Köszönjük, hogy játszol az Acropora karácsonyi nyereményjátékán.",
          "A játékod akkor érvényes, ha megerősíted ezen a linken:",
          "",
          link,
          "",
          "Ha nem te küldted, nincs teendőd: megerősítés nélkül a beküldés nem számít.",
          "",
          "Acropora",
        ].join("\n"),
      });
    } catch (error) {
      this.logger.error(
        `Nyereményjáték ${week}: a megerősítő levél küldése elbukott (${error instanceof Error ? error.name : "UNKNOWN"})`,
      );
    }
  }

  async confirm(input: {
    token?: unknown;
  }): Promise<{ status: "CONFIRMED" | "ALREADY_CONFIRMED"; week: string }> {
    const token = typeof input.token === "string" ? input.token.trim() : "";
    const entry = token
      ? await this.database.gameEntry.findUnique({
          where: { confirmTokenHash: sha256(token) },
          include: { question: true },
        })
      : null;
    if (!entry)
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_TOKEN",
        "Ez a megerősítő link nem érvényes.",
      );
    if (entry.confirmedAt)
      return { status: "ALREADY_CONFIRMED", week: entry.question.week };
    if (this.now() >= entry.question.closesAt)
      throw gameError(
        HttpStatus.CONFLICT,
        "CLOSED",
        "Ez a heti kérdés már lezárult, a megerősítés nem számít.",
      );
    await this.database.gameEntry.update({
      where: { id: entry.id },
      data: { confirmedAt: this.now() },
    });
    return { status: "CONFIRMED", week: entry.question.week };
  }
}

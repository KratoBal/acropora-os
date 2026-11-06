import { createHash, randomBytes } from "node:crypto";

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  isGameAnswerCorrect,
  normalizeGameEmail,
  type GameOption,
  type GameQuestionType,
} from "@acropora/types";

import {
  CONFIRMATION_SUBJECT,
  renderConfirmationMail,
  type ConfirmationMailInput,
} from "./game-confirmation-mail.js";
import {
  MAIL_SENDER,
  type MailSender,
} from "../notifications/mail/mail.port.js";
import { GAME_PRIVACY_VERSION, GAME_RULES_VERSION } from "./game-consent.js";
import {
  mailGate,
  mailModeOf,
  mailRedirect,
} from "../notifications/mail/ticket-mail.rules.js";
import {
  gameEraseAfterDays,
  gameEraseDeadline,
  gameErasureDueAt,
} from "./game-erasure.service.js";

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

/**
 * A WINNER'S NAME AS THE PAGE SHOWS IT (Balázs, 2026-11-06): the first word and the initial of the second, "Kovács P." (the
 * surname comes first in Hungarian). One word stays as it is. The full name never leaves the OS.
 */
export function shortPublicName(name: string): string {
  const words = name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  const initial = [...words[1]!][0]!.toLocaleUpperCase("hu-HU");
  return `${words[0]} ${initial}.`;
}

/**
 * A WINNER'S ADDRESS AS THE PUBLIC LIST SHOWS IT (Balázs, 2026-11-06 10:51 UTC, acrobot 44368; the length rule is acrobot's,
 * 44431, after barracuda's note on #2286): the first two characters of the part before the @, three bullet signs, then the @
 * and the whole domain: "ko•••@gmail.com". A part of three characters or fewer shows ONE character, because with the name
 * beside it two letters of a two- or three-character part would give the whole address away. An address with no @ shows
 * nothing of itself ("•••"): this is the one place an address could be printed whole by mistake, so a malformed one is
 * hidden, never passed on.
 */
export function maskPublicEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "•••";
  const local = [...email.slice(0, at)];
  const shown = local.slice(0, local.length <= 3 ? 1 : 2).join("");
  return `${shown}•••${email.slice(at)}`;
}

/**
 * THE NAME THE PUBLIC LIST SHOWS: the shortened form, but only for what looks like a person's name (letters, marks, hyphen,
 * apostrophe, spaces). A "name" with a dot, a digit, an at sign or the like ("nyeremeny-acropora.hu") would be published
 * whole when it won, so it shows as "Nyertes" (barracuda, #2279).
 */
export function publicWinnerName(name: string): string {
  return /^[\p{L}\p{M}'\u2019 -]+$/u.test(name)
    ? shortPublicName(name)
    : "Nyertes";
}

/** The longest name the giveaway keeps. */
export const GAME_NAME_MAX = 120;

/**
 * THE PLAYER'S NAME as it is kept: trimmed, inner whitespace collapsed to one space, and at least two characters with a
 * letter among them. `null` when it is not a name (empty, one character, only digits or marks), so the caller says so
 * once, in one place. The page shows a winner by a shortened form of it (surname and the first name's initial).
 */
export function normalizeGameName(value: string): string | null {
  // invisible and direction-changing characters (control and format: a zero-width space, U+202E) are dropped: the name is
  // shown on the public page (barracuda, #2277)
  const name = value
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > GAME_NAME_MAX) return null;
  return /\p{L}/u.test(name) ? name : null;
}

/** The week's prize as the page shows it; the picture is fetched by the question's id (`prizeImage`). */
export interface PublicGamePrize {
  name: string;
  description: string | null;
  hasImage: boolean;
}

export interface PublicGameQuestion {
  id: string;
  week: string;
  type: GameQuestionType;
  prompt: string;
  options: GameOption[];
  opensAt: string;
  closesAt: string;
  prize: PublicGamePrize | null;
}

/** The next question, seen ahead: when it opens, and its prize (no prompt, no options). */
export interface PublicGameNext {
  id: string;
  week: string;
  opensAt: string;
  prize: PublicGamePrize | null;
}

/** A closed week with its correct answer, for the public page (rules, section 6: published after the closing). */
export interface PublicGameClosedWeek {
  week: string;
  prompt: string;
  answer: string;
  closesAt: string;
}

/** A past draw's winner for the public list: only the shortened name, never the address. */
export interface PublicGameWinner {
  kind: "WEEKLY" | "CHRISTMAS";
  week: string | null;
  name: string;
  /** the winner's address, partly hidden ("ko•••@gmail.com"): the privacy notice (section 4) publishes it so two players with the same short name can be told apart */
  emailMasked: string;
  prizeName: string | null;
  drawnAt: string;
}

/** The database the service reads and writes; the test hands in a fake. */
export type GameDatabase = Pick<
  typeof prisma,
  "gameQuestion" | "gameEntry" | "gameMailDay" | "gameDraw" | "mailImage"
>;

export const GAME_ENV = Symbol("GAME_ENV");

/**
 * THE MAIL'S PACE PER ADDRESS AND QUESTION (barracuda, #2254: our own sender must not flood one address). A new link
 * goes out at most every two minutes, and at most five times for one entry; past either, the entry answers the same
 * and sends nothing. This holds whatever the caller's address claims, so a forged header cannot buy more mail.
 */
export const GAME_MAIL_COOLDOWN_MS = 2 * 60_000;
export const GAME_MAIL_MAX_PER_ENTRY = 5;
/** The giveaway's mail in one Budapest day, in all (acrobot, 2026-11-05 22:57), unless JATEK_MAIL_DAILY_CAP says other. */
export const GAME_MAIL_DAILY_CAP_DEFAULT = 3000;

/** A send error for the admin: its kind and the start of its message, never longer than a line. */
function sendErrorText(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  const message = error.message.replace(/\s+/g, " ").slice(0, 160);
  return message ? `${error.name}: ${message}` : error.name;
}

/**
 * THE GIVEAWAY'S PUBLIC SIDE (card 31445d0f; brief exchange/jatek/brief-2026-11-05.md; the contract with the page:
 * exchange/jatek/jatek-api-szerzodes.md). The open question without its accepted answers, an entry, and its
 * confirmation from the mailed link.
 *
 * WHAT IT DOES NOT TELL A CALLER: whether an address has played this week, or whether an answer is right. Every
 * accepted entry answers the same (`CHECK_EMAIL`): a new one, a repeat, and the bot trap alike. An unconfirmed repeat
 * takes the new answer and gets a new link (a lost mail can be asked again), paced per address (`GAME_MAIL_COOLDOWN_MS`,
 * `GAME_MAIL_MAX_PER_ENTRY`); a confirmed one is left alone, and so is one confirmed between our read and our write
 * (the write is conditional on `confirmedAt: null`). Two first entries at once: the second answers the same, no mail.
 *
 * THE MAIL goes through the OS's own sender and its gate: TICKET_MAIL_MODE, the path switch TICKET_MAIL_GAME, and the
 * redirect (on stage every mail goes to TICKET_MAIL_REDIRECT_TO). A closed gate keeps the entry and says so in the log;
 * the caller hears the same answer, so it learns nothing from it either.
 */
@Injectable()
export class GameService implements OnModuleInit {
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

  /**
   * Without the shared secret every visitor behind the game page's server falls on one key, and the page's limits
   * are one allowance for all (barracuda, #2254 v3): said once at start, where a deploy log shows it.
   */
  onModuleInit(): void {
    if (!this.environment.JATEK_PROXY_SECRET?.trim())
      this.logger.warn(
        "Nyereményjáték: nincs JATEK_PROXY_SECRET, a lap mögötti látogatók egy közös korlát-kulcson osztoznak",
      );
  }

  private async openQuestion() {
    const now = this.now();
    return this.database.gameQuestion.findFirst({
      where: { opensAt: { lte: now }, closesAt: { gt: now } },
      orderBy: { opensAt: "desc" },
    });
  }

  private prizeOf(question: {
    prizeName: string | null;
    prizeDescription: string | null;
    prizeImageId: string | null;
  }): PublicGamePrize | null {
    return question.prizeName
      ? {
          name: question.prizeName,
          description: question.prizeDescription,
          hasImage: question.prizeImageId !== null,
        }
      : null;
  }

  private publicView(question: {
    id: string;
    week: string;
    type: string;
    prompt: string;
    options: unknown;
    opensAt: Date;
    closesAt: Date;
    prizeName: string | null;
    prizeDescription: string | null;
    prizeImageId: string | null;
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
      prize: this.prizeOf(question),
    };
  }

  /** The question that opens next (the soonest one that has not opened yet), or null. */
  private async nextQuestion() {
    return this.database.gameQuestion.findFirst({
      where: { opensAt: { gt: this.now() } },
      orderBy: { opensAt: "asc" },
    });
  }

  /**
   * THE OPEN QUESTION, AND THE NEXT ONE seen ahead (Balázs, 2026-11-06): while no question is open, the page counts down
   * to `next.opensAt` and shows `next.prize`, and it asks again when the count reaches zero, so the question appears
   * by itself. The next question's prompt is NOT sent: it is not for the public before it opens.
   */
  async current(): Promise<{
    question: PublicGameQuestion | null;
    next: PublicGameNext | null;
  }> {
    const question = await this.openQuestion();
    const next = await this.nextQuestion();
    return {
      question: question ? this.publicView(question) : null,
      next: next
        ? {
            id: next.id,
            week: next.week,
            opensAt: next.opensAt.toISOString(),
            prize: this.prizeOf(next),
          }
        : null,
    };
  }

  /**
   * THE CORRECT ANSWER, AFTER THE CLOSING AND NOT BEFORE (rules v2, section 6: "a helyes választ az adott heti forduló
   * lezárását követően teszi közzé a játék weboldalán"). Decided here, on the server: only a question whose `closesAt` has
   * passed (at the closing moment itself it has) is read, so an open or coming question's answer is never in a response.
   * A choice question gives the label of the right option (or options), a free-text one the first accepted answer as the
   * admin wrote it. The newest 20 closed weeks.
   */
  async closedWeeks(): Promise<{ weeks: PublicGameClosedWeek[] }> {
    const rows = await this.database.gameQuestion.findMany({
      where: { closesAt: { lte: this.now() } },
      orderBy: { closesAt: "desc" },
      take: 20,
    });
    return {
      weeks: rows.map((question) => {
        const accepted =
          (question.acceptedAnswers as unknown as string[]) ?? [];
        const options = (question.options as unknown as GameOption[]) ?? [];
        const answer =
          question.type === "CHOICE"
            ? accepted
                .map((id) => options.find((o) => o.id === id)?.label)
                .filter((label): label is string => !!label)
                .join(" / ")
            : (accepted[0] ?? "");
        return {
          week: question.week,
          prompt: question.prompt,
          answer,
          closesAt: question.closesAt.toISOString(),
        };
      }),
    };
  }

  /**
   * A QUESTION'S PRIZE PICTURE for the public page, and only when the question is public: it has opened, or it is the
   * very next one (its prize is shown ahead). A later question's picture is not given out early. Null otherwise.
   */
  async prizeImage(questionId: string) {
    const question = await this.database.gameQuestion.findUnique({
      where: { id: questionId },
      select: { opensAt: true, prizeImageId: true },
    });
    if (!question?.prizeImageId) return null;
    if (question.opensAt > this.now()) {
      const next = await this.nextQuestion();
      if (next?.id !== questionId) return null;
    }
    const image = await this.database.mailImage.findUnique({
      where: { id: question.prizeImageId },
      select: { content: true, contentType: true },
    });
    return image
      ? { bytes: Buffer.from(image.content), contentType: image.contentType }
      : null;
  }

  /**
   * THE PAST WINNERS (newest first, at most 20): the shortened name and the prize; a winner without a name is left out.
   * ONLY THE FIRST DRAW OF A WEEK (or of the Christmas draw) COUNTS: the rules say a re-run draw never replaces the first
   * recorded result, so a second draw for the same week must not publish a second name (barracuda, #2279). The first
   * draw counts even if it had no winner: then the week has none.
   */
  async winners(): Promise<{ winners: PublicGameWinner[] }> {
    const all = await this.database.gameDraw.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { question: { select: { week: true, prizeName: true } } },
    });
    // THE LIST ENDS WITH THE ERASURE (the notice: the name and the masked address come off the list): from the grand
    // prize draw plus JATEK_ERASE_AFTER_DAYS, or the fallback JATEK_ERASE_DEADLINE if sooner, the list is empty; the
    // winners' accounting rows stay
    const { dueAt } = gameErasureDueAt(
      all,
      gameEraseAfterDays(this.environment.JATEK_ERASE_AFTER_DAYS).days,
      gameEraseDeadline(this.environment.JATEK_ERASE_DEADLINE).deadline,
    );
    if (this.now() >= dueAt) return { winners: [] };
    const firstOf = new Map<string, (typeof all)[number]>();
    for (const draw of [...all].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      const key = `${draw.kind}:${draw.questionId ?? ""}`;
      if (!firstOf.has(key)) firstOf.set(key, draw);
    }
    const draws = [...firstOf.values()]
      .filter((draw) => draw.winnerEmail !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20);
    const emails = [...new Set(draws.map((d) => d.winnerEmail!))];
    const entries = emails.length
      ? await this.database.gameEntry.findMany({
          where: { email: { in: emails }, name: { not: null } },
          orderBy: { createdAt: "asc" },
          select: { email: true, questionId: true, name: true },
        })
      : [];
    const winners: PublicGameWinner[] = [];
    for (const draw of draws) {
      const own = entries.find(
        (e) => e.email === draw.winnerEmail && e.questionId === draw.questionId,
      );
      const latest = entries.filter((e) => e.email === draw.winnerEmail).at(-1);
      const name = (own ?? latest)?.name;
      if (!name) continue;
      winners.push({
        kind: draw.kind === "CHRISTMAS" ? "CHRISTMAS" : "WEEKLY",
        week: draw.question?.week ?? null,
        name: publicWinnerName(name),
        emailMasked: maskPublicEmail(draw.winnerEmail!),
        prizeName: draw.question?.prizeName ?? null,
        drawnAt: draw.createdAt.toISOString(),
      });
    }
    return { winners };
  }

  async submit(input: {
    questionId?: unknown;
    email?: unknown;
    name?: unknown;
    rulesAccepted?: unknown;
    consentGiven?: unknown;
    rulesVersion?: unknown;
    privacyVersion?: unknown;
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
    const name =
      typeof input.name === "string" ? normalizeGameName(input.name) : null;
    if (!name)
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_NAME",
        "Kérjük, add meg a nevedet.",
      );
    // BOTH separate acceptances are required (privacy notice 3.1: the consent is its own unticked box, apart from the rules),
    // and they are asked here, not only on the page; and only against the texts that are current now
    if (input.rulesAccepted !== true || input.consentGiven !== true)
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "CONSENT_REQUIRED",
        "A részvételhez el kell fogadnod a játékszabályzatot, és hozzá kell járulnod az adatkezeléshez.",
      );
    if (
      input.rulesVersion !== GAME_RULES_VERSION ||
      input.privacyVersion !== GAME_PRIVACY_VERSION
    )
      throw gameError(
        HttpStatus.CONFLICT,
        "OUTDATED_TEXT",
        "A játékszabályzat vagy az adatkezelési tájékoztató közben megváltozott. Töltsd újra az oldalt, és fogadd el újra.",
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
    let entryId: string;
    if (existing) {
      const recent =
        existing.lastMailedAt !== null &&
        now.getTime() - existing.lastMailedAt.getTime() < GAME_MAIL_COOLDOWN_MS;
      if (recent || existing.mailCount >= GAME_MAIL_MAX_PER_ENTRY)
        return answered;
      // only while still unconfirmed: a confirmation in between keeps its answer and its link
      const { count } = await this.database.gameEntry.updateMany({
        where: { id: existing.id, confirmedAt: null },
        data: {
          name,
          rulesAcceptedAt: now,
          consentAt: now,
          rulesVersion: GAME_RULES_VERSION,
          privacyVersion: GAME_PRIVACY_VERSION,
          answer,
          autoCorrect,
          confirmTokenHash: sha256(token),
          mailCount: { increment: 1 },
          lastMailedAt: now,
        },
      });
      if (count === 0) return answered;
      entryId = existing.id;
    } else {
      try {
        ({ id: entryId } = await this.database.gameEntry.create({
          data: {
            questionId: question.id,
            email,
            name,
            rulesAcceptedAt: now,
            consentAt: now,
            rulesVersion: GAME_RULES_VERSION,
            privacyVersion: GAME_PRIVACY_VERSION,
            answer,
            autoCorrect,
            confirmTokenHash: sha256(token),
            mailCount: 1,
            lastMailedAt: now,
          },
          select: { id: true },
        }));
      } catch (error) {
        // a second first entry for the same address at the same moment: the first one stands
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          return answered;
        throw error;
      }
    }
    await this.deliver(entryId, email, token, question.week);
    return answered;
  }

  /** The Budapest day a mail is counted on (the daily cap's key). */
  private today(): string {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Budapest",
    }).format(this.now());
  }

  /** The daily cap of the giveaway's mail (JATEK_MAIL_DAILY_CAP, default 3000). */
  dailyCap(): number {
    const n = Number(this.environment.JATEK_MAIL_DAILY_CAP);
    return Number.isInteger(n) && n >= 0 ? n : GAME_MAIL_DAILY_CAP_DEFAULT;
  }

  /** Today's mail so far, for the admin. */
  async sentToday(): Promise<number> {
    const row = await this.database.gameMailDay.findUnique({
      where: { day: this.today() },
    });
    return row?.sent ?? 0;
  }

  /**
   * ONE CONFIRMATION MAIL, UNDER THE DAILY CAP (acrobot, 2026-11-05 22:57): a slot is taken first (an atomic increment of
   * the day's counter); past the cap the entry stays, its mail waits (`mailPendingSince`), and the admin sees it and
   * sends it later. The caller hears the same answer either way. Returns what happened, for the admin's queue.
   */
  async deliver(
    entryId: string,
    email: string,
    token: string,
    week: string,
    /** the queue's send: the attempt is counted only once the mail went out (barracuda, #2254 v3) */
    countOnSend = false,
  ): Promise<"SENT" | "QUEUED" | "NOT_SENT"> {
    const wait = async (reason: string) => {
      await this.database.gameEntry.update({
        where: { id: entryId },
        data: { mailPendingSince: this.now() },
      });
      this.logger.warn(
        `Nyereményjáték ${week}: a megerősítő levél sorban áll (${reason})`,
      );
    };
    // a mail that cannot go out at all waits, and spends nothing of the day's cap (barracuda, #2254 v3)
    const blocked = this.mailBlocked();
    if (blocked) {
      await wait(blocked);
      return "NOT_SENT";
    }
    const { sent } = await this.database.gameMailDay.upsert({
      where: { day: this.today() },
      create: { day: this.today(), sent: 1 },
      update: { sent: { increment: 1 } },
    });
    if (sent > this.dailyCap()) {
      await wait(`a napi levél-plafon (${this.dailyCap()}) betelt`);
      return "QUEUED";
    }
    const details = await this.confirmationDetails(entryId);
    const outcome = await this.mailConfirmation(email, token, week, details);
    if (outcome === "SENT") {
      await this.database.gameEntry.update({
        where: { id: entryId },
        data: {
          mailPendingSince: null,
          ...(countOnSend
            ? { mailCount: { increment: 1 }, lastMailedAt: this.now() }
            : {}),
        },
      });
      return "SENT";
    }
    // the send failed: the slot is given back, and the mail waits for the queue
    await this.database.gameMailDay.update({
      where: { day: this.today() },
      data: { sent: { decrement: 1 } },
    });
    await wait("a küldés elbukott");
    return "NOT_SENT";
  }

  /**
   * The last send that failed, kept in this process for the admin (acrobot 44026: on stage the mail never arrived,
   * and the log is not readable from the fleet). Cleared by the next mail that goes out.
   */
  private lastMailError: { at: string; reason: string } | null = null;

  /** Why mail would not go out now, and the last failure: the admin's view of a mail that never arrived. */
  mailStatus(): {
    blocked: string | null;
    lastError: { at: string; reason: string } | null;
  } {
    return { blocked: this.mailBlocked(), lastError: this.lastMailError };
  }

  /** The confirmation link of a token, on the game page (JATEK_PUBLIC_URL). */
  confirmLink(token: string): string {
    const base = (this.environment.JATEK_PUBLIC_URL ?? "")
      .trim()
      .replace(/\/+$/, "");
    return `${base}/megerosites?token=${encodeURIComponent(token)}`;
  }

  /**
   * Whether the admin may take a confirmation link without the mail: JATEK_TEST_LINKS=on AND the mail redirected
   * (TICKET_MAIL_REDIRECT_TO set to an address), which is what marks a test environment. A switch left on in
   * production, where the redirect is "off", still gives no link (barracuda, #2258: a second lock, since such a link
   * lets a person confirm in a player's place).
   */
  testLinksOn(): boolean {
    return (
      this.environment.JATEK_TEST_LINKS?.trim() === "on" &&
      mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO).kind === "on"
    );
  }

  /** Whether the game page's address is set: without it a link would point at the wrong site. */
  publicUrlSet(): boolean {
    return Boolean(this.environment.JATEK_PUBLIC_URL?.trim());
  }

  /** Why a mail cannot go out now (the gate, the sender, the link's base), or null. */
  mailBlocked(): string | null {
    const gate = mailGate({
      mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
      pathMode: mailModeOf(this.environment.TICKET_MAIL_GAME),
      redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
    });
    if (gate.kind === "closed") return gate.reason;
    if (!this.sender) return "no-sender";
    if (!this.environment.JATEK_PUBLIC_URL?.trim())
      return "no-JATEK_PUBLIC_URL";
    return null;
  }

  /**
   * What the confirmation mail says about the entry: the question, a choice answer by its label (a free-text answer
   * is never quoted), the closing time. Read for THIS entry at send time (the queue sends later too). A read that fails or finds
   * nothing leaves the details out: the mail still goes, with the link and the rest.
   */
  private async confirmationDetails(
    entryId: string,
  ): Promise<Omit<ConfirmationMailInput, "link">> {
    try {
      const entry = await this.database.gameEntry.findUnique({
        where: { id: entryId },
        include: { question: true },
      });
      if (!entry?.question) return {};
      const question = entry.question;
      const options = (question.options as unknown as GameOption[]) ?? [];
      // only a choice's label (our own text) goes into the mail; a free-text answer never does (barracuda, #2263)
      const choiceLabel =
        question.type === "CHOICE"
          ? (options.find((o) => o.id === entry.answer)?.label ?? null)
          : null;
      return {
        prompt: question.prompt,
        choiceLabel,
        closesAt: question.closesAt,
      };
    } catch {
      return {};
    }
  }

  private async mailConfirmation(
    email: string,
    token: string,
    week: string,
    details: Omit<ConfirmationMailInput, "link"> = {},
  ): Promise<"SENT" | "NOT_SENT"> {
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
      return "NOT_SENT";
    }
    const link = this.confirmLink(token);
    try {
      // the "email" profile's formatted body (the sender's frame and button style), and its plain-text twin
      const { html, text } = renderConfirmationMail({ link, ...details });
      await this.sender.send({
        to: [email],
        subject: CONFIRMATION_SUBJECT,
        html,
        text,
      });
    } catch (error) {
      this.logger.error(
        `Nyereményjáték ${week}: a megerősítő levél küldése elbukott (${error instanceof Error ? error.name : "UNKNOWN"})`,
      );
      this.lastMailError = {
        at: this.now().toISOString(),
        reason: sendErrorText(error),
      };
      return "NOT_SENT";
    }
    this.lastMailError = null;
    return "SENT";
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

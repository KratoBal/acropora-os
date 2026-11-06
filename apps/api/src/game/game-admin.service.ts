import { createHash, randomBytes } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  christmasCandidates,
  drawGameWinner,
  GAME_QUESTION_TYPES,
  isGameAnswerCorrect,
  type GameQuestionType,
  type GameDrawCandidate,
  type GameOption,
} from "@acropora/types";

import { gameError, GameService } from "./game.service.js";

/** The admin's question: what the form sends (create and edit alike). */
export interface GameQuestionInput {
  week: string;
  type: string;
  prompt: string;
  options: GameOption[];
  acceptedAnswers: string[];
  opensAt: string;
  closesAt: string;
  /** the week's prize: `undefined` leaves it, `null` or "" clears it */
  prizeName?: string | null;
  prizeDescription?: string | null;
  prizeImageId?: string | null;
}

/** An entry counts in a draw when it is confirmed and right: the person's decision, else the automatic one. */
const counts = (entry: {
  confirmedAt: Date | null;
  autoCorrect: boolean;
  manualCorrect: boolean | null;
}) => entry.confirmedAt !== null && (entry.manualCorrect ?? entry.autoCorrect);

/**
 * THE GIVEAWAY'S ADMIN SIDE (card 31445d0f; brief exchange/jatek/brief-2026-11-05.md, slice 2): the weekly questions,
 * the entries with a person's decision on a doubtful answer, and the draws.
 *
 * A DRAW IS KEPT WITH WHAT IT SAW: the seed, the candidates (sorted by e-mail, with their weights) and the winner. Run
 * again (`verify`), the kept seed and the kept candidates pick the same winner, so it can be shown live; a new draw
 * takes the entries as they are now. Only a confirmed, correct entry is a candidate (Balázs: only the right answer goes
 * in the draw); the Christmas weight is the number of weeks with one.
 */
@Injectable()
export class GameAdminService {
  constructor(private readonly game: GameService) {}

  /** the test replaces it */
  database: Pick<
    typeof prisma,
    | "gameQuestion"
    | "gameEntry"
    | "gameDraw"
    | "auditLog"
    | "mailImage"
    | "$transaction"
  > = prisma;

  private checkQuestion(input: GameQuestionInput, creating = false) {
    const bad = (message: string) =>
      gameError(HttpStatus.BAD_REQUEST, "INVALID_QUESTION", message);
    if (!/^\d{4}-W\d{2}$/.test(input.week))
      throw bad("A hét alakja: 2026-W46.");
    if (!(GAME_QUESTION_TYPES as readonly string[]).includes(input.type))
      throw bad("A típus TEXT vagy CHOICE.");
    if (!input.prompt?.trim()) throw bad("A kérdés szövege kell.");
    const opens = new Date(input.opensAt);
    const closes = new Date(input.closesAt);
    if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime()))
      throw bad("A nyitás és a zárás időpontja kell.");
    if (closes <= opens) throw bad("A zárás a nyitás után legyen.");
    const accepted = (input.acceptedAnswers ?? [])
      .map((a) => a.trim())
      .filter(Boolean);
    if (accepted.length === 0)
      throw bad("Legalább egy elfogadott válasz kell.");
    const options = input.type === "CHOICE" ? (input.options ?? []) : [];
    if (input.type === "CHOICE") {
      if (options.length < 2) throw bad("Legalább két lehetőség kell.");
      const ids = new Set(options.map((o) => o.id));
      if (
        ids.size !== options.length ||
        options.some((o) => !o.id || !o.label?.trim())
      )
        throw bad("Minden lehetőségnek egyedi azonosítója és felirata legyen.");
      if (accepted.some((a) => !ids.has(a)))
        throw bad("A helyes válasz a lehetőségek közül való legyen.");
    }
    // the prize: an absent key leaves the stored value, null or blank clears it
    const text = (value: string | null | undefined) =>
      value === undefined ? undefined : value?.trim() || null;
    const prizeName = text(input.prizeName);
    const prizeDescription = text(input.prizeDescription);
    const prizeImageId = text(input.prizeImageId);
    // a NEW question without a name has none; on an edit an absent name key leaves the stored one
    const nameStays = prizeName !== undefined ? prizeName !== null : !creating;
    if (!nameStays && (prizeDescription || prizeImageId))
      throw bad("A nyereményhez név kell.");
    return {
      week: input.week,
      type: input.type,
      prompt: input.prompt.trim(),
      options: options as unknown as Prisma.InputJsonValue,
      acceptedAnswers: accepted as unknown as Prisma.InputJsonValue,
      opensAt: opens,
      closesAt: closes,
      ...(prizeName !== undefined ? { prizeName } : {}),
      ...(prizeDescription !== undefined ? { prizeDescription } : {}),
      ...(prizeImageId !== undefined ? { prizeImageId } : {}),
    };
  }

  /** A prize image has to be one in the image store: a wrong id would otherwise be a database error. */
  private async checkPrizeImage(prizeImageId: string | null | undefined) {
    if (!prizeImageId?.trim()) return;
    const found = await this.database.mailImage.findUnique({
      where: { id: prizeImageId.trim() },
      select: { id: true },
    });
    if (!found)
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_QUESTION",
        "A kiválasztott kép nem található.",
      );
  }

  /** The stored prize image for the admin's preview, or null. */
  async prizeImage(id: string) {
    const row = await this.database.mailImage.findUnique({
      where: { id },
      select: { content: true, contentType: true },
    });
    return row
      ? { bytes: Buffer.from(row.content), contentType: row.contentType }
      : null;
  }

  async questions() {
    const rows = await this.database.gameQuestion.findMany({
      orderBy: { opensAt: "desc" },
      include: {
        entries: {
          select: { confirmedAt: true, autoCorrect: true, manualCorrect: true },
        },
      },
    });
    return rows.map(({ entries, ...question }) => ({
      ...question,
      entryCount: entries.length,
      confirmedCount: entries.filter((e) => e.confirmedAt).length,
      candidateCount: entries.filter(counts).length,
    }));
  }

  async createQuestion(input: GameQuestionInput) {
    const data = this.checkQuestion(input, true);
    await this.checkPrizeImage(data.prizeImageId);
    try {
      return await this.database.gameQuestion.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw gameError(
          HttpStatus.CONFLICT,
          "WEEK_TAKEN",
          "Erre a hétre már van kérdés.",
        );
      throw error;
    }
  }

  /**
   * An edit takes the entries with it (barracuda, #2254): when an accepted variant is added after the answers came in,
   * the stored automatic decision of every entry is worked out again in the same transaction, so a right answer does
   * not stay "no match" and fall out of the draw. A person's decision (`manualCorrect`) stays as it was.
   */
  async updateQuestion(id: string, input: GameQuestionInput) {
    const data = this.checkQuestion(input);
    // A CLOSED QUESTION IS NOT REOPENED (barracuda, #2283): once it has closed, its correct answer is public and the week can
    // be drawn, so moving its closing into the future would let a week that has been published take answers again
    const stored = await this.database.gameQuestion.findUnique({
      where: { id },
      select: { closesAt: true },
    });
    const now = this.game.now();
    if (stored && stored.closesAt <= now && data.closesAt > now)
      throw gameError(
        HttpStatus.CONFLICT,
        "QUESTION_CLOSED",
        "A lezárt kérdés zárása nem tolható a jövőbe: a helyes válasza már nyilvános, és a hét sorsolható.",
      );
    await this.checkPrizeImage(data.prizeImageId);
    return this.database.$transaction(async (tx) => {
      const question = await tx.gameQuestion.update({ where: { id }, data });
      const entries = await tx.gameEntry.findMany({
        where: { questionId: id },
        select: { id: true, answer: true, autoCorrect: true },
      });
      for (const entry of entries) {
        const autoCorrect = isGameAnswerCorrect(
          question.type as GameQuestionType,
          entry.answer,
          question.acceptedAnswers as unknown as string[],
        );
        if (autoCorrect !== entry.autoCorrect)
          await tx.gameEntry.update({
            where: { id: entry.id },
            data: { autoCorrect },
          });
      }
      return question;
    });
  }

  async entries(questionId: string) {
    const rows = await this.database.gameEntry.findMany({
      where: { questionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        answer: true,
        autoCorrect: true,
        manualCorrect: true,
        manualAt: true,
        confirmedAt: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({ ...row, counts: counts(row) }));
  }

  /** A person's decision on an answer: right, wrong, or back to the automatic one (null); audited. */
  async decide(entryId: string, correct: boolean | null, userId: string) {
    return this.database.$transaction(async (tx) => {
      const entry = await tx.gameEntry.update({
        where: { id: entryId },
        data: {
          manualCorrect: correct,
          manualById: correct === null ? null : userId,
          manualAt: correct === null ? null : new Date(),
        },
        select: { id: true, questionId: true, manualCorrect: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "game.entry.decided",
          entityType: "GameEntry",
          entityId: entryId,
          metadata: { questionId: entry.questionId, correct },
        },
      });
      return entry;
    });
  }

  private async candidatesOf(
    kind: "WEEKLY" | "CHRISTMAS",
    questionId: string | null,
  ): Promise<GameDrawCandidate[]> {
    const rows = await this.database.gameEntry.findMany({
      where: {
        confirmedAt: { not: null },
        ...(kind === "WEEKLY" ? { questionId: questionId! } : {}),
      },
      select: {
        email: true,
        questionId: true,
        confirmedAt: true,
        autoCorrect: true,
        manualCorrect: true,
      },
    });
    const right = rows.filter(counts);
    const candidates =
      kind === "WEEKLY"
        ? right.map((r) => ({ email: r.email, weight: 1 }))
        : christmasCandidates(right);
    return candidates.sort((a, b) =>
      a.email < b.email ? -1 : a.email > b.email ? 1 : 0,
    );
  }

  /** A new draw: the entries as they are now, a fresh seed; kept with what it saw. */
  async draw(
    input: { kind: "WEEKLY" | "CHRISTMAS"; questionId?: string | null },
    userId: string,
  ) {
    if (input.kind !== "WEEKLY" && input.kind !== "CHRISTMAS")
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_DRAW",
        "A sorsolás heti vagy karácsonyi.",
      );
    if (input.kind === "WEEKLY" && !input.questionId)
      throw gameError(
        HttpStatus.BAD_REQUEST,
        "INVALID_DRAW",
        "A heti sorsoláshoz kérdés kell.",
      );
    const questionId = input.kind === "WEEKLY" ? input.questionId! : null;
    const now = this.game.now();
    if (questionId) {
      const question = await this.database.gameQuestion.findUnique({
        where: { id: questionId },
        select: { id: true, closesAt: true },
      });
      if (!question)
        throw gameError(
          HttpStatus.NOT_FOUND,
          "NO_QUESTION",
          "Nincs ilyen kérdés.",
        );
      // THE FIRST DRAW OF A WEEK IS FINAL on the public list (the rules: a re-run never replaces the first recorded result),
      // so it cannot be run while the week can still take answers: a trial or accidental draw would close the week for good
      // (barracuda, #2279)
      if (question.closesAt > now)
        throw gameError(
          HttpStatus.CONFLICT,
          "DRAW_TOO_EARLY",
          "A heti sorsolás a kérdés zárása után indítható: addig még jöhetnek válaszok, és az első sorsolás végleges.",
        );
    } else if (
      // the same for the Christmas draw: after the LAST question has closed
      await this.database.gameQuestion.findFirst({
        where: { closesAt: { gt: now } },
        select: { id: true },
      })
    )
      throw gameError(
        HttpStatus.CONFLICT,
        "DRAW_TOO_EARLY",
        "A karácsonyi sorsolás az utolsó kérdés zárása után indítható: addig még jöhetnek válaszok, és az első sorsolás végleges.",
      );
    const candidates = await this.candidatesOf(input.kind, questionId);
    const seed = randomBytes(16).toString("hex");
    const result = drawGameWinner(candidates, seed);
    return this.database.$transaction(async (tx) => {
      const draw = await tx.gameDraw.create({
        data: {
          kind: input.kind,
          questionId,
          seed,
          candidates: candidates as unknown as Prisma.InputJsonValue,
          winnerEmail: result?.winner.email ?? null,
          ticket: result?.ticket ?? null,
          tickets: result?.tickets ?? 0,
          createdById: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "game.draw",
          entityType: "GameDraw",
          entityId: draw.id,
          metadata: {
            kind: input.kind,
            questionId,
            candidates: candidates.length,
            tickets: draw.tickets,
          },
        },
      });
      return draw;
    });
  }

  /**
   * THE DRAWS, WITH THE NAMES the admin reads next to the addresses: the kept draw (seed, candidates, winner) is not
   * changed by it. `names` maps an address to the name of its latest entry that has one.
   */
  async draws() {
    const rows = await this.database.gameDraw.findMany({
      orderBy: { createdAt: "desc" },
      include: { question: { select: { week: true } } },
    });
    const emails = new Set<string>();
    for (const row of rows) {
      if (row.winnerEmail) emails.add(row.winnerEmail);
      for (const candidate of (row.candidates as unknown as GameDrawCandidate[]) ??
        [])
        emails.add(candidate.email);
    }
    const named =
      emails.size === 0
        ? []
        : await this.database.gameEntry.findMany({
            where: { email: { in: [...emails] }, name: { not: null } },
            orderBy: { createdAt: "asc" },
            select: { email: true, name: true },
          });
    const names: Record<string, string> = {};
    for (const entry of named) if (entry.name) names[entry.email] = entry.name;
    return rows.map((row) => ({ ...row, names }));
  }

  /** The draw run again from what it kept: the same seed and candidates must pick the same winner. */
  async verify(drawId: string) {
    const draw = await this.database.gameDraw.findUnique({
      where: { id: drawId },
    });
    if (!draw)
      throw gameError(HttpStatus.NOT_FOUND, "NO_DRAW", "Nincs ilyen sorsolás.");
    const again = drawGameWinner(
      draw.candidates as unknown as GameDrawCandidate[],
      draw.seed,
    );
    return {
      drawId: draw.id,
      seed: draw.seed,
      winnerEmail: again?.winner.email ?? null,
      ticket: again?.ticket ?? null,
      tickets: again?.tickets ?? 0,
      same: (again?.winner.email ?? null) === draw.winnerEmail,
    };
  }

  /** The mail queue (acrobot, 2026-11-05 22:57): what waits past the daily cap, today's mail and the cap. */
  async mailQueue() {
    const pending = await this.database.gameEntry.count({
      where: {
        mailPendingSince: { not: null },
        confirmedAt: null,
        question: { closesAt: { gt: new Date() } },
      },
    });
    return {
      pending,
      sentToday: await this.game.sentToday(),
      dailyCap: this.game.dailyCap(),
      ...this.game.mailStatus(),
      testLinks: this.game.testLinksOn(),
    };
  }

  /**
   * A CONFIRMATION LINK WITHOUT THE MAIL, FOR A TEST ROUND (acrobot 44026): on stage the round must be clickable to the
   * end even when the mail does not arrive. Only with JATEK_TEST_LINKS=on (never set in production), only for an
   * unconfirmed entry of an open question; the entry gets a new link (the mailed one stops working), audited.
   */
  async testLink(entryId: string, userId: string) {
    if (!this.game.testLinksOn())
      throw gameError(
        HttpStatus.FORBIDDEN,
        "TEST_LINKS_OFF",
        "Teszt-link csak a teszt környezetben adható (JATEK_TEST_LINKS=on, átirányított levelezés mellett).",
      );
    // a relative link would open on the OS's own site, not on the game page (barracuda, #2258)
    if (!this.game.publicUrlSet())
      throw gameError(
        HttpStatus.CONFLICT,
        "NO_PUBLIC_URL",
        "A játék oldalának címe (JATEK_PUBLIC_URL) nincs beállítva.",
      );
    const entry = await this.database.gameEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        confirmedAt: true,
        question: { select: { closesAt: true } },
      },
    });
    if (!entry || entry.confirmedAt || entry.question.closesAt <= new Date())
      throw gameError(
        HttpStatus.CONFLICT,
        "NOT_LINKABLE",
        "Teszt-link csak nyitott kérdés megerősítetlen beküldésére adható.",
      );
    const token = randomBytes(32).toString("base64url");
    await this.database.gameEntry.update({
      where: { id: entry.id },
      data: {
        confirmTokenHash: createHash("sha256").update(token).digest("hex"),
      },
    });
    await this.database.auditLog.create({
      data: {
        userId,
        action: "game.entry.test-link",
        entityType: "GameEntry",
        entityId: entry.id,
        metadata: {},
      },
    });
    return { link: this.game.confirmLink(token) };
  }

  /**
   * The waiting mails sent, oldest first, as far as today's cap lets them: each gets a new link (the old token is
   * replaced). It stops at the first one the cap queues again.
   */
  async sendQueued(userId: string) {
    // only a question still open: a closed week's link would answer CLOSED (barracuda, #2254 v3)
    const waiting = await this.database.gameEntry.findMany({
      where: {
        mailPendingSince: { not: null },
        confirmedAt: null,
        question: { closesAt: { gt: new Date() } },
      },
      orderBy: { mailPendingSince: "asc" },
      select: { id: true, email: true, question: { select: { week: true } } },
    });
    let sent = 0;
    for (const entry of waiting) {
      const token = randomBytes(32).toString("base64url");
      await this.database.gameEntry.update({
        where: { id: entry.id },
        data: {
          confirmTokenHash: createHash("sha256").update(token).digest("hex"),
        },
      });
      // the attempt counts only once the mail went out
      const outcome = await this.game.deliver(
        entry.id,
        entry.email,
        token,
        entry.question.week,
        true,
      );
      if (outcome !== "SENT") break;
      sent++;
    }
    await this.database.auditLog.create({
      data: {
        userId,
        action: "game.mail-queue.sent",
        entityType: "GameEntry",
        entityId: "mail-queue",
        metadata: { waiting: waiting.length, sent },
      },
    });
    return { sent, ...(await this.mailQueue()) };
  }
}

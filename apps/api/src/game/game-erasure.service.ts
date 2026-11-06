import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { GameDrawCandidate } from "@acropora/types";

import {
  GmailSentMailbox,
  type SentMailboxCapability,
} from "../notifications/mail/gmail-sent-mailbox.js";
import {
  CONFIRMATION_SUBJECT,
  LEGACY_CONFIRMATION_SUBJECTS,
} from "./game-confirmation-mail.js";
import { gameSmtpProblems } from "./game-smtp-mail.js";

/** What an erased address becomes: no "@", so it is never a player's address, and it marks the row as done. */
export const GAME_ERASED_PREFIX = "erased:";
/** The notice promises "at most 15 days after the grand prize draw"; the default lands a day inside it. */
export const GAME_ERASE_AFTER_DAYS_DEFAULT = 14;
export const GAME_ERASE_AFTER_DAYS_MAX = 15;
const DAY_MS = 86_400_000;
/** Gmail's batchDelete limit, and the step the progress is kept by. */
const MAIL_BATCH = 1000;

/**
 * JATEK_ERASE_MAIL=on: the sent mails are removed from the sender's mailbox; anything else (the default) only counts.
 * Kept OFF on stage while stage and production share the ticket@ key: a stage run would reach the production mailbox.
 */
export const gameEraseMailOn = (environment: NodeJS.ProcessEnv) =>
  environment.JATEK_ERASE_MAIL?.trim().toLowerCase() === "on";

export interface GameMailErasureResult {
  at: string;
  /** true when nothing was removed on purpose: a dry run, or the switch off */
  dryRun: boolean;
  enabled: boolean;
  capability: SentMailboxCapability["kind"];
  tracked: number;
  legacy: number;
  removed: number;
  /** the confirmation mails the game counted as sent (GameMailDay), an upper bound for tracked + legacy */
  sentByDays: number;
}
const CHUNK = 100;

const erased = (email: string | null) =>
  email !== null && email.startsWith(GAME_ERASED_PREFIX);

/** The notice's fixed date (acrobot 44381): the data goes by this day even if the grand prize draw is late or never runs. */
export const GAME_ERASE_DEADLINE_DEFAULT = "2027-01-10";

/** A Budapest day's first moment: "2027-01-10" -> 2027-01-09T23:00:00Z (the zone's offset on that day, not a fixed one). */
function budapestDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d);
  const shown = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(utcMidnight));
  return new Date(utcMidnight - Number(shown) * 3_600_000);
}

/**
 * THE FALLBACK DEADLINE (JATEK_ERASE_DEADLINE, a Budapest day, default 2027-01-10): the erasure runs from the start of
 * that day even without a grand prize draw. A malformed value falls back to the default and says so.
 */
export function gameEraseDeadline(value: string | undefined): {
  deadline: Date;
  error: string | null;
} {
  const day = value?.trim() || GAME_ERASE_DEADLINE_DEFAULT;
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (valid) return { deadline: budapestDayStart(day), error: null };
  return {
    deadline: budapestDayStart(GAME_ERASE_DEADLINE_DEFAULT),
    error: `JATEK_ERASE_DEADLINE=${day.slice(0, 20)} is not a day like ${GAME_ERASE_DEADLINE_DEFAULT}; using ${GAME_ERASE_DEADLINE_DEFAULT}`,
  };
}

/**
 * WHEN THE ERASURE IS DUE: the first Christmas draw (the grand prize draw) plus the days, or the fallback deadline,
 * whichever comes first. The public winner list ends at the same moment (the notice: the name and the masked address
 * come off the list then).
 */
export function gameErasureDueAt(
  draws: readonly { kind: string; createdAt: Date }[],
  afterDays: number,
  deadline: Date,
): { grand: Date | null; dueAt: Date } {
  let grand: Date | null = null;
  for (const draw of draws)
    if (draw.kind === "CHRISTMAS" && (!grand || draw.createdAt < grand))
      grand = draw.createdAt;
  const afterDraw = grand ? grand.getTime() + afterDays * DAY_MS : Infinity;
  return { grand, dueAt: new Date(Math.min(afterDraw, deadline.getTime())) };
}

export interface GameErasureEntry {
  id: string;
  questionId: string;
  email: string;
  name: string | null;
  answer: string;
  createdAt: Date;
}

export interface GameErasureDraw {
  id: string;
  kind: string;
  questionId: string | null;
  candidates: unknown;
  winnerEmail: string | null;
  createdAt: Date;
}

export interface GameErasurePlan {
  /** the first Christmas draw: the grand prize draw of the rules; null when it has not been run */
  grandDrawId: string | null;
  grandDrawAt: Date | null;
  /** when the erasure is due: the grand prize draw plus the configured days, or the fallback deadline if sooner */
  dueAt: Date;
  due: boolean;
  /** entries whose name, address and answer are erased */
  eraseEntryIds: string[];
  /** the winners' entries: name and address kept for the accounting (notice point 5), the answer cleared */
  winnerEntryIds: string[];
  /** draws whose kept candidate list (and a re-run's winner) gets placeholders */
  draws: {
    id: string;
    candidates: GameDrawCandidate[];
    winnerEmail: string | null;
  }[];
  /** the addresses kept as winners, counted (never listed: the log must not carry them) */
  keptWinners: number;
}

/**
 * THE PLAN, WITHOUT THE DATABASE (card bc0ca668). The privacy notice, point 4: the players' data is deleted at most 15
 * days after the grand prize draw; point 5: the winner's data is kept for the prize's accounting.
 *
 * THE GRAND PRIZE DRAW is the FIRST Christmas draw (the rules: a re-run never replaces the first recorded result). Until
 * it has run, and until `afterDays` have passed since, nothing is due.
 *
 * WHO IS A WINNER: the winner of the first draw of a week, and of the first Christmas draw, exactly as the public list
 * counts them (`GameService.winners`). Of a winner one entry is kept, the one the public list takes the name from: the
 * named entry of the won week, else the latest named one (the Christmas draw has no week), else the latest at all. Its
 * name and address stay, its answer goes (accounting needs the name, the address and the prize, not the answer). Every
 * other entry loses its name, address and answer; the row stays, so a week's counts stay, but it names no one.
 *
 * A KEPT DRAW stays repeatable: every address in its candidate list except its own winner's (when it is a first draw)
 * becomes a placeholder numbered by its place in the list, the weights and the order stay, and `verify` walks the list
 * in its kept order. A re-run draw is no one's result, so its winner becomes the same placeholder as in its list.
 *
 * ONE GAME ROUND: only entries of questions that had closed by the grand prize draw are touched, so the entries of a
 * question set up later are never erased by this round's draw.
 */
export function planGameErasure(input: {
  draws: readonly GameErasureDraw[];
  entries: readonly GameErasureEntry[];
  /** question id -> closing time */
  closesAt: ReadonlyMap<string, Date>;
  now: Date;
  afterDays: number;
  deadline: Date;
}): GameErasurePlan {
  const draws = [...input.draws].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const grand = draws.find((d) => d.kind === "CHRISTMAS") ?? null;
  const { dueAt } = gameErasureDueAt(draws, input.afterDays, input.deadline);
  const empty: GameErasurePlan = {
    grandDrawId: grand?.id ?? null,
    grandDrawAt: grand?.createdAt ?? null,
    dueAt,
    due: false,
    eraseEntryIds: [],
    winnerEntryIds: [],
    draws: [],
    keptWinners: 0,
  };
  if (input.now < dueAt) return empty;
  // the round: what had closed by the grand prize draw, or, without one, by the moment the erasure became due
  const cutoff = grand?.createdAt ?? dueAt;

  const firstOf = new Map<string, GameErasureDraw>();
  for (const draw of draws) {
    const key = `${draw.kind}:${draw.questionId ?? ""}`;
    if (!firstOf.has(key)) firstOf.set(key, draw);
  }
  const first = new Set([...firstOf.values()].map((d) => d.id));

  const inRound = input.entries
    .filter((e) => {
      const closes = input.closesAt.get(e.questionId);
      return closes !== undefined && closes <= cutoff;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const kept = new Set<string>();
  const winners = new Set<string>();
  for (const draw of firstOf.values()) {
    if (!draw.winnerEmail || erased(draw.winnerEmail)) continue;
    winners.add(draw.winnerEmail);
    const own = inRound.filter((e) => e.email === draw.winnerEmail);
    const named = own.filter((e) => e.name);
    const pick =
      named.find((e) => e.questionId === draw.questionId) ??
      named.at(-1) ??
      own.find((e) => e.questionId === draw.questionId) ??
      own.at(-1);
    if (pick) kept.add(pick.id);
  }

  const eraseEntryIds = inRound
    .filter((e) => !kept.has(e.id) && !erased(e.email))
    .map((e) => e.id);
  const winnerEntryIds = inRound
    .filter((e) => kept.has(e.id) && e.answer !== "")
    .map((e) => e.id);

  const planDraws: GameErasurePlan["draws"] = [];
  for (const draw of draws) {
    if (
      draw.questionId !== null &&
      !((input.closesAt.get(draw.questionId) ?? Infinity) <= cutoff)
    )
      continue;
    const keep = first.has(draw.id) ? draw.winnerEmail : null;
    const list = (draw.candidates as GameDrawCandidate[] | null) ?? [];
    const placeholder = new Map<string, string>();
    const candidates = list.map((c, i) => {
      if (c.email === keep || erased(c.email)) return c;
      const label = `${GAME_ERASED_PREFIX}${i + 1}`;
      placeholder.set(c.email, label);
      return { ...c, email: label };
    });
    const winnerEmail =
      draw.winnerEmail === null ||
      draw.winnerEmail === keep ||
      erased(draw.winnerEmail)
        ? draw.winnerEmail
        : (placeholder.get(draw.winnerEmail) ?? `${GAME_ERASED_PREFIX}winner`);
    if (placeholder.size > 0 || winnerEmail !== draw.winnerEmail)
      planDraws.push({ id: draw.id, candidates, winnerEmail });
  }

  return {
    ...empty,
    due: true,
    eraseEntryIds,
    winnerEntryIds,
    draws: planDraws,
    keptWinners: winners.size,
  };
}

/** The days after the grand prize draw (JATEK_ERASE_AFTER_DAYS): 0..15, default 14; anything else is refused. */
export function gameEraseAfterDays(value: string | undefined): {
  days: number;
  error: string | null;
} {
  if (!value?.trim())
    return { days: GAME_ERASE_AFTER_DAYS_DEFAULT, error: null };
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > GAME_ERASE_AFTER_DAYS_MAX
  )
    return {
      days: GAME_ERASE_AFTER_DAYS_DEFAULT,
      error: `JATEK_ERASE_AFTER_DAYS=${value.slice(0, 20)} is not a whole number of days between 0 and ${GAME_ERASE_AFTER_DAYS_MAX}; using ${GAME_ERASE_AFTER_DAYS_DEFAULT}`,
    };
  return { days: parsed, error: null };
}

export interface GameErasureResult {
  dryRun: boolean;
  grandDrawAt: string | null;
  dueAt: string;
  due: boolean;
  afterDays: number;
  entriesErased: number;
  winnerEntriesTrimmed: number;
  drawsAnonymised: number;
  keptWinners: number;
  /**
   * THE GRAND PRIZE DRAW IS LATE (barracuda, #2282): no Christmas draw, and the last question closed more than the days
   * ago. Said loudly on every run and in the preview: without the draw the erasure waits for the fallback deadline, and
   * a draw run after that would find only the kept winners.
   */
  waitingForGrandDraw: boolean;
}

/**
 * THE ERASURE (card bc0ca668), run by the scheduler and previewed by the admin. Idempotent: an erased row carries the
 * `erased:` address and is left alone, so a second run, or two instances at once, write nothing new. The writes go in
 * batches of a hundred; a run that fails half-way leaves erased rows erased, and the next run takes the rest. Every
 * run that wrote something leaves an audit row with the counts (never an address).
 */
@Injectable()
export class GameErasureService {
  private readonly logger = new Logger(GameErasureService.name);

  constructor(
    @Optional()
    @Inject(GmailSentMailbox)
    private readonly mailbox: Pick<
      GmailSentMailbox,
      "capability" | "findSent" | "remove"
    > | null = null,
  ) {}

  /** the test replaces them */
  database: Pick<
    typeof prisma,
    | "gameQuestion"
    | "gameEntry"
    | "gameDraw"
    | "gameMailDay"
    | "auditLog"
    | "$transaction"
  > = prisma;
  /** the last mail run's counts, for the admin's status row (the measured dry run before the switch goes on) */
  lastMailRun: GameMailErasureResult | null = null;
  now: () => Date = () => new Date();
  environment: NodeJS.ProcessEnv = process.env;

  afterDays(): number {
    const { days, error } = gameEraseAfterDays(
      this.environment.JATEK_ERASE_AFTER_DAYS,
    );
    if (error) this.logger.error(error);
    return days;
  }

  deadline(): Date {
    const { deadline, error } = gameEraseDeadline(
      this.environment.JATEK_ERASE_DEADLINE,
    );
    if (error) this.logger.error(error);
    return deadline;
  }

  async plan(): Promise<
    GameErasurePlan & { afterDays: number; lastClosesAt: Date | null }
  > {
    const afterDays = this.afterDays();
    const deadline = this.deadline();
    const [draws, questions, entries] = await Promise.all([
      this.database.gameDraw.findMany({
        select: {
          id: true,
          kind: true,
          questionId: true,
          candidates: true,
          winnerEmail: true,
          createdAt: true,
        },
      }),
      this.database.gameQuestion.findMany({
        select: { id: true, closesAt: true },
      }),
      this.database.gameEntry.findMany({
        select: {
          id: true,
          questionId: true,
          email: true,
          name: true,
          answer: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      ...planGameErasure({
        draws,
        entries,
        closesAt: new Map(questions.map((q) => [q.id, q.closesAt])),
        now: this.now(),
        afterDays,
        deadline,
      }),
      afterDays,
      lastClosesAt: questions.reduce<Date | null>(
        (last, q) => (!last || q.closesAt > last ? q.closesAt : last),
        null,
      ),
    };
  }

  async run(options: {
    dryRun: boolean;
    userId?: string | null;
  }): Promise<GameErasureResult> {
    const plan = await this.plan();
    const result: GameErasureResult = {
      dryRun: options.dryRun,
      grandDrawAt: plan.grandDrawAt?.toISOString() ?? null,
      dueAt: plan.dueAt.toISOString(),
      due: plan.due,
      afterDays: plan.afterDays,
      entriesErased: plan.eraseEntryIds.length,
      winnerEntriesTrimmed: plan.winnerEntryIds.length,
      drawsAnonymised: plan.draws.length,
      keptWinners: plan.keptWinners,
      waitingForGrandDraw:
        !plan.grandDrawAt &&
        plan.lastClosesAt !== null &&
        this.now().getTime() - plan.lastClosesAt.getTime() >
          plan.afterDays * DAY_MS,
    };
    const counts = `${result.entriesErased} entries erased, ${result.winnerEntriesTrimmed} winner entries without their answer, ${result.drawsAnonymised} draws anonymised, ${result.keptWinners} winners kept`;
    if (result.waitingForGrandDraw)
      this.logger.error(
        `Game data erasure: the grand prize draw has not run, the last question closed at ${plan.lastClosesAt!.toISOString()}, more than ${plan.afterDays} days ago; the erasure runs at ${result.dueAt} without it`,
      );
    if (!plan.due) {
      this.logger.log(`Game data erasure not due until ${result.dueAt}`);
      return result;
    }
    const nothing =
      result.entriesErased +
        result.winnerEntriesTrimmed +
        result.drawsAnonymised ===
      0;
    if (options.dryRun || nothing) {
      this.logger.log(
        `Game data erasure ${options.dryRun ? "dry run" : "has nothing left"}: ${counts}`,
      );
      return result;
    }

    const writes: Prisma.PrismaPromise<unknown>[] = [
      ...plan.eraseEntryIds.map((id) =>
        this.database.gameEntry.update({
          where: { id },
          data: { email: `${GAME_ERASED_PREFIX}${id}`, name: null, answer: "" },
        }),
      ),
      ...plan.winnerEntryIds.map((id) =>
        this.database.gameEntry.update({
          where: { id },
          data: { answer: "" },
        }),
      ),
      ...plan.draws.map((draw) =>
        this.database.gameDraw.update({
          where: { id: draw.id },
          data: {
            candidates: draw.candidates as unknown as Prisma.InputJsonValue,
            winnerEmail: draw.winnerEmail,
          },
        }),
      ),
    ];
    for (let i = 0; i < writes.length; i += CHUNK)
      await this.database.$transaction(writes.slice(i, i + CHUNK));
    await this.database.auditLog.create({
      data: {
        userId: options.userId ?? null,
        action: "game.data-erased",
        entityType: "GameDraw",
        entityId: plan.grandDrawId,
        metadata: {
          grandDrawAt: result.grandDrawAt,
          dueAt: result.dueAt,
          afterDays: result.afterDays,
          entriesErased: result.entriesErased,
          winnerEntriesTrimmed: result.winnerEntriesTrimmed,
          drawsAnonymised: result.drawsAnonymised,
          keptWinners: result.keptWinners,
        },
      },
    });
    this.logger.log(`Game data erasure done: ${counts}`);
    return result;
  }

  /** The mails of the questions that have closed: their link is no use any more. */
  private async closedQuestions() {
    const now = this.now();
    const closed = await this.database.gameQuestion.findMany({
      where: { closesAt: { lte: now } },
      select: { id: true, closesAt: true },
    });
    return {
      ids: closed.map((q) => q.id),
      lastClosesAt: closed.reduce<Date | null>(
        (last, q) => (!last || q.closesAt > last ? q.closesAt : last),
        null,
      ),
    };
  }

  /**
   * The admin's status row: what the sender's key may do, whether the removal is switched on, how many tracked mails of
   * closed weeks are left, and the last scheduled run's counts (no mailbox search here).
   */
  async mailStatus(): Promise<{
    /**
     * WHERE THE GAME SENDS NOW (acrobot 44558): BREVO when its own SMTP sender is set (jatek@). Then the new mails are not in
     * the ticket@ mailbox at all, and the capability below concerns only what left ticket@ before the switch.
     */
    gameSender: "BREVO" | "NOT_CONFIGURED";
    capability: SentMailboxCapability;
    enabled: boolean;
    tracked: number;
    lastRun: GameMailErasureResult | null;
  }> {
    const capability = this.mailbox
      ? await this.mailbox.capability()
      : ({ kind: "NOT_CONFIGURED" } as const);
    const { ids } = await this.closedQuestions();
    const rows = ids.length
      ? await this.database.gameEntry.findMany({
          where: { questionId: { in: ids }, sentMailIds: { isEmpty: false } },
          select: { sentMailIds: true },
        })
      : [];
    return {
      gameSender:
        gameSmtpProblems(this.environment).length === 0
          ? "BREVO"
          : "NOT_CONFIGURED",
      capability,
      enabled: gameEraseMailOn(this.environment),
      tracked: rows.reduce((sum, r) => sum + r.sentMailIds.length, 0),
      lastRun: this.lastMailRun,
    };
  }

  /**
   * THE SENT COPIES OUT OF THE SENDER'S MAILBOX (card jatek-level-torles; the notice: by 2027-01-10). Every run, not
   * only when the data erasure is due: a confirmation mail is no use once its question has closed, and with a trash-only
   * key the Trash keeps a mail 30 more days, so the sooner the better.
   *
   * WHICH MAILS: those of the questions that have closed, and only those (an open question's link is still in use).
   * Exactly by the Gmail ids the send recorded on the entry, and, for the mails sent before the ids were kept, the sent
   * mails whose Subject is exactly the confirmation subject and that went out by the last closing (the weeks do not
   * overlap: a mail sent before a closing belongs to a closed week). Each subject hit is checked against its header.
   *
   * With the full scope the mails go for good, with gmail.modify to the Trash; with neither nothing happens, and the
   * admin's status row says so. Idempotent: a removed mail's id leaves the entry, a removed mail is no longer found.
   * One audit row with counts per run that removed something; never an address or a subject in the log.
   */
  async eraseMail(options: {
    dryRun: boolean;
    userId?: string | null;
  }): Promise<GameMailErasureResult> {
    const capability = this.mailbox
      ? await this.mailbox.capability()
      : ({ kind: "NOT_CONFIGURED" } as const);
    // THE MAILBOX IS A DECISION OF ITS OWN (barracuda, #2288): without JATEK_ERASE_MAIL=on a run only counts. Removal
    // with the full scope cannot be undone, and the older mails' subject match has to be seen on the real mailbox first
    const enabled = gameEraseMailOn(this.environment);
    const countOnly = options.dryRun || !enabled;
    const result: GameMailErasureResult = {
      at: this.now().toISOString(),
      dryRun: countOnly,
      enabled,
      capability: capability.kind,
      tracked: 0,
      legacy: 0,
      removed: 0,
      // an upper bound for the measurement: every confirmation mail the game counted as sent, all days together
      sentByDays: (
        await this.database.gameMailDay.findMany({ select: { sent: true } })
      ).reduce((sum, d) => sum + d.sent, 0),
    };
    const done = (r: GameMailErasureResult) => (this.lastMailRun = r);
    const { ids: closedIds, lastClosesAt } = await this.closedQuestions();
    const entries = closedIds.length
      ? await this.database.gameEntry.findMany({
          where: {
            questionId: { in: closedIds },
            sentMailIds: { isEmpty: false },
          },
          select: { id: true, sentMailIds: true },
        })
      : [];
    const tracked = new Set(entries.flatMap((e) => e.sentMailIds));
    result.tracked = tracked.size;
    if (capability.kind !== "DELETE" && capability.kind !== "TRASH") {
      if (tracked.size > 0 || capability.kind === "ERROR")
        this.logger.warn(
          `Game mail erasure cannot remove the sent mails: the sender's key is ${capability.kind}${capability.kind === "ERROR" ? ` (${capability.code})` : ""}, ${tracked.size} tracked mails wait`,
        );
      return done(result);
    }
    if (!lastClosesAt || !this.mailbox) return done(result);
    // by the current subject AND the older ones: the mails that left the sender's mailbox under a subject we have since
    // rewritten are still there (the test mails before the game opened)
    const found = new Set<string>();
    for (const subject of [
      CONFIRMATION_SUBJECT,
      ...LEGACY_CONFIRMATION_SUBJECTS,
    ])
      for (const id of await this.mailbox.findSent(subject, lastClosesAt))
        found.add(id);
    const legacy = [...found].filter((id) => !tracked.has(id));
    result.legacy = legacy.length;
    const all = [...tracked, ...legacy];
    if (countOnly || all.length === 0) {
      if (all.length > 0 || countOnly)
        this.logger.log(
          `Game mail erasure ${enabled ? "dry run" : "switched off (JATEK_ERASE_MAIL)"}: ${result.tracked} tracked and ${result.legacy} older sent mails would go (${capability.kind}); the game counted ${result.sentByDays} confirmation mails sent`,
        );
      return done(result);
    }
    // BATCH BY BATCH, THE PROGRESS KEPT (barracuda, #2288): a batch that went is taken off the entries before the next
    // one, so a run that fails half-way never sends an id it removed already to Gmail again
    const gone = new Set<string>();
    try {
      for (let i = 0; i < all.length; i += MAIL_BATCH) {
        const batch = all.slice(i, i + MAIL_BATCH);
        result.removed += await this.mailbox.remove(batch, capability.kind);
        for (const id of batch) gone.add(id);
        // an entry whose ids straddle two batches keeps only the ones not removed yet (barracuda, #2288): a removed id
        // is never sent to Gmail again, so a batchDelete that refuses unknown ids cannot stop every later run
        const touched = entries.filter((e) =>
          e.sentMailIds.some((id) => gone.has(id)),
        );
        const left = new Map(
          touched.map((e) => [
            e.id,
            e.sentMailIds.filter((id) => !gone.has(id)),
          ]),
        );
        const writes = touched.map((e) =>
          this.database.gameEntry.update({
            where: { id: e.id },
            data: { sentMailIds: left.get(e.id)! },
          }),
        );
        for (let j = 0; j < writes.length; j += CHUNK)
          await this.database.$transaction(writes.slice(j, j + CHUNK));
        for (const e of touched) e.sentMailIds = left.get(e.id)!;
      }
    } finally {
      if (result.removed > 0)
        await this.database.auditLog.create({
          data: {
            userId: options.userId ?? null,
            action: "game.mail-erased",
            entityType: "GameEntry",
            entityId: "sent-mail",
            metadata: {
              mode: capability.kind,
              tracked: result.tracked,
              legacy: result.legacy,
              removed: result.removed,
            },
          },
        });
      done(result);
    }
    this.logger.log(
      `Game mail erasure done: ${result.removed} sent mails ${capability.kind === "DELETE" ? "deleted" : "moved to the Trash"} (${result.tracked} tracked, ${result.legacy} older)`,
    );
    return result;
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { GameDrawCandidate } from "@acropora/types";

/** What an erased address becomes: no "@", so it is never a player's address, and it marks the row as done. */
export const GAME_ERASED_PREFIX = "erased:";
/** The notice promises "at most 15 days after the grand prize draw"; the default lands a day inside it. */
export const GAME_ERASE_AFTER_DAYS_DEFAULT = 14;
export const GAME_ERASE_AFTER_DAYS_MAX = 15;
const DAY_MS = 86_400_000;
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
  /** the test replaces them */
  database: Pick<
    typeof prisma,
    "gameQuestion" | "gameEntry" | "gameDraw" | "auditLog" | "$transaction"
  > = prisma;
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
}

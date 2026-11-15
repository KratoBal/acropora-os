import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  CONTENT_RESULT_FIELDS,
  isMachineRole,
  type ContentResultValues,
  type ContentResults,
  type ContentResultsSummary,
  type UserRole,
} from "@acropora/types";

import {
  budapestDayKey,
  startOfBudapestDay,
} from "../../dashboard/budapest-day.js";
import { ContentResultsRepository } from "./content-results.repository.js";
import { sumWeeks, summarize } from "./content-results.view.js";

export const CONTENT_RESULTS_CLOCK = Symbol("CONTENT_RESULTS_CLOCK");

const NOT_FOUND = "A tartalom nem található.";
const NOT_SENT =
  "Eredményt csak kiment tételhez lehet felvinni: ez a tétel még nem ment ki.";
const NOT_MONDAY = "A hét a hétfőjével adható meg (ÉÉÉÉ-HH-NN, hétfő).";
const OUT_OF_RANGE =
  "A hét nem lehet a kiküldés hete előtt, és nem lehet a mostani hét után.";
const EMPTY = "Adj meg legalább egy számot.";
const MACHINE =
  "Az eredményt ember viszi fel: gépi fiók nem írhatja (a csatorna statisztikájának bekötése külön döntés).";
const BAD_RANGE =
  "A from és a to egy-egy hónap (ÉÉÉÉ-HH), a to nem lehet a from előtt, és legfeljebb 12 hónap.";

const DAY_MS = 86_400_000;
const monday = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
};
const isRealDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
  );
};

/**
 * THE CONTENT'S RESULTS (T5.5 S8, spec 4.): a sent item's numbers per Budapest week, entered by a person (the channels'
 * statistics are not connected; that is a separate decision), the sums on the item, and the summary view.
 */
@Injectable()
export class ContentResultsService {
  constructor(
    private readonly repository: ContentResultsRepository,
    @Optional()
    @Inject(CONTENT_RESULTS_CLOCK)
    private readonly clock?: () => Date,
  ) {}

  private now() {
    return (this.clock ?? (() => new Date()))();
  }

  async results(contentId: string): Promise<ContentResults> {
    const item = await this.repository.item(contentId);
    if (!item) throw new NotFoundException(NOT_FOUND);
    const weeks = await this.repository.weeks(contentId);
    return {
      contentId,
      sentAt: item.sentAt?.toISOString() ?? null,
      weeks,
      totals: sumWeeks(weeks),
    };
  }

  async saveWeek(
    contentId: string,
    weekStart: string,
    input: Partial<ContentResultValues>,
    actor: { id: string; role: UserRole },
  ): Promise<ContentResults> {
    if (isMachineRole(actor.role)) throw new ForbiddenException(MACHINE);
    const item = await this.repository.item(contentId);
    if (!item) throw new NotFoundException(NOT_FOUND);
    if (!item.sentAt) throw new BadRequestException(NOT_SENT);
    if (!isRealDay(weekStart) || monday(weekStart) !== weekStart)
      throw new BadRequestException(NOT_MONDAY);
    const first = monday(budapestDayKey(item.sentAt));
    const current = monday(budapestDayKey(this.now()));
    if (weekStart < first || weekStart > current)
      throw new BadRequestException(OUT_OF_RANGE);
    const values: ContentResultValues = {
      reach: input.reach ?? null,
      reactions: input.reactions ?? null,
      opens: input.opens ?? null,
      clicks: input.clicks ?? null,
      preorders: input.preorders ?? null,
      orders: input.orders ?? null,
    };
    if (CONTENT_RESULT_FIELDS.every((field) => values[field] === null))
      throw new BadRequestException(EMPTY);
    await this.repository.saveWeek(contentId, weekStart, values, actor.id);
    return this.results(contentId);
  }

  async summary(from: string, to: string): Promise<ContentResultsSummary> {
    const [fy, fm] = from.split("-").map(Number) as [number, number];
    const [ty, tm] = to.split("-").map(Number) as [number, number];
    const span = (ty - fy) * 12 + (tm - fm);
    if (fm < 1 || fm > 12 || tm < 1 || tm > 12 || span < 0 || span > 11)
      throw new BadRequestException(BAD_RANGE);
    const noon = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1, 12));
    const start = startOfBudapestDay(noon(fy, fm));
    const end = startOfBudapestDay(
      noon(ty + Math.floor(tm / 12), (tm % 12) + 1),
    );
    return summarize(from, to, await this.repository.sentBetween(start, end));
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { CALENDAR_EVENT_LIMITS, type CalendarEvent } from "@acropora/types";

import type {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from "./calendar-event.dto.js";
import {
  CalendarEventRepository,
  type CalendarEventWrite,
} from "./calendar-event.repository.js";
import { calendarDate } from "./calendar-range.js";

const NOT_FOUND = "Az esemény nem található.";
const CHANGED =
  "Az eseményt közben valaki módosította: töltsd újra, és vidd át a változtatást.";
const BAD_TITLE = "Adj meg egy címet.";
const BAD_DAY = "A dátum nem létező nap.";
const REVERSED = "Az esemény vége nem lehet a kezdete előtt.";
const TOO_LONG = `Egy esemény legfeljebb ${CALENDAR_EVENT_LIMITS.days.max} napos lehet.`;
const NO_USER =
  "A felelősnek kiválasztott felhasználó nem található, vagy nem aktív.";

const DAY_MS = 86_400_000;

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * THE HAND-ENTERED CALENDAR EVENTS (T5.5 S2): a shop event or a holiday, written by the people who plan content
 * (`content.manage`), read on the calendar feed. The rules live here once, for create and update.
 */
@Injectable()
export class CalendarEventService {
  constructor(private readonly repository: CalendarEventRepository) {}

  async get(id: string): Promise<CalendarEvent> {
    const found = await this.repository.get(id);
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  async create(
    input: CreateCalendarEventDto,
    actorUserId: string | null,
  ): Promise<CalendarEvent> {
    const data = await this.checked(
      {
        kind: input.kind,
        title: input.title,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? input.startsOn,
        location: input.location ?? null,
        responsibleUserId: input.responsibleUserId ?? null,
      },
      null,
    );
    return this.repository.create(data, actorUserId);
  }

  async update(
    id: string,
    patch: UpdateCalendarEventDto,
    actorUserId: string | null,
  ): Promise<CalendarEvent> {
    const current = await this.repository.get(id);
    if (!current) throw new NotFoundException(NOT_FOUND);
    if (
      patch.expectedUpdatedAt !== undefined &&
      new Date(patch.expectedUpdatedAt).getTime() !==
        new Date(current.updatedAt).getTime()
    )
      throw new ConflictException(CHANGED);
    const data = await this.checked(
      {
        kind: patch.kind ?? current.kind,
        title: patch.title ?? current.title,
        startsOn: patch.startsOn ?? current.startsOn,
        endsOn: patch.endsOn ?? current.endsOn,
        location:
          patch.location === undefined ? current.location : patch.location,
        responsibleUserId:
          patch.responsibleUserId === undefined
            ? (current.responsible?.id ?? null)
            : patch.responsibleUserId,
      },
      current.responsible?.id ?? null,
    );
    const updated = await this.repository.update(
      id,
      data,
      current.updatedAt,
      actorUserId,
    );
    if (updated === "changed") throw new ConflictException(CHANGED);
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return updated;
  }

  async delete(id: string, actorUserId: string | null): Promise<void> {
    if (!(await this.repository.delete(id, actorUserId)))
      throw new NotFoundException(NOT_FOUND);
  }

  /**
   * A title with something in it, two real days in order, at most `days.max` days long, and a responsible person who
   * is an active user. `storedResponsible` is the one already on the record: an unchanged one is not asked again (a
   * colleague who left since would otherwise make an unrelated edit fail).
   */
  private async checked(
    data: CalendarEventWrite,
    storedResponsible: string | null,
  ): Promise<CalendarEventWrite> {
    const title = data.title.trim();
    if (title.length < CALENDAR_EVENT_LIMITS.title.min)
      throw new BadRequestException(BAD_TITLE);
    const starts = calendarDate(data.startsOn);
    const ends = calendarDate(data.endsOn);
    if (!starts || !ends) throw new BadRequestException(BAD_DAY);
    if (ends < starts) throw new BadRequestException(REVERSED);
    if (
      (ends.getTime() - starts.getTime()) / DAY_MS + 1 >
      CALENDAR_EVENT_LIMITS.days.max
    )
      throw new BadRequestException(TOO_LONG);
    if (
      data.responsibleUserId &&
      data.responsibleUserId !== storedResponsible &&
      !(await this.repository.activeUser(data.responsibleUserId))
    )
      throw new BadRequestException(NO_USER);
    return { ...data, title, location: clean(data.location) };
  }
}

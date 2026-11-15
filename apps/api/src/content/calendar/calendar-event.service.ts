import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  CALENDAR_EVENT_LIMITS,
  isMachineRole,
  type CalendarEvent,
  type CalendarEventResponsibleOption,
  type UserRole,
} from "@acropora/types";

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
  "A felelősnek kiválasztott felhasználó nem található, nem aktív, vagy nem tartalom-kezelő kolléga.";
const MACHINE =
  "Bolti eseményt és ünnepet ember visz fel: gépi fiók nem hozhat létre, nem módosíthat és nem törölhet ilyet.";

/** Who writes: the role decides whether the write is allowed at all (a machine account may not). */
export interface CalendarEventActor {
  id: string;
  role: UserRole;
}

const DAY_MS = 86_400_000;

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * THE HAND-ENTERED CALENDAR EVENTS (T5.5 S2): a shop event or a holiday, written by the people who plan content
 * (`content.manage`), read on the calendar feed. The rules live here once, for create and update.
 *
 * A MACHINE ACCOUNT MAY READ, NOT WRITE (acrobot 53159, 2026-11-15): a shop event or a holiday is a business fact a
 * person enters. The content agent holds `content.manage` for its own items, and that permission alone would let it
 * create, edit and delete these too; the role check below is what keeps it out.
 */
@Injectable()
export class CalendarEventService {
  constructor(private readonly repository: CalendarEventRepository) {}

  async get(id: string): Promise<CalendarEvent> {
    const found = await this.repository.get(id);
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  /** The people the form offers as responsible: the same set the write accepts. */
  responsibleOptions(): Promise<CalendarEventResponsibleOption[]> {
    return this.repository.responsibleCandidates();
  }

  async create(
    input: CreateCalendarEventDto,
    actor: CalendarEventActor,
  ): Promise<CalendarEvent> {
    this.humanOnly(actor);
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
    return this.repository.create(data, actor.id);
  }

  async update(
    id: string,
    patch: UpdateCalendarEventDto,
    actor: CalendarEventActor,
  ): Promise<CalendarEvent> {
    this.humanOnly(actor);
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
      actor.id,
    );
    if (updated === "changed") throw new ConflictException(CHANGED);
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return updated;
  }

  async delete(id: string, actor: CalendarEventActor): Promise<void> {
    this.humanOnly(actor);
    if (!(await this.repository.delete(id, actor.id)))
      throw new NotFoundException(NOT_FOUND);
  }

  private humanOnly(actor: CalendarEventActor): void {
    if (isMachineRole(actor.role)) throw new ForbiddenException(MACHINE);
  }

  /**
   * A title with something in it, two real days in order, at most `days.max` days long, and a responsible person who
   * is one the form offers (active, a person, sees content). `storedResponsible` is the one already on the record: an unchanged one is not asked again (a
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
      !(await this.repository.responsibleCandidate(data.responsibleUserId))
    )
      throw new BadRequestException(NO_USER);
    return { ...data, title, location: clean(data.location) };
  }
}

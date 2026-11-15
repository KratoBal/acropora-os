import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  CONTENT_TEMPLATE_LIMITS,
  CONTENT_TEMPLATE_ONE_DAY_KINDS,
  isMachineRole,
  type ContentTemplateRule,
} from "@acropora/types";

import type { CalendarEventActor } from "./calendar-event.service.js";
import type {
  CreateContentTemplateRuleDto,
  UpdateContentTemplateRuleDto,
} from "./content-template.dto.js";
import {
  ContentTemplateRepository,
  type ContentTemplateRuleWrite,
} from "./content-template.repository.js";

const NOT_FOUND = "A sablon sora nem található.";
const CHANGED =
  "A sablon sorát közben valaki módosította: töltsd újra, és vidd át a változtatást.";
const BAD_LABEL = "Adj meg egy megnevezést (mi a tartalom).";
const ONE_DAY =
  "Az érkezésnek egy napja van: a sor a kezdethez igazodik, a véghez nem.";
const MACHINE =
  "A tartalomnaptár sablonját ember állítja: gépi fiók nem hozhat létre és nem módosíthat sort.";

/**
 * THE DEPENDENCY TEMPLATE (T5.5 S4): the days are data Balázs and Luca change, read by anyone who sees content,
 * written by the people who plan it (`content.manage`). A machine account reads, it does not write: the same rule as
 * the hand-entered events (acrobot 53159), for the same reason, the template is a business decision. No delete: a row
 * the slots of S5 point to is switched off.
 */
@Injectable()
export class ContentTemplateService {
  constructor(private readonly repository: ContentTemplateRepository) {}

  list(): Promise<ContentTemplateRule[]> {
    return this.repository.list();
  }

  async create(
    input: CreateContentTemplateRuleDto,
    actor: CalendarEventActor,
  ): Promise<ContentTemplateRule> {
    this.humanOnly(actor);
    return this.repository.create(
      this.checked({
        eventKind: input.eventKind,
        label: input.label,
        channel: input.channel,
        anchor: input.anchor ?? "START",
        offsetDays: input.offsetDays,
        active: input.active ?? true,
      }),
      actor.id,
    );
  }

  async update(
    id: string,
    patch: UpdateContentTemplateRuleDto,
    actor: CalendarEventActor,
  ): Promise<ContentTemplateRule> {
    this.humanOnly(actor);
    const current = await this.repository.get(id);
    if (!current) throw new NotFoundException(NOT_FOUND);
    if (
      patch.expectedUpdatedAt !== undefined &&
      new Date(patch.expectedUpdatedAt).getTime() !==
        new Date(current.updatedAt).getTime()
    )
      throw new ConflictException(CHANGED);
    const updated = await this.repository.update(
      id,
      this.checked({
        eventKind: current.eventKind,
        label: patch.label ?? current.label,
        channel: patch.channel ?? current.channel,
        anchor: patch.anchor ?? current.anchor,
        offsetDays: patch.offsetDays ?? current.offsetDays,
        active: patch.active ?? current.active,
      }),
      current.updatedAt,
      actor.id,
    );
    if (updated === "changed") throw new ConflictException(CHANGED);
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return updated;
  }

  private humanOnly(actor: CalendarEventActor): void {
    if (isMachineRole(actor.role)) throw new ForbiddenException(MACHINE);
  }

  /** A label with something in it, and the end anchor only where the event has an end of its own. */
  private checked(data: ContentTemplateRuleWrite): ContentTemplateRuleWrite {
    const label = data.label.trim();
    if (label.length < CONTENT_TEMPLATE_LIMITS.label.min)
      throw new BadRequestException(BAD_LABEL);
    if (
      data.anchor === "END" &&
      CONTENT_TEMPLATE_ONE_DAY_KINDS.includes(data.eventKind)
    )
      throw new BadRequestException(ONE_DAY);
    return { ...data, label };
  }
}

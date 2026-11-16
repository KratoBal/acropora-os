import { Matches } from "class-validator";

/** Two Budapest days, both included; the service refuses an impossible day, a reversed range and a too wide one. */
export class ContentCalendarFeedQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

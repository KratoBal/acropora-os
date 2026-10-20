import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  parseHomepageContentInput,
  type HomepageContent,
  type HomepageContentInput,
  type HomepageSlide,
} from "@acropora/types";

export const HOMEPAGE_CONTENT_STORE = Symbol("HOMEPAGE_CONTENT_STORE");
export const HOMEPAGE_CONTENT_PROJECTOR = Symbol("HOMEPAGE_CONTENT_PROJECTOR");

/** The only record today; another key would be another home page variant. */
export const MAIN_HOMEPAGE_KEY = "main";

export interface HomepageContentRow {
  key: string;
  texts: unknown;
  slides: unknown;
  updatedAt: Date;
}

export interface HomepageContentStore {
  find(key: string): Promise<HomepageContentRow | null>;
  /** The whole record, one transaction. */
  save(
    key: string,
    input: HomepageContentInput,
    userId: string,
  ): Promise<HomepageContentRow>;
}

/**
 * What happened to the projection after a save: `off` (the round is switched
 * off in this environment), `sent`, `unchanged`, or `failed` (the save is kept,
 * the scheduled round tries again).
 */
export type HomepageProjectionResult = "off" | "sent" | "unchanged" | "failed";
export type HomepageContentProjector = () => Promise<HomepageProjectionResult>;

/** The stored record, read defensively: a hand-edited row cannot break a read. */
export function toHomepageContent(
  row: HomepageContentRow | null,
): HomepageContent {
  if (!row) return { texts: {}, slides: null, updatedAt: null };
  const texts: Record<string, string> = {};
  if (typeof row.texts === "object" && row.texts !== null)
    for (const [key, value] of Object.entries(row.texts))
      if (typeof value === "string") texts[key] = value;
  return {
    texts,
    slides: Array.isArray(row.slides) ? (row.slides as HomepageSlide[]) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * THE HOME PAGE CONTENT (Balázs, 2026-10-20). The OS owns it; the Medusa
 * projection writes it to the commerce `homepage_content` module (#551), and a
 * save asks for one projection round at once, so an edit does not wait for the
 * scheduler's hour. The projection failing never fails the save.
 */
@Injectable()
export class HomepageContentService {
  constructor(
    @Inject(HOMEPAGE_CONTENT_STORE)
    private readonly store: HomepageContentStore,
    @Inject(HOMEPAGE_CONTENT_PROJECTOR)
    private readonly project: HomepageContentProjector,
  ) {}

  async get(): Promise<HomepageContent> {
    return toHomepageContent(await this.store.find(MAIN_HOMEPAGE_KEY));
  }

  async save(
    body: unknown,
    userId: string,
  ): Promise<{
    content: HomepageContent;
    projection: HomepageProjectionResult;
  }> {
    const parsed = parseHomepageContentInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const row = await this.store.save(MAIN_HOMEPAGE_KEY, parsed.value, userId);
    let projection: HomepageProjectionResult;
    try {
      projection = await this.project();
    } catch {
      projection = "failed";
    }
    return { content: toHomepageContent(row), projection };
  }
}

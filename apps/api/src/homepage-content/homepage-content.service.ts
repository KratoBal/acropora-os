import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseHomepageContentInput,
  type HomepageContent,
  type HomepageContentInput,
  type HomepageSlide,
} from "@acropora/types";

import {
  detectImageContentType,
  imageFileNameFor,
} from "../integrations/medusa/image-content-type.js";

export const HOMEPAGE_CONTENT_STORE = Symbol("HOMEPAGE_CONTENT_STORE");
export const HOMEPAGE_CONTENT_PROJECTOR = Symbol("HOMEPAGE_CONTENT_PROJECTOR");
export const HOMEPAGE_IMAGE_UPLOADER = Symbol("HOMEPAGE_IMAGE_UPLOADER");

/** A hero or band image: the web shop's own formats, at most 8 MB. */
export const HOMEPAGE_IMAGE_LIMITS = {
  bytes: 8 * 1024 * 1024,
  types: ["image/jpeg", "image/png", "image/webp"],
} as const;

export interface HomepageImageUpload {
  fileName: string;
  contentType: string;
  content: Buffer;
}

/**
 * Puts the image on the shop's file storage and returns its public address.
 * `null` means the shop is switched off in this environment (the same flag as
 * the projection: an upload is a write to the shop too).
 */
export type HomepageImageUploader = (
  image: HomepageImageUpload,
) => Promise<{ url: string } | null>;

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
    @Inject(HOMEPAGE_IMAGE_UPLOADER)
    private readonly uploadToShop: HomepageImageUploader,
  ) {}

  /**
   * An editor's image upload. The type comes from the BYTES (a file named
   * .jpg that is something else is refused, and the shop never sees a name
   * that lies about its content), and the address that comes back is what the
   * editor puts into an image field.
   */
  async uploadImage(file: {
    originalname: string;
    buffer: Buffer;
  }): Promise<{ url: string }> {
    if (!file.buffer.length)
      throw new BadRequestException("A feltöltött kép üres.");
    if (file.buffer.length > HOMEPAGE_IMAGE_LIMITS.bytes)
      throw new BadRequestException("A kép legfeljebb 8 MB lehet.");
    const contentType = detectImageContentType(file.buffer);
    if (
      contentType === null ||
      !(HOMEPAGE_IMAGE_LIMITS.types as readonly string[]).includes(contentType)
    )
      throw new BadRequestException(
        "Csak JPEG, PNG vagy WebP kép tölthető fel (a fájl tartalma dönt, nem a neve).",
      );
    const uploaded = await this.uploadToShop({
      fileName: imageFileNameFor(file.originalname, contentType),
      contentType,
      content: file.buffer,
    });
    if (!uploaded)
      throw new ServiceUnavailableException(
        "A webshopba küldés ebben a környezetben ki van kapcsolva, a kép nem tölthető fel.",
      );
    return uploaded;
  }

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

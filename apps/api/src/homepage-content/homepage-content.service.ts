import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseHomepageContentInput,
  type HomepageContent,
  type HomepageContentInput,
  type HomepageSlide,
} from "@acropora/types";

import { detectImageContentType } from "../integrations/medusa/image-content-type.js";

export const HOMEPAGE_CONTENT_STORE = Symbol("HOMEPAGE_CONTENT_STORE");
export const HOMEPAGE_CONTENT_PROJECTOR = Symbol("HOMEPAGE_CONTENT_PROJECTOR");
export const HOMEPAGE_IMAGE_UPLOADER = Symbol("HOMEPAGE_IMAGE_UPLOADER");
export const HOMEPAGE_ENVIRONMENT = Symbol("HOMEPAGE_ENVIRONMENT");

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
 * The service calls it only where the projection is switched on (an upload is
 * a write to the shop too).
 */
export type HomepageImageUploader = (
  image: HomepageImageUpload,
) => Promise<{ url: string }>;

/** The extension of what the bytes are; the editor's own file name is never used. */
const EXTENSION = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

/** The "Egyedi korallok" band shows at most this many (commerce #555). */
export const HOMEPAGE_FEATURED_MAX = 12;

export interface HomepageFeaturedRow {
  productId: string;
  name: string;
  sortOrder: number;
}

/** The only record today; another key would be another home page variant. */
export const MAIN_HOMEPAGE_KEY = "main";

export interface HomepageContentRow {
  key: string;
  texts: unknown;
  slides: unknown;
  projectionEnabled: boolean;
  updatedAt: Date;
}

export interface HomepageContentStore {
  find(key: string): Promise<HomepageContentRow | null>;
  /** The administrator's switch, one row write (the row is created if missing). */
  setProjection(
    key: string,
    enabled: boolean,
    userId: string,
  ): Promise<HomepageContentRow>;
  /** The products marked for the band, in order. */
  featuredList(): Promise<HomepageFeaturedRow[]>;
  /**
   * Marks or unmarks one product. `unknown-product`: no such product; `full`:
   * marking would exceed `max` (an already marked product is never "full").
   */
  setFeatured(
    productId: string,
    featured: boolean,
    userId: string,
    max: number,
  ): Promise<"ok" | "unknown-product" | "full">;
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
/** One round; the service asks for it only where the projection is switched on. */
export type HomepageContentProjector = () => Promise<"sent" | "unchanged">;

/**
 * DOES THIS ENVIRONMENT ALLOW WRITING TO THE WEB SHOP: the
 * `MEDUSA_PROJECT_HOMEPAGE_CONTENT=true` variable. The commerce exception is
 * for the TEST shop only; the production OS has the variable off, and an
 * administrator's switch there must not be able to write into the Medusa the
 * production OS points at (acrobot 33495, barracuda #1721).
 */
export function homepageProjectionAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.MEDUSA_PROJECT_HOMEPAGE_CONTENT === "true";
}

/**
 * IS THE PROJECTION ON HERE: the environment allows it AND the administrator's
 * switch is on (an AND, not an OR: a missing variable makes the switch inert).
 */
export function homepageProjectionOn(
  env: NodeJS.ProcessEnv,
  row: Pick<HomepageContentRow, "projectionEnabled"> | null,
): boolean {
  return homepageProjectionAllowed(env) && row?.projectionEnabled === true;
}

/** The stored record, read defensively: a hand-edited row cannot break a read. */
export function toHomepageContent(
  row: HomepageContentRow | null,
  projectionAllowed = false,
): HomepageContent {
  if (!row)
    return {
      texts: {},
      slides: null,
      updatedAt: null,
      projectionEnabled: false,
      projectionAllowed,
    };
  const texts: Record<string, string> = {};
  if (typeof row.texts === "object" && row.texts !== null)
    for (const [key, value] of Object.entries(row.texts))
      if (typeof value === "string") texts[key] = value;
  return {
    texts,
    slides: Array.isArray(row.slides) ? (row.slides as HomepageSlide[]) : null,
    updatedAt: row.updatedAt.toISOString(),
    projectionEnabled: row.projectionEnabled === true,
    projectionAllowed,
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
    @Inject(HOMEPAGE_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv,
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
    const row = await this.store.find(MAIN_HOMEPAGE_KEY);
    if (!homepageProjectionOn(this.environment, row))
      throw new ServiceUnavailableException(
        "A webshopba küldés ki van kapcsolva vagy ebben a környezetben nincs engedélyezve, a kép nem tölthető fel.",
      );
    /*
      THE NAME IS OURS, NOT THE EDITOR'S (barracuda, #1721). The browser's
      `originalname` is client data: a hand-built request can send
      "../../x.png" or "a\\b.png", and the shop's local file provider joins the
      directory part of a name to its upload folder. Nothing of it goes on: a
      random name and the extension of what the bytes are.
    */
    return this.uploadToShop({
      fileName: `kezdolap-${randomUUID()}${EXTENSION[contentType as keyof typeof EXTENSION]}`,
      contentType,
      content: file.buffer,
    });
  }

  /** The administrator's switch: send the content to the web shop (and allow uploads). */
  async setProjection(
    enabled: unknown,
    userId: string,
  ): Promise<{ projectionEnabled: boolean }> {
    if (typeof enabled !== "boolean")
      throw new BadRequestException("enabled: true vagy false");
    // turning it ON where the environment does not allow writing to the shop
    // would be a switch that does nothing: refuse it, and say why
    if (enabled && !homepageProjectionAllowed(this.environment))
      throw new ConflictException(
        "Ebben a környezetben a webshopba küldés nincs engedélyezve (MEDUSA_PROJECT_HOMEPAGE_CONTENT), a kapcsoló nem kapcsolható be.",
      );
    const row = await this.store.setProjection(
      MAIN_HOMEPAGE_KEY,
      enabled,
      userId,
    );
    return { projectionEnabled: row.projectionEnabled };
  }

  /** The products marked for the "Egyedi korallok" band, in order. */
  featured(): Promise<HomepageFeaturedRow[]> {
    return this.store.featuredList();
  }

  /**
   * The per-product marker (Balázs, 2026-10-20). A change asks for one
   * projection round where the projection is on, like a content save, and its
   * failure never fails the marker.
   */
  async setFeatured(
    productId: unknown,
    featured: unknown,
    userId: string,
  ): Promise<{
    featured: boolean;
    list: HomepageFeaturedRow[];
    projection: HomepageProjectionResult;
  }> {
    if (typeof productId !== "string" || !productId)
      throw new BadRequestException("productId: kötelező");
    if (typeof featured !== "boolean")
      throw new BadRequestException("featured: true vagy false");
    const outcome = await this.store.setFeatured(
      productId,
      featured,
      userId,
      HOMEPAGE_FEATURED_MAX,
    );
    if (outcome === "unknown-product")
      throw new NotFoundException("Nincs ilyen termék.");
    if (outcome === "full")
      throw new ConflictException(
        `A kezdőlapon legfeljebb ${HOMEPAGE_FEATURED_MAX} egyedi korall látszik.`,
      );
    const row = await this.store.find(MAIN_HOMEPAGE_KEY);
    let projection: HomepageProjectionResult;
    if (!homepageProjectionOn(this.environment, row)) projection = "off";
    else
      try {
        projection = await this.project();
      } catch {
        projection = "failed";
      }
    return { featured, list: await this.store.featuredList(), projection };
  }

  async get(): Promise<HomepageContent> {
    return toHomepageContent(
      await this.store.find(MAIN_HOMEPAGE_KEY),
      homepageProjectionAllowed(this.environment),
    );
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
    if (!homepageProjectionOn(this.environment, row)) projection = "off";
    else
      try {
        projection = await this.project();
      } catch {
        projection = "failed";
      }
    return {
      content: toHomepageContent(
        row,
        homepageProjectionAllowed(this.environment),
      ),
      projection,
    };
  }
}

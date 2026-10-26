import { createHash } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { inspectImageBytes } from "../common/image-inspect.js";
import { richTextImageHosts } from "../homepage-content/homepage-content.service.js";
import { ArticleRepository } from "./article.repository.js";
import { ArticleImageRepository } from "./article-image.repository.js";
import { ARTICLE_ENVIRONMENT } from "./article.service.js";

/** The upload's limits: a web image, not a print master. */
export const ARTICLE_IMAGE_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxEdge: 6000,
  formats: ["png", "jpeg", "webp"],
} as const;

/** A cuid, as the store gives it: the public route answers nothing else. */
export const ARTICLE_IMAGE_ID = /^c[a-z0-9]{24}$/;

export const ARTICLE_IMAGE_PUBLIC_PATH = "/public/article-images";

/**
 * THE PUBLIC BASE OF THE IMAGE ADDRESSES (`ARTICLE_IMAGE_PUBLIC_BASE_URL`): the
 * API's own public origin, https only (production https://api.acropora.hu,
 * test https://api-staging.acropora.hu; acrobot 36329). It counts only when
 * its host is also on `RICH_TEXT_IMAGE_HOSTS`: otherwise the save would drop
 * the very image the upload just gave out. `null` means no upload here.
 */
export function articleImagePublicBase(env: NodeJS.ProcessEnv): string | null {
  try {
    const url = new URL((env.ARTICLE_IMAGE_PUBLIC_BASE_URL ?? "").trim());
    if (url.protocol !== "https:") return null;
    if (!richTextImageHosts(env).includes(url.hostname.toLowerCase()))
      return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * THE ARTICLE IMAGES (acrobot's decision, 2026-10-26, msg 36320): in the OS's
 * own store, with a public address. The article lives in the OS and shows in
 * two places (ReefClub and the web shop); the shop's file store cannot be its
 * base while the commerce is frozen and the projection is off.
 *
 * An upload belongs to an article whose body may change now: the same rule as
 * the body's save, so an image cannot be added to an approved text by a side
 * door. The address is handed out only where it will survive the save.
 */
@Injectable()
export class ArticleImageService {
  constructor(
    private readonly images: ArticleImageRepository,
    private readonly articles: ArticleRepository,
    @Inject(ARTICLE_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async upload(
    contentId: string,
    file: { buffer: Buffer },
    uploadedById: string | null,
  ): Promise<{ id: string; url: string }> {
    const base = articleImagePublicBase(this.environment);
    if (!base)
      throw new ServiceUnavailableException(
        "A cikk-képek publikus címe ebben a környezetben nincs beállítva (ARTICLE_IMAGE_PUBLIC_BASE_URL, és a hosztja a RICH_TEXT_IMAGE_HOSTS listán), a kép nem tölthető fel.",
      );
    if (!(await this.articles.editable(contentId)))
      throw new ConflictException(
        "Kép csak szerkeszthető cikkhez tölthető fel (a jóváhagyásra küldött szöveg nem változhat).",
      );
    const original = new Uint8Array(file.buffer);
    const sha256 = createHash("sha256").update(original).digest("hex");
    const existing = await this.images.findBySha256(sha256);
    const row =
      existing ??
      (await (async () => {
        const image = await inspectImageBytes(original, ARTICLE_IMAGE_LIMITS);
        return this.images.create({
          contentId,
          contentType: image.contentType,
          width: image.width,
          height: image.height,
          sha256,
          bytes: image.bytes,
          uploadedById,
        });
      })());
    return { id: row.id, url: `${base}${ARTICLE_IMAGE_PUBLIC_PATH}/${row.id}` };
  }

  /** One image by its id; anything else is a plain 404, the same for every miss. */
  async content(id: string) {
    const image = ARTICLE_IMAGE_ID.test(id)
      ? await this.images.content(id)
      : null;
    if (!image) throw new NotFoundException("Nincs ilyen kép.");
    return image;
  }
}
